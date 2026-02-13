import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import * as pty from 'node-pty';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import type { PermissionProfile } from '@prompt-widget/shared';

const PORT = parseInt(process.env.SESSION_SERVICE_PORT || '3002', 10);
const MAX_OUTPUT_LOG = 500 * 1024; // 500KB
const FLUSH_INTERVAL = 10_000; // 10s

// ---------- PTY process management ----------

interface AgentProcess {
  sessionId: string;
  ptyProcess: pty.IPty;
  outputBuffer: string;
  totalBytes: number;
  adminSockets: Set<WebSocket>;
  status: 'running' | 'completed' | 'failed' | 'killed';
  flushTimer: ReturnType<typeof setInterval>;
}

const activeSessions = new Map<string, AgentProcess>();

function buildClaudeArgs(
  prompt: string,
  permissionProfile: PermissionProfile,
  allowedTools?: string | null,
  resume?: boolean
): { command: string; args: string[]; sendPromptAfterSpawn: boolean } {
  if (resume) {
    const args = ['--continue'];
    if (permissionProfile === 'yolo') {
      args.push('--dangerously-skip-permissions');
    }
    return { command: 'claude', args, sendPromptAfterSpawn: false };
  }

  switch (permissionProfile) {
    case 'interactive':
      return { command: 'claude', args: [], sendPromptAfterSpawn: true };
    case 'auto': {
      const args = ['-p', prompt];
      if (allowedTools) {
        args.push('--allowedTools', allowedTools);
      }
      return { command: 'claude', args, sendPromptAfterSpawn: false };
    }
    case 'yolo':
      return {
        command: 'claude',
        args: ['-p', prompt, '--dangerously-skip-permissions'],
        sendPromptAfterSpawn: false,
      };
    default:
      return { command: 'claude', args: [], sendPromptAfterSpawn: true };
  }
}

function flushOutput(sessionId: string): void {
  const proc = activeSessions.get(sessionId);
  if (!proc) return;

  db.update(schema.agentSessions)
    .set({
      outputLog: proc.outputBuffer.slice(-MAX_OUTPUT_LOG),
      outputBytes: proc.totalBytes,
    })
    .where(eq(schema.agentSessions.id, sessionId))
    .run();
}

function spawnSession(params: {
  sessionId: string;
  prompt: string;
  cwd: string;
  permissionProfile: PermissionProfile;
  allowedTools?: string | null;
  resume?: boolean;
}): void {
  const { sessionId, prompt, cwd, permissionProfile, allowedTools, resume } = params;

  if (activeSessions.has(sessionId)) {
    throw new Error(`Session ${sessionId} is already running`);
  }

  const { command, args, sendPromptAfterSpawn } = buildClaudeArgs(
    prompt,
    permissionProfile,
    allowedTools,
    resume
  );

  const ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });

  const proc: AgentProcess = {
    sessionId,
    ptyProcess,
    outputBuffer: '',
    totalBytes: 0,
    adminSockets: new Set(),
    status: 'running',
    flushTimer: setInterval(() => flushOutput(sessionId), FLUSH_INTERVAL),
  };

  activeSessions.set(sessionId, proc);

  const now = new Date().toISOString();
  db.update(schema.agentSessions)
    .set({ status: 'running', pid: ptyProcess.pid, startedAt: now })
    .where(eq(schema.agentSessions.id, sessionId))
    .run();

  ptyProcess.onData((data: string) => {
    proc.outputBuffer += data;
    proc.totalBytes += Buffer.byteLength(data);

    if (proc.outputBuffer.length > MAX_OUTPUT_LOG) {
      proc.outputBuffer = proc.outputBuffer.slice(-MAX_OUTPUT_LOG);
    }

    for (const ws of proc.adminSockets) {
      try {
        ws.send(JSON.stringify({ type: 'output', data }));
      } catch {
        proc.adminSockets.delete(ws);
      }
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    proc.status = exitCode === 0 ? 'completed' : 'failed';
    clearInterval(proc.flushTimer);

    const completedAt = new Date().toISOString();
    db.update(schema.agentSessions)
      .set({
        status: proc.status,
        exitCode: exitCode,
        outputLog: proc.outputBuffer.slice(-MAX_OUTPUT_LOG),
        outputBytes: proc.totalBytes,
        completedAt,
      })
      .where(eq(schema.agentSessions.id, sessionId))
      .run();

    for (const ws of proc.adminSockets) {
      try {
        ws.send(JSON.stringify({ type: 'exit', exitCode }));
      } catch {
        // ignore
      }
    }

    activeSessions.delete(sessionId);
  });

  if (sendPromptAfterSpawn) {
    let sent = false;
    const maxWait = 10_000;
    const startTime = Date.now();

    const trySend = () => {
      if (sent) return;
      sent = true;
      try {
        ptyProcess.write(prompt + '\r');
      } catch {
        // PTY may have already exited
      }
    };

    const disposable = ptyProcess.onData(() => {
      if (!sent && Date.now() - startTime > 1500) {
        trySend();
        disposable.dispose();
      }
    });

    setTimeout(() => {
      disposable.dispose();
      trySend();
    }, maxWait);
  }
}

