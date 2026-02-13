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
} from '../dispatch.js';
import type { DispatchContext } from '../dispatch.js';

export const adminRoutes = new Hono();

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

  const { page, limit, type, status, tag, search, sortBy, sortOrder } = query.data;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (type) conditions.push(eq(schema.feedbackItems.type, type));
  if (status) conditions.push(eq(schema.feedbackItems.status, status));
  if (search) conditions.push(like(schema.feedbackItems.title, `%${search}%`));

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

  if (parsed.data.isDefault) {
    await db.update(schema.agentEndpoints)
      .set({ isDefault: false, updatedAt: now });
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
    await db.update(schema.agentEndpoints)
      .set({ isDefault: false, updatedAt: now });
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

  const feedback = await db.query.feedbackItems.findFirst({
    where: eq(schema.feedbackItems.id, feedbackId),
  });
  if (!feedback) {
    return c.json({ error: 'Feedback not found' }, 404);
  }

  const agent = await db.query.agentEndpoints.findFirst({
    where: eq(schema.agentEndpoints.id, agentEndpointId),
  });
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

  // Look up associated application
  let app = null;
  if (agent.appId) {
    const appRow = await db.query.applications.findFirst({
      where: eq(schema.applications.id, agent.appId),
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
      const template = agent.promptTemplate || '{{feedback.title}}\n\n{{feedback.description}}\n\n{{instructions}}';
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

      const now = new Date().toISOString();
      await db.update(schema.feedbackItems).set({
        status: 'dispatched',
        dispatchedTo: agent.name,
        dispatchedAt: now,
        dispatchStatus: 'running',
        dispatchResponse: `Agent session started: ${sessionId}`,
        updatedAt: now,
      }).where(eq(schema.feedbackItems.id, feedbackId));

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
