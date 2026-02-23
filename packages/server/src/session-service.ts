import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import * as pty from 'node-pty';
import { eq, inArray, desc } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import type { PermissionProfile, SequencedOutput, SessionOutputData } from '@prompt-widget/shared';
import { MessageBuffer } from './message-buffer.js';
import {
  isTmuxAvailable,
  spawnInTmux,
  reattachTmux,
  tmuxSessionExists,
  killTmuxSession,
  captureTmuxPane,
  listPwTmuxSessions,
  detachTmuxClients,
} from './tmux-pty.js';

const PORT = parseInt(process.env.SESSION_SERVICE_PORT || '3002', 10);

// Strip CLAUDECODE env var so spawned Claude sessions don't think they're nested
delete process.env.CLAUDECODE;
const MAX_OUTPUT_LOG = 500 * 1024; // 500KB
const FLUSH_INTERVAL = 10_000; // 10s

// ---------- Message buffer ----------

const messageBuffer = new MessageBuffer();

// ---------- PTY process management ----------

// Strip ANSI escape sequences to measure visible content length
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b\[[\?]?[0-9;]*[hlm]/g;

// Minimum visible bytes after a bell to consider "real output" (clears waiting)
// Claude Code TUI redraws status/spinners which leak visible chars, so set high
const BELL_CLEAR_THRESHOLD = 2000;

// Check bottom of pane text for interactive prompts (used on recovery to seed state)
function looksLikePrompt(paneText: string): boolean {
  const bottom = paneText.split('\n').slice(-10).join('\n').toLowerCase();
  if (/\[y\/n\]|\(y\/n\)|\(yes\/no\)|\[yes\/no\]/.test(bottom)) return true;
  if (/\ballow\b.*\bdeny\b|\bdeny\b.*\ballow\b/.test(bottom)) return true;
  if (/\ballow once\b|\ballow always\b/.test(bottom)) return true;
  if (/would you like to proceed/.test(bottom)) return true;
  if (/do you want to (proceed|continue)\?/.test(bottom)) return true;
  return false;
}

interface AgentProcess {
  sessionId: string;
  ptyProcess: pty.IPty;
  outputBuffer: string;
  totalBytes: number;
  outputSeq: number;
  lastInputAckSeq: number;
  adminSockets: Set<WebSocket>;
  status: 'running' | 'completed' | 'failed' | 'killed';
  flushTimer: ReturnType<typeof setInterval>;
  waitingForInput: boolean;
  bytesSinceBell: number;
  bellClearAfter: number; // timestamp after which output can clear waiting state
  hasStarted: boolean;
}

const activeSessions = new Map<string, AgentProcess>();
const pendingConnections = new Map<string, Set<WebSocket>>();

function buildClaudeArgs(
  prompt: string,
  permissionProfile: PermissionProfile,
  allowedTools?: string | null,
  claudeSessionId?: string,
  resumeSessionId?: string,
): { command: string; args: string[] } {
  // When resuming, use --resume only — no --session-id (it conflicts)
  if (resumeSessionId) {
    const args = ['--resume', resumeSessionId];
    if (prompt) args.push(prompt);
    return { command: 'claude', args };
  }

  switch (permissionProfile) {
    case 'interactive': {
      const args: string[] = [];
      if (claudeSessionId) args.push('--session-id', claudeSessionId);
      if (allowedTools) args.push(`--allowedTools=${allowedTools}`);
      if (prompt) args.push(prompt);
      return { command: 'claude', args };
    }
    case 'auto': {
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
      if (claudeSessionId) args.push('--session-id', claudeSessionId);
      if (allowedTools) {
        args.push(`--allowedTools=${allowedTools}`);
      }
      return { command: 'claude', args };
    }
    case 'yolo': {
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
      if (claudeSessionId) args.push('--session-id', claudeSessionId);
      return { command: 'claude', args };
    }
    case 'plain': {
      const shell = process.env.SHELL || '/bin/bash';
      return { command: shell, args: [] };
    }
    default: {
      const args: string[] = [];
      if (claudeSessionId) args.push('--session-id', claudeSessionId);
      if (prompt) args.push(prompt);
      return { command: 'claude', args };
    }
  }
}

function syncFeedbackDispatchStatus(sessionId: string, sessionStatus: string): void {
  try {
    const session = db
      .select({ feedbackId: schema.agentSessions.feedbackId })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.id, sessionId))
      .get();
    if (!session?.feedbackId) return;

    const latestSession = db
      .select({ id: schema.agentSessions.id })
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.feedbackId, session.feedbackId))
      .orderBy(desc(schema.agentSessions.createdAt))
      .limit(1)
      .get();
    if (!latestSession || latestSession.id !== sessionId) return;

    let dispatchStatus: string;
    if (sessionStatus === 'completed') dispatchStatus = 'completed';
    else if (sessionStatus === 'killed') dispatchStatus = 'killed';
    else dispatchStatus = 'failed';

    db.update(schema.feedbackItems)
      .set({ dispatchStatus, updatedAt: new Date().toISOString() })
      .where(eq(schema.feedbackItems.id, session.feedbackId))
      .run();
  } catch {
    // best-effort
  }
}

