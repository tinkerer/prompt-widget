import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { killSession } from '../agent-sessions.js';
import { resumeAgentSession } from '../dispatch.js';

export const agentSessionRoutes = new Hono();

agentSessionRoutes.get('/', async (c) => {
  const feedbackId = c.req.query('feedbackId');

  let sessions;
  if (feedbackId) {
    sessions = db
      .select()
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.feedbackId, feedbackId))
      .orderBy(desc(schema.agentSessions.createdAt))
      .all();
  } else {
    sessions = db
      .select()
      .from(schema.agentSessions)
      .orderBy(desc(schema.agentSessions.createdAt))
      .limit(50)
      .all();
  }

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
