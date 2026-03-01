import WebSocket from 'ws';
import * as os from 'node:os';
import * as pty from 'node-pty';
import { execSync } from 'node:child_process';
import type {
  LauncherRegister,
  LauncherHeartbeat,
  LauncherSessionStarted,
  LauncherSessionOutput,
  LauncherSessionEnded,
  HarnessStatusUpdate,
  ServerToLauncherMessage,
  LauncherCapabilities,
  SequencedOutput,
  SessionOutputData,
} from '@prompt-widget/shared';
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

const SERVER_WS_URL = process.env.SERVER_WS_URL || 'ws://localhost:3001/ws/launcher';
const LAUNCHER_ID = process.env.LAUNCHER_ID || `launcher-${os.hostname()}`;
const LAUNCHER_NAME = process.env.LAUNCHER_NAME || os.hostname();
const LAUNCHER_AUTH_TOKEN = process.env.LAUNCHER_AUTH_TOKEN || '';
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '5', 10);
const MACHINE_ID = process.env.MACHINE_ID || undefined;

const MAX_OUTPUT_LOG = 500 * 1024;

interface LocalSession {
  sessionId: string;
  ptyProcess: pty.IPty;
  outputBuffer: string;
  totalBytes: number;
  outputSeq: number;
  status: 'running' | 'completed' | 'failed' | 'killed';
}

const sessions = new Map<string, LocalSession>();

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let shuttingDown = false;

function buildClaudeArgs(
  prompt: string,
  permissionProfile: string,
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
      if (allowedTools) args.push('--allowedTools', allowedTools);
      if (prompt) args.push(prompt);
      return { command: 'claude', args };
    }
    case 'auto': {
      const args = ['-p', prompt];
      if (claudeSessionId) args.push('--session-id', claudeSessionId);
      if (allowedTools) args.push('--allowedTools', allowedTools);
      return { command: 'claude', args };
    }
    case 'yolo': {
      const args = ['-p', prompt, '--dangerously-skip-permissions'];
      if (claudeSessionId) args.push('--session-id', claudeSessionId);
      return { command: 'claude', args };
    }
    default: {
      const args: string[] = [];
      if (claudeSessionId) args.push('--session-id', claudeSessionId);
      if (prompt) args.push(prompt);
      return { command: 'claude', args };
    }
  }
}

function sendToServer(data: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendSequenced(session: LocalSession, content: SessionOutputData): void {
  session.outputSeq++;
  const msg: SequencedOutput = {
    type: 'sequenced_output',
    sessionId: session.sessionId,
    seq: session.outputSeq,
    content,
    timestamp: new Date().toISOString(),
  };

  const outMsg: LauncherSessionOutput = {
    type: 'launcher_session_output',
    sessionId: session.sessionId,
    output: msg,
  };
  sendToServer(outMsg);
}

function spawnSession(params: {
  sessionId: string;
  prompt: string;
  cwd: string;
  permissionProfile: string;
  allowedTools?: string | null;
  claudeSessionId?: string;
  resumeSessionId?: string;
  cols: number;
  rows: number;
}): void {
  const { sessionId, prompt, cwd, permissionProfile, allowedTools, claudeSessionId, resumeSessionId, cols, rows } = params;

  if (sessions.has(sessionId)) {
    console.log(`[launcher] Session ${sessionId} already running`);
    return;
  }

  const { command, args } = buildClaudeArgs(prompt, permissionProfile, allowedTools, claudeSessionId, resumeSessionId);
  const useTmux = isTmuxAvailable();

  console.log(`[launcher] Spawning session ${sessionId}: profile=${permissionProfile}, cwd=${cwd}, tmux=${useTmux}`);

  let ptyProcess: pty.IPty;
  let tmuxSessionName: string | undefined;

  if (useTmux) {
    const result = spawnInTmux({ sessionId, command, args, cwd, cols, rows });
    ptyProcess = result.ptyProcess;
    tmuxSessionName = result.tmuxSessionName;
  } else {
    ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });
  }

  const session: LocalSession = {
    sessionId,
    ptyProcess,
    outputBuffer: '',
    totalBytes: 0,
    outputSeq: 0,
    status: 'running',
  };
  sessions.set(sessionId, session);

  const started: LauncherSessionStarted = {
    type: 'launcher_session_started',
    sessionId,
    pid: ptyProcess.pid,
    tmuxSessionName,
  };
  sendToServer(started);

  ptyProcess.onData((data: string) => {
    session.outputBuffer += data;
    session.totalBytes += Buffer.byteLength(data);
    if (session.outputBuffer.length > MAX_OUTPUT_LOG) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_OUTPUT_LOG);
    }
    sendSequenced(session, { kind: 'output', data });
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.status = exitCode === 0 ? 'completed' : 'failed';
    sendSequenced(session, { kind: 'exit', exitCode, status: session.status });

    const ended: LauncherSessionEnded = {
      type: 'launcher_session_ended',
      sessionId,
      exitCode,
      status: session.status,
      outputLog: session.outputBuffer.slice(-MAX_OUTPUT_LOG),
    };
    sendToServer(ended);
    sessions.delete(sessionId);
  });

}

