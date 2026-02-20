import { Hono } from 'hono';
import { ulid } from 'ulidx';
import { eq, desc, asc, like, and, sql } from 'drizzle-orm';
import {
  feedbackListSchema,
  feedbackUpdateSchema,
  batchOperationSchema,
  agentEndpointSchema,
  dispatchSchema,
} from '@prompt-widget/shared';
import type { FeedbackItem, PermissionProfile } from '@prompt-widget/shared';
import { db, schema } from '../db/index.js';
import { getSession } from '../sessions.js';
import {
  fillPromptTemplate,
  dispatchWebhook,
  dispatchAgentSession,
  dispatchTerminalSession,
} from '../dispatch.js';
import type { DispatchContext } from '../dispatch.js';
import { feedbackEvents } from '../events.js';
import { verifyAdminToken } from '../auth.js';

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
        feedbackEvents.on('new', onNew);

        const keepalive = setInterval(() => {
          try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { /* closed */ }
        }, 30_000);

        c.req.raw.signal.addEventListener('abort', () => {
          feedbackEvents.off('new', onNew);
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

function hydrateFeedback(row: typeof schema.feedbackItems.$inferSelect, tags: string[], screenshots: (typeof schema.feedbackScreenshots.$inferSelect)[]): FeedbackItem {
  return {
    ...row,
    type: row.type as FeedbackItem['type'],
    status: row.status as FeedbackItem['status'],
    data: row.data ? JSON.parse(row.data) : null,
    context: row.context ? JSON.parse(row.context) : null,
    appId: row.appId || null,
    tags,
    screenshots,
  };
}

adminRoutes.get('/feedback', async (c) => {
  const query = feedbackListSchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query', details: query.error.flatten() }, 400);
  }

  const { page, limit, type, status, tag, search, appId, sortBy, sortOrder } = query.data;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (type) conditions.push(eq(schema.feedbackItems.type, type));
  if (status) conditions.push(eq(schema.feedbackItems.status, status));
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
    return hydrateFeedback(item, tags, screenshots);
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
  const item = await db.query.feedbackItems.findFirst({
    where: eq(schema.feedbackItems.id, id),
  });

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
        await db.delete(schema.feedbackItems).where(eq(schema.feedbackItems.id, id));
        affected++;
        break;
    }
  }

  return c.json({ operation, affected });
});

