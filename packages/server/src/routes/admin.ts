import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { ulid } from 'ulidx';
import { eq, desc, asc, like, and, or, isNull, sql, inArray, ne } from 'drizzle-orm';
import {
  feedbackListSchema,
  feedbackUpdateSchema,
  adminFeedbackCreateSchema,
  batchOperationSchema,
  agentEndpointSchema,
  dispatchSchema,
} from '@prompt-widget/shared';
import { db, schema } from '../db/index.js';
import {
  dispatchTerminalSession,
  hydrateFeedback,
  DEFAULT_PROMPT_TEMPLATE,
  dispatchFeedbackToAgent,
} from '../dispatch.js';
import { inputSessionRemote, getSessionStatus, SessionServiceError } from '../session-service-client.js';
import { killSession } from '../agent-sessions.js';
import { feedbackEvents } from '../events.js';
import { verifyAdminToken } from '../auth.js';

const PW_TMUX_CONF = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tmux-pw.conf');

export const adminRoutes = new Hono();

adminRoutes.get('/feedback/events', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('token');
  if (!token || !(await verifyAdminToken(token))) return c.json({ error: 'Unauthorized' }, 401);

  return c.body(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        send('connected', { ts: Date.now() });

        const onNew = (item: { id: string; appId: string | null }) => send('new-feedback', item);
        const onUpdated = (item: { id: string; appId: string | null }) => send('feedback-updated', item);
        feedbackEvents.on('new', onNew);
        feedbackEvents.on('updated', onUpdated);

        const keepalive = setInterval(() => {
          try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* closed */ }
        }, 30_000);

        c.req.raw.signal.addEventListener('abort', () => {
          feedbackEvents.off('new', onNew);
          feedbackEvents.off('updated', onUpdated);
          clearInterval(keepalive);
        });
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    }
  );
});

adminRoutes.post('/feedback', async (c) => {
  const body = await c.req.json();
  const parsed = adminFeedbackCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const now = new Date().toISOString();
  const id = ulid();
  const input = parsed.data;

  await db.insert(schema.feedbackItems).values({
    id,
    type: input.type,
    status: 'new',
    title: input.title,
    description: input.description,
    appId: input.appId,
    createdAt: now,
    updatedAt: now,
  });

  if (input.tags && input.tags.length > 0) {
    await db.insert(schema.feedbackTags).values(
      input.tags.map((tag) => ({ feedbackId: id, tag }))
    );
  }

  feedbackEvents.emit('new', { id, appId: input.appId });
  return c.json({ id, status: 'new', createdAt: now }, 201);
});