function flushOutput(sessionId: string): void {
  const proc = activeSessions.get(sessionId);
  if (!proc) return;

  db.update(schema.agentSessions)
    .set({
      outputLog: proc.outputBuffer.slice(-MAX_OUTPUT_LOG),
      outputBytes: proc.totalBytes,
      lastOutputSeq: proc.outputSeq,
    })
    .where(eq(schema.agentSessions.id, sessionId))
    .run();
}

function sendSequenced(proc: AgentProcess, content: SessionOutputData): void {
  proc.outputSeq++;
  const msg: SequencedOutput = {
    type: 'sequenced_output',
    sessionId: proc.sessionId,
    seq: proc.outputSeq,
    content,
    timestamp: new Date().toISOString(),
  };

  const serialized = JSON.stringify(msg);

  messageBuffer.append(proc.sessionId, 'output', proc.outputSeq, serialized);

  for (const ws of proc.adminSockets) {
    try {
      ws.send(serialized);
    } catch {
      proc.adminSockets.delete(ws);
    }
  }
}

function spawnSession(params: {
  sessionId: string;
  prompt?: string;
  cwd: string;
  permissionProfile: PermissionProfile;
  allowedTools?: string | null;
  claudeSessionId?: string;
  resumeSessionId?: string;
}): void {
  const { sessionId, prompt = '', cwd, permissionProfile, allowedTools, claudeSessionId, resumeSessionId } = params;

  if (activeSessions.has(sessionId)) {
    throw new Error(`Session ${sessionId} is already running`);
  }

  const { command, args } = buildClaudeArgs(
    prompt,
    permissionProfile,
    allowedTools,
    claudeSessionId,
    resumeSessionId,
  );

  const useTmux = isTmuxAvailable();
  console.log(`[session-service] Spawning session ${sessionId}: profile=${permissionProfile}, cwd=${cwd}, tmux=${useTmux}`);

  let ptyProcess: pty.IPty;
  let tmuxSessionName: string | null = null;

  if (useTmux) {
    const result = spawnInTmux({
      sessionId,
      command,
      args,
      cwd,
      cols: 120,
      rows: 40,
    });
    ptyProcess = result.ptyProcess;
    tmuxSessionName = result.tmuxSessionName;
  } else {
    ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });
  }

  const proc: AgentProcess = {
    sessionId,
    ptyProcess,
    outputBuffer: '',
    totalBytes: 0,
    outputSeq: 0,
    lastInputAckSeq: 0,
    adminSockets: new Set(),
    status: 'running',
    flushTimer: setInterval(() => flushOutput(sessionId), FLUSH_INTERVAL),
    waitingForInput: false,
    bytesSinceBell: 0,
    bellClearAfter: 0,
    hasStarted: false,
  };

  activeSessions.set(sessionId, proc);

  // Attach any WS connections that arrived before the PTY was ready
  const pending = pendingConnections.get(sessionId);
  if (pending) {
    for (const ws of pending) {
      if (ws.readyState === WebSocket.OPEN) {
        proc.adminSockets.add(ws);
      }
    }
    pendingConnections.delete(sessionId);
  }

  const now = new Date().toISOString();
  db.update(schema.agentSessions)
    .set({
      status: 'running',
      pid: ptyProcess.pid,
      startedAt: now,
      ...(tmuxSessionName ? { tmuxSessionName } : {}),
    })
    .where(eq(schema.agentSessions.id, sessionId))
    .run();

  ptyProcess.onData((data: string) => {
    proc.outputBuffer += data;
    proc.totalBytes += Buffer.byteLength(data);

    if (proc.outputBuffer.length > MAX_OUTPUT_LOG) {
      proc.outputBuffer = proc.outputBuffer.slice(-MAX_OUTPUT_LOG);
    }

    if (!proc.hasStarted && proc.totalBytes > 100) {
      proc.hasStarted = true;
    }

    // Bell detection: Claude Code emits \a when waiting for input
    if (data.includes('\x07')) {
      if (!proc.waitingForInput) {
        proc.waitingForInput = true;
        proc.bytesSinceBell = 0;
        proc.bellClearAfter = 0;
        sendSequenced(proc, { kind: 'waiting_state', waiting: true });
      }
    } else if (proc.waitingForInput && Date.now() >= proc.bellClearAfter) {
      const visible = data.replace(ANSI_RE, '').length;
      proc.bytesSinceBell += visible;
      if (proc.bytesSinceBell >= BELL_CLEAR_THRESHOLD) {
        proc.waitingForInput = false;
        proc.bytesSinceBell = 0;
        sendSequenced(proc, { kind: 'waiting_state', waiting: false });
      }
    }

    sendSequenced(proc, { kind: 'output', data });
  });

  ptyProcess.onExit(({ exitCode }) => {
    // If already killed, killSessionProcess handled cleanup
    if (proc.status === 'killed') return;

    proc.status = exitCode === 0 ? 'completed' : 'failed';
    clearInterval(proc.flushTimer);

    sendSequenced(proc, { kind: 'exit', exitCode, status: proc.status });

    const completedAt = new Date().toISOString();
    db.update(schema.agentSessions)
      .set({
        status: proc.status,
        exitCode: exitCode,
        outputLog: proc.outputBuffer.slice(-MAX_OUTPUT_LOG),
        outputBytes: proc.totalBytes,
        lastOutputSeq: proc.outputSeq,
        completedAt,
      })
      .where(eq(schema.agentSessions.id, sessionId))
      .run();

    syncFeedbackDispatchStatus(sessionId, proc.status);
    activeSessions.delete(sessionId);
  });

  // Schedule startup health check for Claude sessions
  if (permissionProfile !== 'plain') {
    scheduleStartupCheck(sessionId);
  }
}