function handleServerMessage(msg: ServerToLauncherMessage): void {
  switch (msg.type) {
    case 'launcher_registered':
      if (msg.ok) {
        console.log(`[launcher] Registered with server`);
      } else {
        console.error(`[launcher] Registration failed: ${msg.error}`);
      }
      break;

    case 'launch_session':
      spawnSession({
        sessionId: msg.sessionId,
        prompt: msg.prompt,
        cwd: msg.cwd,
        permissionProfile: msg.permissionProfile,
        allowedTools: msg.allowedTools,
        claudeSessionId: msg.claudeSessionId,
        resumeSessionId: msg.resumeSessionId,
        cols: msg.cols,
        rows: msg.rows,
      });
      break;

    case 'kill_session': {
      const session = sessions.get(msg.sessionId);
      if (session && session.status === 'running') {
        session.status = 'killed';
        session.ptyProcess.kill();
        killTmuxSession(msg.sessionId);
      }
      break;
    }

    case 'resize_session': {
      const session = sessions.get(msg.sessionId);
      if (session && session.status === 'running') {
        session.ptyProcess.resize(msg.cols, msg.rows);
      }
      break;
    }

    case 'input_to_session': {
      const session = sessions.get(msg.sessionId);
      if (!session || session.status !== 'running') break;
      const input = msg.input;
      if ('data' in input && input.data) {
        session.ptyProcess.write(input.data);
      } else if ('content' in input) {
        const content = input.content;
        if (content.kind === 'input' && content.data) {
          session.ptyProcess.write(content.data);
        } else if (content.kind === 'resize' && content.cols && content.rows) {
          session.ptyProcess.resize(content.cols, content.rows);
        } else if (content.kind === 'kill') {
          session.status = 'killed';
          session.ptyProcess.kill();
          killTmuxSession(msg.sessionId);
        }
      }
      break;
    }

    case 'start_harness': {
      console.log(`[launcher] Starting harness ${msg.harnessConfigId}`);
      try {
        // Build env vars for docker compose
        const env: Record<string, string> = { ...msg.envVars };
        if (msg.appImage) env.APP_IMAGE = msg.appImage;
        if (msg.appPort) env.APP_PORT = String(msg.appPort);
        if (msg.appInternalPort) env.APP_INTERNAL_PORT = String(msg.appInternalPort);
        if (msg.serverPort) env.SERVER_PORT = String(msg.serverPort);
        if (msg.browserMcpPort) env.BROWSER_MCP_PORT = String(msg.browserMcpPort);
        if (msg.targetAppUrl) env.TARGET_APP_URL = msg.targetAppUrl;
        env.HARNESS_CONFIG_ID = msg.harnessConfigId;

        const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ');
        const cwd = msg.composeDir || undefined;
        execSync(`${envStr} docker compose up -d`, { stdio: 'pipe', timeout: 300_000, cwd });

        const status: HarnessStatusUpdate = {
          type: 'harness_status',
          harnessConfigId: msg.harnessConfigId,
          status: 'running',
        };
        sendToServer(status);
      } catch (err: any) {
        console.error(`[launcher] Failed to start harness:`, err.message);
        const status: HarnessStatusUpdate = {
          type: 'harness_status',
          harnessConfigId: msg.harnessConfigId,
          status: 'error',
          errorMessage: err.message?.slice(0, 500),
        };
        sendToServer(status);
      }
      break;
    }

    case 'stop_harness': {
      console.log(`[launcher] Stopping harness ${msg.harnessConfigId}`);
      try {
        const cwd = msg.composeDir || undefined;
        execSync('docker compose down', { stdio: 'pipe', timeout: 60_000, cwd });
        const status: HarnessStatusUpdate = {
          type: 'harness_status',
          harnessConfigId: msg.harnessConfigId,
          status: 'stopped',
        };
        sendToServer(status);
      } catch (err: any) {
        console.error(`[launcher] Failed to stop harness:`, err.message);
      }
      break;
    }
  }
}