adminRoutes.get('/feedback', async (c) => {
  const query = feedbackListSchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query', details: query.error.flatten() }, 400);
  }

  const { page, limit, type, status, tag, search, appId, sortBy, sortOrder } = query.data;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (type) conditions.push(eq(schema.feedbackItems.type, type));
  if (status) {
    const statuses = status.split(',').filter(Boolean);
    if (statuses.length === 1) {
      conditions.push(eq(schema.feedbackItems.status, statuses[0]));
    } else if (statuses.length > 1) {
      conditions.push(inArray(schema.feedbackItems.status, statuses));
    }
  } else {
    // Exclude deleted items by default unless explicitly requested
    conditions.push(sql`${schema.feedbackItems.status} != 'deleted'`);
  }
  if (search) conditions.push(like(schema.feedbackItems.title, `%${search}%`));
  if (appId) {
    if (appId === '__unlinked__') {
      conditions.push(sql`${schema.feedbackItems.appId} IS NULL`);
    } else {
      conditions.push(eq(schema.feedbackItems.appId, appId));
    }
  }

  let whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  if (tag) {
    const taggedIds = db
      .select({ feedbackId: schema.feedbackTags.feedbackId })
      .from(schema.feedbackTags)
      .where(eq(schema.feedbackTags.tag, tag))
      .all()
      .map((r) => r.feedbackId);

    if (taggedIds.length === 0) {
      return c.json({ items: [], total: 0, page, limit, totalPages: 0 });
    }

    const inClause = sql`${schema.feedbackItems.id} IN (${sql.join(
      taggedIds.map((id) => sql`${id}`),
      sql`, `
    )})`;
    whereClause = whereClause ? and(whereClause, inClause) : inClause;
  }

  const sortColumn =
    sortBy === 'updatedAt'
      ? schema.feedbackItems.updatedAt
      : schema.feedbackItems.createdAt;
  const orderFn = sortOrder === 'asc' ? asc : desc;

  const items = db
    .select()
    .from(schema.feedbackItems)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(limit)
    .offset(offset)
    .all();

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.feedbackItems)
    .where(whereClause)
    .get();
  const total = countResult?.count || 0;

  // Fetch latest session info for dispatched feedback items
  const feedbackIds = items.map((i) => i.id);
  const sessionMap = new Map<string, { latestSessionId: string; latestSessionStatus: string; sessionCount: number }>();
  if (feedbackIds.length > 0) {
    const sessions = db
      .select({
        feedbackId: schema.agentSessions.feedbackId,
        id: schema.agentSessions.id,
        status: schema.agentSessions.status,
      })
      .from(schema.agentSessions)
      .where(and(
        inArray(schema.agentSessions.feedbackId, feedbackIds),
        ne(schema.agentSessions.status, 'deleted'),
      ))
      .orderBy(desc(schema.agentSessions.createdAt))
      .all();
    for (const s of sessions) {
      if (!s.feedbackId) continue;
      const existing = sessionMap.get(s.feedbackId);
      if (existing) {
        existing.sessionCount++;
      } else {
        sessionMap.set(s.feedbackId, { latestSessionId: s.id, latestSessionStatus: s.status, sessionCount: 1 });
      }
    }
  }

  const hydrated = items.map((item) => {
    const tags = db
      .select()
      .from(schema.feedbackTags)
      .where(eq(schema.feedbackTags.feedbackId, item.id))
      .all()
      .map((t) => t.tag);
    const screenshots = db
      .select()
      .from(schema.feedbackScreenshots)
      .where(eq(schema.feedbackScreenshots.feedbackId, item.id))
      .all();
    const fb = hydrateFeedback(item, tags, screenshots);
    const si = sessionMap.get(item.id);
    return si ? { ...fb, latestSessionId: si.latestSessionId, latestSessionStatus: si.latestSessionStatus, sessionCount: si.sessionCount } : fb;
  });

  return c.json({
    items: hydrated,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

adminRoutes.get('/feedback/:id', async (c) => {
  const id = c.req.param('id');
  let item = await db.query.feedbackItems.findFirst({
    where: eq(schema.feedbackItems.id, id),
  });

  // Fall back to short ID suffix match (last 6+ chars)
  if (!item && id.length >= 4 && id.length < 26) {
    item = await db.query.feedbackItems.findFirst({
      where: like(schema.feedbackItems.id, `%${id}`),
    });
  }

  if (!item) {
    return c.json({ error: 'Not found' }, 404);
  }

  const tags = db
    .select()
    .from(schema.feedbackTags)
    .where(eq(schema.feedbackTags.feedbackId, id))
    .all()
    .map((t) => t.tag);
  const screenshots = db
    .select()
    .from(schema.feedbackScreenshots)
    .where(eq(schema.feedbackScreenshots.feedbackId, id))
    .all();

  return c.json(hydrateFeedback(item, tags, screenshots));
});

adminRoutes.get('/feedback/:id/context', async (c) => {
  const id = c.req.param('id');
  const item = await db.query.feedbackItems.findFirst({
    where: eq(schema.feedbackItems.id, id),
  });

  if (!item) {
    return c.json({ error: 'Not found' }, 404);
  }

  const context = item.context ? JSON.parse(item.context) : null;
  const lines: string[] = [];

  lines.push(`# Feedback Context: ${id}`);
  lines.push(`Title: ${item.title}`);
  lines.push(`Description: ${item.description}`);
  lines.push(`URL: ${item.sourceUrl || 'N/A'}`);
  lines.push(`Created: ${item.createdAt}`);
  lines.push('');

  if (context?.environment) {
    const env = context.environment;
    lines.push('## Page Info');
    lines.push(`URL: ${env.url}`);
    lines.push(`Referrer: ${env.referrer || 'none'}`);
    lines.push(`Viewport: ${env.viewport}`);
    lines.push(`Screen: ${env.screenResolution}`);
    lines.push(`Platform: ${env.platform}`);
    lines.push(`Language: ${env.language}`);
    lines.push(`User-Agent: ${env.userAgent}`);
    lines.push(`Timestamp: ${new Date(env.timestamp).toISOString()}`);
    lines.push('');
  }

  if (context?.consoleLogs && context.consoleLogs.length > 0) {
    lines.push('## Console Logs');
    for (const log of context.consoleLogs) {
      const ts = new Date(log.timestamp).toISOString();
      lines.push(`[${ts}] ${log.level.toUpperCase()}: ${log.message}`);
    }
    lines.push('');
  }

  if (context?.networkErrors && context.networkErrors.length > 0) {
    lines.push('## Network Errors');
    for (const err of context.networkErrors) {
      const ts = new Date(err.timestamp).toISOString();
      lines.push(`[${ts}] ${err.method} ${err.url} → ${err.status} ${err.statusText}`);
    }
    lines.push('');
  }

  if (context?.performanceTiming) {
    const perf = context.performanceTiming;
    lines.push('## Performance');
    if (perf.loadTime != null) lines.push(`Load time: ${perf.loadTime.toFixed(1)}ms`);
    if (perf.domContentLoaded != null) lines.push(`DOM content loaded: ${perf.domContentLoaded.toFixed(1)}ms`);
    if (perf.firstContentfulPaint != null) lines.push(`First contentful paint: ${perf.firstContentfulPaint.toFixed(1)}ms`);
    lines.push('');
  }

  const screenshots = db
    .select()
    .from(schema.feedbackScreenshots)
    .where(eq(schema.feedbackScreenshots.feedbackId, id))
    .all();

  if (screenshots.length > 0) {
    lines.push('## Screenshots');
    for (const ss of screenshots) {
      const baseUrl = new URL(c.req.url).origin;
      lines.push(`- ${baseUrl}/api/v1/images/${ss.id} (${ss.mimeType}, ${ss.size} bytes)`);
    }
    lines.push('');
  }

  return c.text(lines.join('\n'));
});

adminRoutes.patch('/feedback/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = feedbackUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.feedbackItems.findFirst({
    where: eq(schema.feedbackItems.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (parsed.data.status) updates.status = parsed.data.status;
  if (parsed.data.title) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  await db.update(schema.feedbackItems).set(updates).where(eq(schema.feedbackItems.id, id));

  if (parsed.data.tags) {
    await db.delete(schema.feedbackTags).where(eq(schema.feedbackTags.feedbackId, id));
    if (parsed.data.tags.length > 0) {
      await db.insert(schema.feedbackTags).values(
        parsed.data.tags.map((tag) => ({ feedbackId: id, tag }))
      );
    }
  }

  return c.json({ id, updated: true });
});

adminRoutes.delete('/feedback/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await db.query.feedbackItems.findFirst({
    where: eq(schema.feedbackItems.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  await db.delete(schema.feedbackItems).where(eq(schema.feedbackItems.id, id));
  return c.json({ id, deleted: true });
});

adminRoutes.post('/feedback/batch', async (c) => {
  const body = await c.req.json();
  const parsed = batchOperationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { ids, operation, value } = parsed.data;
  const now = new Date().toISOString();
  let affected = 0;

  for (const id of ids) {
    const existing = await db.query.feedbackItems.findFirst({
      where: eq(schema.feedbackItems.id, id),
    });
    if (!existing) continue;

    switch (operation) {
      case 'updateStatus':
        if (value) {
          await db.update(schema.feedbackItems)
            .set({ status: value, updatedAt: now })
            .where(eq(schema.feedbackItems.id, id));
          affected++;
        }
        break;
      case 'addTag':
        if (value) {
          const existingTag = db
            .select()
            .from(schema.feedbackTags)
            .where(and(eq(schema.feedbackTags.feedbackId, id), eq(schema.feedbackTags.tag, value)))
            .get();
          if (!existingTag) {
            await db.insert(schema.feedbackTags).values({ feedbackId: id, tag: value });
          }
          affected++;
        }
        break;
      case 'removeTag':
        if (value) {
          await db.delete(schema.feedbackTags)
            .where(and(eq(schema.feedbackTags.feedbackId, id), eq(schema.feedbackTags.tag, value)));
          affected++;
        }
        break;
      case 'delete':
        await db.update(schema.feedbackItems)
          .set({ status: 'deleted', updatedAt: now })
          .where(eq(schema.feedbackItems.id, id));
        affected++;
        break;
      case 'permanentDelete':
        await db.delete(schema.feedbackItems).where(eq(schema.feedbackItems.id, id));
        affected++;
        break;
    }
  }

  return c.json({ operation, affected });
});

// Agent endpoints CRUD
adminRoutes.get('/agents', async (c) => {
  const appId = c.req.query('appId');
  let agents;
  if (appId) {
    agents = db.select().from(schema.agentEndpoints)
      .where(or(eq(schema.agentEndpoints.appId, appId), isNull(schema.agentEndpoints.appId)))
      .all();
  } else {
    agents = db.select().from(schema.agentEndpoints).all();
  }
  return c.json(agents);
});

adminRoutes.post('/agents', async (c) => {
  const body = await c.req.json();
  const parsed = agentEndpointSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const now = new Date().toISOString();
  const id = ulid();

  if (parsed.data.isDefault) {
    const condition = parsed.data.appId
      ? eq(schema.agentEndpoints.appId, parsed.data.appId)
      : isNull(schema.agentEndpoints.appId);
    await db.update(schema.agentEndpoints)
      .set({ isDefault: false, updatedAt: now })
      .where(condition);
  }

  await db.insert(schema.agentEndpoints).values({
    id,
    name: parsed.data.name,
    url: parsed.data.url || '',
    authHeader: parsed.data.authHeader || null,
    isDefault: parsed.data.isDefault,
    appId: parsed.data.appId || null,
    promptTemplate: parsed.data.promptTemplate || null,
    mode: parsed.data.mode || 'webhook',
    permissionProfile: parsed.data.permissionProfile || 'interactive',
    allowedTools: parsed.data.allowedTools || null,
    autoPlan: parsed.data.autoPlan || false,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ id }, 201);
});

adminRoutes.patch('/agents/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = agentEndpointSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.agentEndpoints.findFirst({
    where: eq(schema.agentEndpoints.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  const now = new Date().toISOString();

  if (parsed.data.isDefault) {
    const condition = parsed.data.appId
      ? eq(schema.agentEndpoints.appId, parsed.data.appId)
      : isNull(schema.agentEndpoints.appId);
    await db.update(schema.agentEndpoints)
      .set({ isDefault: false, updatedAt: now })
      .where(condition);
  }

  await db.update(schema.agentEndpoints).set({
    name: parsed.data.name,
    url: parsed.data.url || '',
    authHeader: parsed.data.authHeader || null,
    isDefault: parsed.data.isDefault,
    appId: parsed.data.appId || null,
    promptTemplate: parsed.data.promptTemplate || null,
    mode: parsed.data.mode || 'webhook',
    permissionProfile: parsed.data.permissionProfile || 'interactive',
    allowedTools: parsed.data.allowedTools || null,
    autoPlan: parsed.data.autoPlan || false,
    updatedAt: now,
  }).where(eq(schema.agentEndpoints.id, id));

  return c.json({ id, updated: true });
});

adminRoutes.delete('/agents/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await db.query.agentEndpoints.findFirst({
    where: eq(schema.agentEndpoints.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  await db.delete(schema.agentEndpoints).where(eq(schema.agentEndpoints.id, id));
  return c.json({ id, deleted: true });
});

// Dispatch
adminRoutes.post('/dispatch', async (c) => {
  const body = await c.req.json();
  const parsed = dispatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { feedbackId, agentEndpointId, instructions } = parsed.data;

  try {
    // Admin-specific: detect and kill stuck sessions before dispatching
    const agent = await db.query.agentEndpoints.findFirst({
      where: eq(schema.agentEndpoints.id, agentEndpointId),
    });
    if (agent) {
      const mode = (agent.mode || 'webhook') as string;
      if (mode !== 'webhook') {
        const existing = db
          .select()
          .from(schema.agentSessions)
          .where(
            and(
              eq(schema.agentSessions.feedbackId, feedbackId),
              sql`${schema.agentSessions.status} IN ('pending', 'running')`
            )
          )
          .get();

        if (existing) {
          const ageMs = Date.now() - new Date(existing.createdAt).getTime();

          if (ageMs > 30_000) {
            const status = await getSessionStatus(existing.id);
            const stuck = !status || status.healthy === false || (status.totalBytes ?? 0) < 15_000;

            if (stuck) {
              console.log(`[admin] Stuck session detected: ${existing.id} (age=${Math.round(ageMs / 1000)}s, bytes=${status?.totalBytes ?? 0}, healthy=${status?.healthy}) — killing`);
              await killSession(existing.id);
            } else {
              return c.json({
                dispatched: true,
                sessionId: existing.id,
                status: 200,
                response: `Existing active session: ${existing.id}`,
                existing: true,
              });
            }
          } else {
            return c.json({
              dispatched: true,
              sessionId: existing.id,
              status: 200,
              response: `Existing active session: ${existing.id}`,
              existing: true,
            });
          }
        }
      }
    }

    const result = await dispatchFeedbackToAgent({ feedbackId, agentEndpointId, instructions });
    return c.json(result);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    if (errorMsg === 'Feedback not found' || errorMsg === 'Agent endpoint not found') {
      return c.json({ error: errorMsg }, 404);
    }
    if (err instanceof SessionServiceError) {
      console.error(`[admin] Session service error during dispatch:`, errorMsg);
      return c.json({ dispatched: false, error: errorMsg }, 503);
    }
    console.error(`[admin] Dispatch error:`, errorMsg);
    return c.json({ dispatched: false, error: errorMsg }, 500);
  }
});

// Default prompt template
adminRoutes.get('/default-prompt-template', (c) => {
  return c.json({ template: DEFAULT_PROMPT_TEMPLATE });
});

// Tmux configs CRUD
adminRoutes.get('/tmux-configs', (c) => {
  const configs = db.select().from(schema.tmuxConfigs).all();
  return c.json(configs);
});

adminRoutes.post('/tmux-configs', async (c) => {
  const body = await c.req.json() as { name: string; content?: string };
  if (!body.name) return c.json({ error: 'Name required' }, 400);

  const now = new Date().toISOString();
  const id = ulid();
  db.insert(schema.tmuxConfigs).values({
    id,
    name: body.name,
    content: body.content || '',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  }).run();
  return c.json({ id }, 201);
});

adminRoutes.patch('/tmux-configs/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.select().from(schema.tmuxConfigs).where(eq(schema.tmuxConfigs.id, id)).get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json() as { name?: string; content?: string; isDefault?: boolean };
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (body.name !== undefined) updates.name = body.name;
  if (body.content !== undefined) updates.content = body.content;
  if (body.isDefault) {
    db.update(schema.tmuxConfigs).set({ isDefault: false, updatedAt: now }).run();
    updates.isDefault = true;
  }

  db.update(schema.tmuxConfigs).set(updates).where(eq(schema.tmuxConfigs.id, id)).run();
  return c.json({ id, updated: true });
});

adminRoutes.delete('/tmux-configs/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.select().from(schema.tmuxConfigs).where(eq(schema.tmuxConfigs.id, id)).get();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.isDefault) return c.json({ error: 'Cannot delete the default config' }, 400);

  db.delete(schema.tmuxConfigs).where(eq(schema.tmuxConfigs.id, id)).run();
  return c.json({ id, deleted: true });
});