const STARTUP_CHECK_DELAY = 45_000; // 45 seconds

function isSessionHealthy(proc: AgentProcess): boolean {
  // Strip ANSI escape sequences to get visible text
  const visible = proc.outputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  if (visible.length > 200) return true;
  if (/Claude|>|Type your/i.test(visible)) return true;
  return false;
}

function scheduleStartupCheck(sessionId: string): void {
  setTimeout(() => {
    const proc = activeSessions.get(sessionId);
    if (!proc || proc.status !== 'running') return;

    if (!isSessionHealthy(proc)) {
      console.log(`[session-service] Startup check failed for ${sessionId}: ${proc.totalBytes} bytes, no meaningful output — killing`);
      killSessionProcess(sessionId);
    } else {
      console.log(`[session-service] Startup check passed for ${sessionId}: ${proc.totalBytes} bytes`);
    }
  }, STARTUP_CHECK_DELAY);
}

function killSessionProcess(sessionId: string): boolean {
  const proc = activeSessions.get(sessionId);
  if (!proc || proc.status !== 'running') return false;

  proc.status = 'killed';
  proc.ptyProcess.kill();
  killTmuxSession(sessionId);
  clearInterval(proc.flushTimer);
  sendSequenced(proc, { kind: 'exit', exitCode: -1, status: 'killed' });

  const now = new Date().toISOString();
  db.update(schema.agentSessions)
    .set({
      status: 'killed',
      outputLog: proc.outputBuffer.slice(-MAX_OUTPUT_LOG),
      outputBytes: proc.totalBytes,
      lastOutputSeq: proc.outputSeq,
      completedAt: now,
    })
    .where(eq(schema.agentSessions.id, sessionId))
    .run();

  syncFeedbackDispatchStatus(sessionId, 'killed');
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

function tryRecoverSession(session: typeof schema.agentSessions.$inferSelect): boolean {
  if (!isTmuxAvailable() || !tmuxSessionExists(session.id)) return false;

  try {
    console.log(`[session-service] Late-recovering tmux session: ${session.id}`);
    const captured = captureTmuxPane(session.id);
    const ptyProcess = reattachTmux({ sessionId: session.id, cols: 120, rows: 40 });

    // Seed waiting state from visible pane content
    const isWaiting = captured ? looksLikePrompt(captured) : false;

    const proc: AgentProcess = {
      sessionId: session.id,
      ptyProcess,
      outputBuffer: captured || session.outputLog || '',
      totalBytes: session.outputBytes || 0,
      outputSeq: session.lastOutputSeq || 0,
      lastInputAckSeq: session.lastInputSeq || 0,
      adminSockets: new Set(),
      status: 'running',
      flushTimer: setInterval(() => flushOutput(session.id), FLUSH_INTERVAL),
      waitingForInput: isWaiting,
      bytesSinceBell: 0,
      bellClearAfter: isWaiting ? Date.now() + 3000 : 0, // ignore reattach dump
      hasStarted: (session.outputBytes || 0) > 100,
    };
    activeSessions.set(session.id, proc);

    // Restore DB status to running (may have been wrongly marked as failed)
    db.update(schema.agentSessions)
      .set({ status: 'running', completedAt: null })
      .where(eq(schema.agentSessions.id, session.id))
      .run();

    ptyProcess.onData((data: string) => {
      proc.outputBuffer += data;
      proc.totalBytes += Buffer.byteLength(data);
      if (proc.outputBuffer.length > MAX_OUTPUT_LOG) {
        proc.outputBuffer = proc.outputBuffer.slice(-MAX_OUTPUT_LOG);
      }
      if (!proc.hasStarted && proc.totalBytes > 100) proc.hasStarted = true;

      if (data.includes('\x07')) {
        if (!proc.waitingForInput) {
          proc.waitingForInput = true;
          proc.bytesSinceBell = 0;
          proc.bellClearAfter = 0;
          sendSequenced(proc, { kind: 'waiting_state', waiting: true });
        }
      } else if (proc.waitingForInput && Date.now() >= proc.bellClearAfter) {
        const visible = data.replace(ANSI_RE, '').length;
        proc.bytesSinceBell += visible;
        if (proc.bytesSinceBell >= BELL_CLEAR_THRESHOLD) {
          proc.waitingForInput = false;
          proc.bytesSinceBell = 0;
          sendSequenced(proc, { kind: 'waiting_state', waiting: false });
        }
      }

      sendSequenced(proc, { kind: 'output', data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (proc.status === 'killed') return;

      proc.status = exitCode === 0 ? 'completed' : 'failed';
      clearInterval(proc.flushTimer);
      sendSequenced(proc, { kind: 'exit', exitCode, status: proc.status });
      const completedAt = new Date().toISOString();
      db.update(schema.agentSessions)
        .set({
          status: proc.status,
          exitCode,
          outputLog: proc.outputBuffer.slice(-MAX_OUTPUT_LOG),
          outputBytes: proc.totalBytes,
          lastOutputSeq: proc.outputSeq,
          completedAt,
        })
        .where(eq(schema.agentSessions.id, session.id))
        .run();
      syncFeedbackDispatchStatus(session.id, proc.status);
      activeSessions.delete(session.id);
    });

    console.log(`[session-service] Late-recovered session ${session.id} from tmux`);
    return true;
  } catch (err) {
    console.error(`[session-service] Failed to late-recover session ${session.id}:`, err);
    return false;
  }
}

function markSessionStale(sessionId: string): void {
  const now = new Date().toISOString();
  db.update(schema.agentSessions)
    .set({ status: 'failed', completedAt: now })
    .where(eq(schema.agentSessions.id, sessionId))
    .run();
}

function attachAdminSocket(sessionId: string, ws: WebSocket): boolean {
  const proc = activeSessions.get(sessionId);
  if (proc) {
    // Send full history + lastInputAckSeq so client can resume its counter
    ws.send(JSON.stringify({ type: 'history', data: proc.outputBuffer, lastInputAckSeq: proc.lastInputAckSeq, waitingForInput: proc.waitingForInput }));
    proc.adminSockets.add(ws);
    return true;
  }

  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, sessionId))
    .get();
  if (session) {
    if (session.status === 'pending') {
      ws.send(JSON.stringify({ type: 'history', data: '' }));
      if (!pendingConnections.has(sessionId)) {
        pendingConnections.set(sessionId, new Set());
      }
      pendingConnections.get(sessionId)!.add(ws);
      return true;
    }

    if (session.status === 'running') {
      // DB says running but not in activeSessions — try tmux recovery
      if (tryRecoverSession(session)) {
        const recovered = activeSessions.get(sessionId)!;
        ws.send(JSON.stringify({ type: 'history', data: recovered.outputBuffer }));
        recovered.adminSockets.add(ws);
        return true;
      }
      // Recovery failed — mark as stale and inform client
      markSessionStale(sessionId);
      ws.send(JSON.stringify({ type: 'history', data: session.outputLog || '' }));
      ws.send(JSON.stringify({
        type: 'exit',
        exitCode: -1,
        status: 'failed',
      }));
      return true;
    }

    // Completed/failed/killed — send history + exit
    ws.send(JSON.stringify({ type: 'history', data: session.outputLog || '' }));
    ws.send(JSON.stringify({
      type: 'exit',
      exitCode: session.exitCode,
      status: session.status,
    }));
    return true;
  }

  return false;
}

function handleReplayRequest(sessionId: string, fromSeq: number, ws: WebSocket): void {
  const unacked = messageBuffer.getUnacked(sessionId, 'output', fromSeq);
  for (const entry of unacked) {
    try {
      ws.send(entry.content);
    } catch {
      break;
    }
  }
}

function detachAdminSocket(sessionId: string, ws: WebSocket): void {
  const proc = activeSessions.get(sessionId);
  if (proc) {
    proc.adminSockets.delete(ws);
  }
  const pending = pendingConnections.get(sessionId);
  if (pending) {
    pending.delete(ws);
    if (pending.size === 0) pendingConnections.delete(sessionId);
  }
}

// ---------- Session recovery ----------

function recoverTmuxSessions(): void {
  if (!isTmuxAvailable()) {
    db.update(schema.agentSessions)
      .set({ status: 'failed', completedAt: new Date().toISOString() })
      .where(eq(schema.agentSessions.status, 'running'))
      .run();
    return;
  }

  // Recover sessions marked as running
  const runningSessions = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.status, 'running'))
    .all();

  for (const session of runningSessions) {
    if (!tryRecoverSession(session)) {
      console.log(`[session-service] tmux session gone for ${session.id}, marking failed`);
      markSessionStale(session.id);
    }
  }

  // Also recover sessions wrongly marked as failed that still have live tmux sessions
  const liveTmuxIds = listPwTmuxSessions();
  if (liveTmuxIds.length === 0) return;

  const alreadyRecovered = new Set(activeSessions.keys());
  const candidates = liveTmuxIds.filter(id => !alreadyRecovered.has(id));
  if (candidates.length === 0) return;

  const failedSessions = db
    .select()
    .from(schema.agentSessions)
    .where(inArray(schema.agentSessions.id, candidates))
    .all()
    .filter(s => s.status === 'failed');

  for (const session of failedSessions) {
    console.log(`[session-service] Recovering wrongly-failed session ${session.id} (tmux still alive)`);
    tryRecoverSession(session);
  }
}

