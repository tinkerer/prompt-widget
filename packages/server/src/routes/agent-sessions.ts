import { Hono } from 'hono';
import { eq, desc, ne, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { killSession } from '../agent-sessions.js';
import { resumeAgentSession } from '../dispatch.js';
import { getSessionLiveStates } from '../session-service-client.js';

export const agentSessionRoutes = new Hono();

agentSessionRoutes.get('/', async (c) => {
  const feedbackId = c.req.query('feedbackId');
  const includeDeleted = c.req.query('includeDeleted') === 'true';

  const selectFields = {
    session: schema.agentSessions,
    feedbackTitle: schema.feedbackItems.title,
    agentName: schema.agentEndpoints.name,
  };

  const baseQuery = () => db
    .select(selectFields)
    .from(schema.agentSessions)
    .leftJoin(schema.feedbackItems, eq(schema.agentSessions.feedbackId, schema.feedbackItems.id))
    .leftJoin(schema.agentEndpoints, eq(schema.agentSessions.agentEndpointId, schema.agentEndpoints.id));

  let rows;
  if (feedbackId) {
    const where = includeDeleted
      ? eq(schema.agentSessions.feedbackId, feedbackId)
      : and(eq(schema.agentSessions.feedbackId, feedbackId), ne(schema.agentSessions.status, 'deleted'));
    rows = baseQuery()
      .where(where)
      .orderBy(desc(schema.agentSessions.createdAt))
      .all();
  } else {
    const where = includeDeleted ? undefined : ne(schema.agentSessions.status, 'deleted');
    rows = baseQuery()
      .where(where)
      .orderBy(desc(schema.agentSessions.createdAt))
      .all();
  }

  const liveStates = await getSessionLiveStates();

  const sessions = rows.map((r) => {
    const live = liveStates[r.session.id];
    return {
      ...r.session,
      feedbackTitle: r.feedbackTitle || null,
      agentName: r.agentName || null,
      inputState: live?.inputState || (r.session.status === 'running' ? 'active' : null),
      paneTitle: live?.paneTitle || null,
    };
  });

  return c.json(sessions);
});

agentSessionRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!session) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json(session);
});

agentSessionRoutes.post('/:id/kill', async (c) => {
  const id = c.req.param('id');
  const killed = await killSession(id);

  if (!killed) {
    return c.json({ error: 'Session not running or not found' }, 404);
  }

  return c.json({ id, killed: true });
});

agentSessionRoutes.post('/:id/resume', async (c) => {
  const id = c.req.param('id');
  try {
    const { sessionId } = await resumeAgentSession(id);
    return c.json({ sessionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Resume failed';
    return c.json({ error: msg }, 400);
  }
});

agentSessionRoutes.post('/:id/archive', async (c) => {
  const id = c.req.param('id');
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!session) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (session.status === 'running' || session.status === 'pending') {
    await killSession(id);
  }

  db.update(schema.agentSessions)
    .set({ status: 'deleted', completedAt: session.completedAt || new Date().toISOString() })
    .where(eq(schema.agentSessions.id, id))
    .run();

  return c.json({ id, archived: true });
});

agentSessionRoutes.post('/:id/open-terminal', async (c) => {
  const id = c.req.param('id');
  const tmuxName = `pw-${id}`;
  const { execFileSync } = await import('node:child_process');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  try {
    execFileSync('tmux', ['-L', 'prompt-widget', 'has-session', '-t', tmuxName], { stdio: 'pipe' });
  } catch {
    return c.json({ error: 'Tmux session not found' }, 404);
  }
  try {
    const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'open-in-terminal.sh');
    execFileSync(scriptPath, [tmuxName], { stdio: 'pipe' });
    return c.json({ ok: true, tmuxName });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

agentSessionRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!session) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (session.status === 'running' || session.status === 'pending') {
    await killSession(id);
  }

  await db.delete(schema.agentSessions).where(eq(schema.agentSessions.id, id));
  return c.json({ id, deleted: true });
});