// Edit tmux config in terminal (nano/vim)
adminRoutes.post('/tmux-configs/:id/edit-terminal', async (c) => {
  const id = c.req.param('id');
  const config = db.select().from(schema.tmuxConfigs).where(eq(schema.tmuxConfigs.id, id)).get();
  if (!config) return c.json({ error: 'Not found' }, 404);

  const tmpPath = `/tmp/pw-tmux-edit-${id}.conf`;
  writeFileSync(tmpPath, config.content, 'utf-8');

  const { sessionId } = await dispatchTerminalSession({ cwd: '/tmp' });

  // Send editor command after shell is ready
  setTimeout(async () => {
    try {
      await inputSessionRemote(sessionId, `\${EDITOR:-nano} ${tmpPath}\r`);
    } catch (err) {
      console.error('[admin] Failed to send editor command:', err);
    }
  }, 800);

  return c.json({ sessionId, configId: id });
});

// Save tmux config back from temp file after terminal editing
adminRoutes.post('/tmux-configs/:id/save-from-file', async (c) => {
  const id = c.req.param('id');
  const existing = db.select().from(schema.tmuxConfigs).where(eq(schema.tmuxConfigs.id, id)).get();
  if (!existing) return c.json({ error: 'Config not found' }, 404);

  const tmpPath = `/tmp/pw-tmux-edit-${id}.conf`;
  let content: string;
  try {
    content = readFileSync(tmpPath, 'utf-8');
  } catch {
    return c.json({ error: 'Temp file not found — editor may not have saved yet' }, 404);
  }

  const now = new Date().toISOString();
  db.update(schema.tmuxConfigs)
    .set({ content, updatedAt: now })
    .where(eq(schema.tmuxConfigs.id, id)).run();

  try { unlinkSync(tmpPath); } catch {}

  return c.json({ saved: true, content });
});

// Tmux config endpoints — read/write tmux-pw.conf file directly
adminRoutes.get('/tmux-conf', (c) => {
  try {
    const content = readFileSync(PW_TMUX_CONF, 'utf-8');
    return c.json({ content });
  } catch {
    return c.json({ content: '' });
  }
});

adminRoutes.put('/tmux-conf', async (c) => {
  const { content } = await c.req.json() as { content: string };
  writeFileSync(PW_TMUX_CONF, content, 'utf-8');
  return c.json({ saved: true });
});

// Plain terminal session (no agent, no feedback)
adminRoutes.post('/terminal', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { cwd, appId } = body as { cwd?: string; appId?: string };

  let resolvedCwd = cwd || process.cwd();
  if (!cwd && appId) {
    const app = await db.query.applications.findFirst({
      where: eq(schema.applications.id, appId),
    });
    if (app?.projectDir) resolvedCwd = app.projectDir;
  }

  try {
    const { sessionId } = await dispatchTerminalSession({ cwd: resolvedCwd, appId });
    return c.json({ sessionId });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: errorMsg }, 500);
  }
});