// ---------- HTTP API ----------

const app = new Hono();

app.get('/health', (c) => {
  return c.json({
    ok: true,
    tmux: isTmuxAvailable(),
    activeSessions: activeSessions.size,
    sessions: Array.from(activeSessions.keys()),
  });
});

app.post('/spawn', async (c) => {
  const body = await c.req.json();
  const { sessionId, prompt, cwd, permissionProfile, allowedTools, claudeSessionId, resumeSessionId } = body;

  if (!sessionId || !cwd || !permissionProfile) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  if (permissionProfile !== 'plain' && !prompt && !resumeSessionId) {
    return c.json({ error: 'Prompt required for non-plain sessions' }, 400);
  }

  try {
    spawnSession({ sessionId, prompt, cwd, permissionProfile, allowedTools, claudeSessionId, resumeSessionId });
    return c.json({ ok: true, sessionId });
  } catch (err) {
    const pending = pendingConnections.get(sessionId);
    if (pending) {
      for (const ws of pending) {
        try {
          ws.send(JSON.stringify({ type: 'exit', exitCode: -1, status: 'failed' }));
        } catch { /* ignore */ }
      }
      pendingConnections.delete(sessionId);
    }
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
    return c.json({
      status: proc.status,
      active: true,
      outputSeq: proc.outputSeq,
      totalBytes: proc.totalBytes,
      healthy: isSessionHealthy(proc),
      waitingForInput: proc.waitingForInput,
    });
  }
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get();
  if (session) {
    return c.json({
      status: session.status,
      active: false,
      outputSeq: session.lastOutputSeq,
      totalBytes: session.outputBytes || 0,
      healthy: session.status === 'running' ? false : null,
    });
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
        // Legacy messages
        case 'input':
          writeToSession(sessionId, msg.data);
          break;
        case 'resize':
          resizeSessionProcess(sessionId, msg.cols, msg.rows);
          break;
        case 'kill':
          killSessionProcess(sessionId);
          break;

        // Sequenced protocol messages
        case 'sequenced_input': {
          const proc = activeSessions.get(sessionId);
          if (!proc) break;
          // Dedup: only process if seq is new
          if (msg.seq > proc.lastInputAckSeq) {
            proc.lastInputAckSeq = msg.seq;
            const content = msg.content;
            if (content.kind === 'input' && content.data) {
              writeToSession(sessionId, content.data);
            } else if (content.kind === 'resize' && content.cols && content.rows) {
              resizeSessionProcess(sessionId, content.cols, content.rows);
            } else if (content.kind === 'kill') {
              killSessionProcess(sessionId);
            }
          }
          // Always send ack
          ws.send(JSON.stringify({
            type: 'input_ack',
            sessionId,
            ackSeq: msg.seq,
          }));
          break;
        }

        case 'output_ack':
          messageBuffer.ack(sessionId, 'output', msg.ackSeq);
          break;

        case 'replay_request':
          handleReplayRequest(sessionId, msg.fromSeq, ws);
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

recoverTmuxSessions();

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
    clearInterval(proc.flushTimer);
    flushOutput(sessionId);
    if (isTmuxAvailable() && tmuxSessionExists(sessionId)) {
      console.log(`[session-service] Detaching tmux session ${sessionId} (preserved)`);
      detachTmuxClients(sessionId);
      try { proc.ptyProcess.kill(); } catch { /* tmux client process */ }
    } else {
      console.log(`[session-service] Killing session ${sessionId}`);
      try { proc.ptyProcess.kill(); } catch { /* already dead */ }
    }
  }
  messageBuffer.destroy();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