// Agent endpoints CRUD
adminRoutes.get('/agents', async (c) => {
  const agents = db.select().from(schema.agentEndpoints).all();
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

  if (parsed.data.isDefault && parsed.data.appId) {
    await db.update(schema.agentEndpoints)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(schema.agentEndpoints.appId, parsed.data.appId));
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

  if (parsed.data.isDefault && parsed.data.appId) {
    await db.update(schema.agentEndpoints)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(schema.agentEndpoints.appId, parsed.data.appId));
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

  const [feedback, agent] = await Promise.all([
    db.query.feedbackItems.findFirst({
      where: eq(schema.feedbackItems.id, feedbackId),
    }),
    db.query.agentEndpoints.findFirst({
      where: eq(schema.agentEndpoints.id, agentEndpointId),
    }),
  ]);
  if (!feedback) {
    return c.json({ error: 'Feedback not found' }, 404);
  }
  if (!agent) {
    return c.json({ error: 'Agent endpoint not found' }, 404);
  }

  const tags = db
    .select()
    .from(schema.feedbackTags)
    .where(eq(schema.feedbackTags.feedbackId, feedbackId))
    .all()
    .map((t) => t.tag);
  const screenshots = db
    .select()
    .from(schema.feedbackScreenshots)
    .where(eq(schema.feedbackScreenshots.feedbackId, feedbackId))
    .all();

  const hydratedFeedback = hydrateFeedback(feedback, tags, screenshots);

  // Look up associated application (agent's app takes priority, then feedback's app)
  let app = null;
  const appIdForCwd = agent.appId || feedback.appId;
  if (appIdForCwd) {
    const appRow = await db.query.applications.findFirst({
      where: eq(schema.applications.id, appIdForCwd),
    });
    if (appRow) {
      app = { ...appRow, hooks: JSON.parse(appRow.hooks) };
    }
  }

  // Find live session for prompt context
  let sessionInfo: { url: string | null; viewport: string | null } | undefined;
  if (feedback.sessionId) {
    const liveSession = getSession(feedback.sessionId);
    if (liveSession) {
      sessionInfo = { url: liveSession.url, viewport: liveSession.viewport };
    }
  }

  const mode = (agent.mode || 'webhook') as 'webhook' | 'headless' | 'interactive';

  try {
    if (mode === 'webhook') {
      const result = await dispatchWebhook(agent.url, agent.authHeader, {
        feedback: hydratedFeedback,
        instructions,
      });

      const now = new Date().toISOString();
      await db.update(schema.feedbackItems).set({
        status: 'dispatched',
        dispatchedTo: agent.name,
        dispatchedAt: now,
        dispatchStatus: result.status >= 200 && result.status < 300 ? 'success' : 'error',
        dispatchResponse: result.response.slice(0, 5000),
        updatedAt: now,
      }).where(eq(schema.feedbackItems.id, feedbackId));

      return c.json({
        dispatched: true,
        status: result.status,
        response: result.response.slice(0, 1000),
      });
    } else {
      // headless or interactive → PTY-based agent session
      const baseTemplate = agent.promptTemplate || '{{feedback.title}}\n\n{{feedback.description}}\n\n{{instructions}}';
      const template = agent.autoPlan
        ? baseTemplate + '\n\nIMPORTANT: Before making any changes, create a detailed plan first. Present the plan and wait for approval before implementing.'
        : baseTemplate;
      const ctx: DispatchContext = {
        feedback: hydratedFeedback,
        agent: {
          ...agent,
          mode: agent.mode as 'webhook' | 'headless' | 'interactive',
          appId: agent.appId || null,
          promptTemplate: agent.promptTemplate || null,
          authHeader: agent.authHeader || null,
          isDefault: !!agent.isDefault,
          permissionProfile: (agent.permissionProfile || 'interactive') as PermissionProfile,
          allowedTools: agent.allowedTools || null,
          autoPlan: !!agent.autoPlan,
        },
        app,
        instructions,
        session: sessionInfo,
      };
      const filledPrompt = fillPromptTemplate(template, ctx);
      const cwd = app?.projectDir || process.cwd();
      const permissionProfile = (agent.permissionProfile || 'interactive') as PermissionProfile;

      const { sessionId } = await dispatchAgentSession({
        feedbackId,
        agentEndpointId,
        prompt: filledPrompt,
        cwd,
        permissionProfile,
        allowedTools: agent.allowedTools,
      });

      // Update feedback status in the background — don't block the response
      const now = new Date().toISOString();
      db.update(schema.feedbackItems).set({
        status: 'dispatched',
        dispatchedTo: agent.name,
        dispatchedAt: now,
        dispatchStatus: 'running',
        dispatchResponse: `Agent session started: ${sessionId}`,
        updatedAt: now,
      }).where(eq(schema.feedbackItems.id, feedbackId)).run();

      return c.json({
        dispatched: true,
        sessionId,
        status: 200,
        response: `Agent session started: ${sessionId}`,
      });
    }
  } catch (err) {
    const now = new Date().toISOString();
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';

    await db.update(schema.feedbackItems).set({
      dispatchedTo: agent.name,
      dispatchedAt: now,
      dispatchStatus: 'error',
      dispatchResponse: errorMsg,
      updatedAt: now,
    }).where(eq(schema.feedbackItems.id, feedbackId));

    return c.json({ dispatched: false, error: errorMsg }, 502);
  }
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