function connect(): void {
  if (shuttingDown) return;

  console.log(`[launcher] Connecting to ${SERVER_WS_URL}...`);
  ws = new WebSocket(SERVER_WS_URL);

  ws.on('open', () => {
    reconnectDelay = 1000;
    console.log(`[launcher] Connected, registering as ${LAUNCHER_ID}`);

    let hasDocker = false;
    try { execSync('docker --version', { stdio: 'pipe' }); hasDocker = true; } catch {}

    const caps: LauncherCapabilities = {
      maxSessions: MAX_SESSIONS,
      hasTmux: isTmuxAvailable(),
      hasClaudeCli: true,
      hasDocker,
    };

    const reg: LauncherRegister = {
      type: 'launcher_register',
      id: LAUNCHER_ID,
      name: LAUNCHER_NAME,
      hostname: os.hostname(),
      authToken: LAUNCHER_AUTH_TOKEN,
      capabilities: caps,
      machineId: MACHINE_ID,
    };
    sendToServer(reg);

    heartbeatTimer = setInterval(() => {
      const hb: LauncherHeartbeat = {
        type: 'launcher_heartbeat',
        activeSessions: Array.from(sessions.keys()),
        timestamp: new Date().toISOString(),
      };
      sendToServer(hb);
    }, 30_000);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ServerToLauncherMessage;
      handleServerMessage(msg);
    } catch {}
  });

  ws.on('close', () => {
    ws = null;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (shuttingDown) return;

    console.log(`[launcher] Disconnected, reconnecting in ${reconnectDelay}ms...`);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      connect();
    }, reconnectDelay);
  });

  ws.on('error', (err) => {
    console.error(`[launcher] WebSocket error:`, err.message);
  });
}

function shutdown(): void {
  shuttingDown = true;
  console.log('[launcher] Shutting down...');

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);

  for (const [sessionId, session] of sessions) {
    if (isTmuxAvailable() && tmuxSessionExists(sessionId)) {
      console.log(`[launcher] Detaching tmux session ${sessionId} (preserved)`);
      detachTmuxClients(sessionId);
      try { session.ptyProcess.kill(); } catch {}
    } else {
      console.log(`[launcher] Killing session ${sessionId}`);
      try { session.ptyProcess.kill(); } catch {}
    }
  }

  if (ws) {
    try { ws.close(); } catch {}
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

connect();
console.log(`[launcher] Daemon started: id=${LAUNCHER_ID}, name=${LAUNCHER_NAME}`);