function killSessionProcess(sessionId: string): boolean {
  const proc = activeSessions.get(sessionId);
  if (!proc || proc.status !== 'running') return false;

  proc.status = 'killed';
  proc.ptyProcess.kill();
  clearInterval(proc.flushTimer);

  const now = new Date().toISOString();
  db.update(schema.agentSessions)
    .set({
      status: 'killed',
      outputLog: proc.outputBuffer.slice(-MAX_OUTPUT_LOG),
      outputBytes: proc.totalBytes,
      completedAt: now,
    })
    .where(eq(schema.agentSessions.id, sessionId))
    .run();

  for (const ws of proc.adminSockets) {
    try {
      ws.send(JSON.stringify({ type: 'exit', exitCode: -1, status: 'killed' }));
    } catch {
      // ignore
    }
  }

  activeSessions.delete(sessionId);
  return true;
}

function resizeSessionProcess(sessionId: string, cols: number, rows: number): void {
  const proc = activeSessions.get(sessionId);
  if (proc && proc.status === 'running') {
    proc.ptyProcess.resize(cols, rows);
  }
}

function writeToSession(sessionId: string, data: string): void {
  const proc = activeSessions.get(sessionId);
  if (proc && proc.status === 'running') {
    proc.ptyProcess.write(data);
  }
}

function attachAdminSocket(sessionId: string, ws: WebSocket): boolean {
  const proc = activeSessions.get(sessionId);
  if (proc) {
    ws.send(JSON.stringify({ type: 'history', data: proc.outputBuffer }));
    proc.adminSockets.add(ws);
    return true;
  }

  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, sessionId))
    .get();
  if (session) {
    ws.send(
      JSON.stringify({
        type: 'history',
        data: session.outputLog || '',
      })
    );
    if (session.status !== 'pending' && session.status !== 'running') {
      ws.send(
        JSON.stringify({
          type: 'exit',
          exitCode: session.exitCode,
          status: session.status,
        })
      );
    }
    return true;
  }

  return false;
}

function detachAdminSocket(sessionId: string, ws: WebSocket): void {
  const proc = activeSessions.get(sessionId);
  if (proc) {
    proc.adminSockets.delete(ws);
  }
}

// ---------- Cleanup ----------

function cleanupOrphanedSessions(): void {
  db.update(schema.agentSessions)
    .set({ status: 'failed', completedAt: new Date().toISOString() })
    .where(eq(schema.agentSessions.status, 'running'))
    .run();
}

// ---------- HTTP API ----------

const app = new Hono();

app.get('/health', (c) => {
  return c.json({
    ok: true,
    activeSessions: activeSessions.size,
    sessions: Array.from(activeSessions.keys()),
  });
});

app.post('/spawn', async (c) => {
  const body = await c.req.json();
  const { sessionId, prompt, cwd, permissionProfile, allowedTools, resume } = body;

  if (!sessionId || !prompt || !cwd || !permissionProfile) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  try {
    spawnSession({ sessionId, prompt, cwd, permissionProfile, allowedTools, resume });
    return c.json({ ok: true, sessionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Spawn failed';
    return c.json({ error: msg }, 400);
  }
});

app.post('/kill/:id', (c) => {
  const id = c.req.param('id');
  const killed = killSessionProcess(id);
  if (!killed) {
    return c.json({ error: 'Session not running or not found' }, 404);
  }
  return c.json({ ok: true, id });
});

app.post('/resize/:id', async (c) => {
  const id = c.req.param('id');
  const { cols, rows } = await c.req.json();
  resizeSessionProcess(id, cols, rows);
  return c.json({ ok: true });
});

app.post('/input/:id', async (c) => {
  const id = c.req.param('id');
  const { data } = await c.req.json();
  writeToSession(id, data);
  return c.json({ ok: true });
});

app.get('/status/:id', (c) => {
  const id = c.req.param('id');
  const proc = activeSessions.get(id);
  if (proc) {
    return c.json({ status: proc.status, active: true });
  }
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get();
  if (session) {
    return c.json({ status: session.status, active: false });
  }
  return c.json({ error: 'Not found' }, 404);
});

// ---------- WebSocket server ----------

const wsServer = new WebSocketServer({ noServer: true });

wsServer.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    ws.close(4001, 'Missing sessionId');
    return;
  }

  const attached = attachAdminSocket(sessionId, ws);
  if (!attached) {
    ws.close(4004, 'Session not found');
    return;
  }

  console.log(`[session-service] WS attached to session: ${sessionId}`);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'input':
          writeToSession(sessionId, msg.data);
          break;
        case 'resize':
          resizeSessionProcess(sessionId, msg.cols, msg.rows);
          break;
        case 'kill':
          killSessionProcess(sessionId);
          break;
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    detachAdminSocket(sessionId, ws);
    console.log(`[session-service] WS detached from session: ${sessionId}`);
  });
});

// ---------- Start ----------

cleanupOrphanedSessions();

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[session-service] Running on http://localhost:${PORT}`);
});

(server as unknown as Server).on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname === '/ws/agent-session') {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// ---------- Graceful shutdown ----------

function shutdown() {
  console.log('[session-service] Shutting down...');
  for (const [sessionId, proc] of activeSessions) {
    console.log(`[session-service] Killing session ${sessionId}`);
    clearInterval(proc.flushTimer);
    flushOutput(sessionId);
    try {
      proc.ptyProcess.kill();
    } catch {
      // already dead
    }
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
