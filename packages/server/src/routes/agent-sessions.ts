import { Hono } from 'hono';
import { eq, desc, ne, and } from 'drizzle-orm';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { db, schema } from '../db/index.js';
import { killSession } from '../agent-sessions.js';
import { resumeAgentSession, dispatchTerminalSession } from '../dispatch.js';
import { getSessionLiveStates } from '../session-service-client.js';

function computeJsonlPath(projectDir: string | null, claudeSessionId: string | null): string | null {
  if (!projectDir || !claudeSessionId) return null;
  const sanitized = projectDir.replaceAll('/', '-').replaceAll('.', '-');
  return `${homedir()}/.claude/projects/${sanitized}/${claudeSessionId}.jsonl`;
}

export const agentSessionRoutes = new Hono();

agentSessionRoutes.get('/', async (c) => {
  const feedbackId = c.req.query('feedbackId');
  const includeDeleted = c.req.query('includeDeleted') === 'true';

  const selectFields = {
    session: schema.agentSessions,
    feedbackTitle: schema.feedbackItems.title,
    feedbackAppId: schema.feedbackItems.appId,
    agentName: schema.agentEndpoints.name,
    agentAppId: schema.agentEndpoints.appId,
    appProjectDir: schema.applications.projectDir,
  };

  const baseQuery = () => db
    .select(selectFields)
    .from(schema.agentSessions)
    .leftJoin(schema.feedbackItems, eq(schema.agentSessions.feedbackId, schema.feedbackItems.id))
    .leftJoin(schema.agentEndpoints, eq(schema.agentSessions.agentEndpointId, schema.agentEndpoints.id))
    .leftJoin(schema.applications, eq(schema.feedbackItems.appId, schema.applications.id));

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
      appId: r.feedbackAppId || r.agentAppId || null,
      inputState: live?.inputState || (r.session.status === 'running' ? 'active' : null),
      paneTitle: live?.paneTitle || null,
      paneCommand: live?.paneCommand || null,
      panePath: live?.panePath || null,
      jsonlPath: computeJsonlPath(r.appProjectDir || null, r.session.claudeSessionId),
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

agentSessionRoutes.get('/:id/jsonl', async (c) => {
  const id = c.req.param('id');
  const row = db
    .select({
      claudeSessionId: schema.agentSessions.claudeSessionId,
      appProjectDir: schema.applications.projectDir,
    })
    .from(schema.agentSessions)
    .leftJoin(schema.feedbackItems, eq(schema.agentSessions.feedbackId, schema.feedbackItems.id))
    .leftJoin(schema.applications, eq(schema.feedbackItems.appId, schema.applications.id))
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const jsonlPath = computeJsonlPath(row.appProjectDir || null, row.claudeSessionId);
  if (!jsonlPath) {
    return c.json({ error: 'No JSONL path available' }, 400);
  }
  if (!existsSync(jsonlPath)) {
    return c.json({ error: `JSONL file not found: ${jsonlPath}` }, 404);
  }

  const raw = readFileSync(jsonlPath, 'utf-8');
  const filtered = raw.split('\n').filter(line => {
    if (!line.trim()) return false;
    try {
      const obj = JSON.parse(line);
      return obj.type !== 'progress' && obj.type !== 'file-history-snapshot';
    } catch {
      return true;
    }
  }).join('\n');

  return c.text(filtered);
});

agentSessionRoutes.post('/:id/tail-jsonl', async (c) => {
  const id = c.req.param('id');
  const row = db
    .select({
      claudeSessionId: schema.agentSessions.claudeSessionId,
      appProjectDir: schema.applications.projectDir,
    })
    .from(schema.agentSessions)
    .leftJoin(schema.feedbackItems, eq(schema.agentSessions.feedbackId, schema.feedbackItems.id))
    .leftJoin(schema.applications, eq(schema.feedbackItems.appId, schema.applications.id))
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const jsonlPath = computeJsonlPath(row.appProjectDir || null, row.claudeSessionId);
  if (!jsonlPath) {
    return c.json({ error: 'No JSONL path available (missing projectDir or claudeSessionId)' }, 400);
  }
  if (!existsSync(jsonlPath)) {
    return c.json({ error: `JSONL file not found: ${jsonlPath}` }, 404);
  }

  const { sessionId } = await dispatchTerminalSession({ cwd: '/tmp' });

  const tmuxName = `pw-${sessionId}`;
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('tmux', ['-L', 'prompt-widget', 'send-keys', '-t', tmuxName, `tail -f ${jsonlPath}`, 'Enter'], { stdio: 'pipe' });
  } catch (err: any) {
    console.error('Failed to send tail command:', err.message);
  }

  return c.json({ sessionId, jsonlPath });
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
