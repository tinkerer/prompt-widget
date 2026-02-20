import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { eq } from 'drizzle-orm';
import { app } from './app.js';
import { runMigrations, db, schema } from './db/index.js';
import { registerSession } from './sessions.js';
import { verifyAdminToken } from './auth.js';
import {
  attachAdmin,
  detachAdmin,
  forwardToService,
  broadcastToLauncherSessionAdmins,
  cleanupOrphanedSessions,
} from './agent-sessions.js';
import {
  registerLauncher,
  unregisterLauncher,
  updateHeartbeat,
  removeSessionFromLauncher,
  startPruneTimer,
  stopPruneTimer,
} from './launcher-registry.js';
import type { LauncherToServerMessage, LauncherRegistered } from '@prompt-widget/shared';

const PORT = parseInt(process.env.PORT || '3001', 10);
const LAUNCHER_AUTH_TOKEN = process.env.LAUNCHER_AUTH_TOKEN || '';

runMigrations();
startPruneTimer();

// Delay orphan cleanup so the session-service has time to recover tmux sessions
setTimeout(() => {
  cleanupOrphanedSessions().catch(err => {
    console.error('Failed to cleanup orphaned sessions:', err);
  });
}, 10_000);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  const url = `http://localhost:${info.port}`;
  console.log(`Server running on ${url}`);
  console.log('');
  console.log('━━━ Copy this into your Claude Code session ━━━');
  console.log('');
  console.log(`Read ${url}/GETTING_STARTED.md — it has everything you need to register an app, create an agent endpoint, and embed the widget.`);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

// Widget session WebSocket
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get('sessionId');
  const apiKey = url.searchParams.get('apiKey');

  if (!sessionId) {
    ws.close(4001, 'Missing sessionId');
    return;
  }

  let appId: string | undefined;
  let screenshotIncludeWidget = false;
  if (apiKey) {
    const application = db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.apiKey, apiKey))
      .get();
    if (application) {
      appId = application.id;
      screenshotIncludeWidget = !!application.screenshotIncludeWidget;
    }
  }

  ws.send(JSON.stringify({ type: 'config', screenshotIncludeWidget }));

  const session = registerSession(sessionId, ws, {
    userAgent: req.headers['user-agent'],
    appId,
  });

  console.log(`Session connected: ${sessionId}${appId ? ` (app: ${appId})` : ''}`);

  ws.on('close', () => {
    console.log(`Session disconnected: ${sessionId}`);
  });
});

// Agent session WebSocket — auth here, then bridge to session service
const agentWss = new WebSocketServer({ noServer: true });

agentWss.on('connection', async (ws, req) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get('sessionId');
  const token = url.searchParams.get('token');

  if (!sessionId || !token) {
    ws.close(4001, 'Missing sessionId or token');
    return;
  }

  const isValid = await verifyAdminToken(token);
  if (!isValid) {
    ws.close(4003, 'Invalid token');
    return;
  }

  const attached = attachAdmin(sessionId, ws);
  if (!attached) {
    ws.close(4004, 'Session not found');
    return;
  }

  console.log(`Admin attached to agent session: ${sessionId}`);

  ws.on('message', (raw) => {
    forwardToService(ws, raw.toString());
  });

  ws.on('close', () => {
    detachAdmin(sessionId, ws);
    console.log(`Admin detached from agent session: ${sessionId}`);
  });
});

// Launcher WebSocket — launcher daemons connect here
const launcherWss = new WebSocketServer({ noServer: true });

launcherWss.on('connection', (ws, req) => {
  let launcherId: string | null = null;

  ws.on('message', (raw) => {
    try {
      const msg: LauncherToServerMessage = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'launcher_register': {
          if (LAUNCHER_AUTH_TOKEN && msg.authToken !== LAUNCHER_AUTH_TOKEN) {
            const reply: LauncherRegistered = { type: 'launcher_registered', ok: false, error: 'Invalid auth token' };
            ws.send(JSON.stringify(reply));
            ws.close(4003, 'Invalid auth token');
            return;
          }
          launcherId = msg.id;
          registerLauncher({
            id: msg.id,
            name: msg.name,
            hostname: msg.hostname,
            ws,
            connectedAt: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
            activeSessions: new Set(),
            capabilities: msg.capabilities,
          });
          const reply: LauncherRegistered = { type: 'launcher_registered', ok: true };
          ws.send(JSON.stringify(reply));
          break;
        }

        case 'launcher_heartbeat':
          if (launcherId) {
            updateHeartbeat(launcherId, msg.activeSessions);
          }
          break;

        case 'launcher_session_started': {
          const now = new Date().toISOString();
          db.update(schema.agentSessions)
            .set({
              status: 'running',
              pid: msg.pid,
              startedAt: now,
              ...(msg.tmuxSessionName ? { tmuxSessionName: msg.tmuxSessionName } : {}),
            })
            .where(eq(schema.agentSessions.id, msg.sessionId))
            .run();
          break;
        }

        case 'launcher_session_output': {
          const output = msg.output;
          broadcastToLauncherSessionAdmins(msg.sessionId, JSON.stringify(output));

          // Also accumulate in DB
          if (output.content?.data) {
            const session = db
              .select()
              .from(schema.agentSessions)
              .where(eq(schema.agentSessions.id, msg.sessionId))
              .get();
            if (session) {
              const existing = session.outputLog || '';
              const updated = (existing + output.content.data).slice(-500 * 1024);
              db.update(schema.agentSessions)
                .set({
                  outputLog: updated,
                  outputBytes: (session.outputBytes || 0) + Buffer.byteLength(output.content.data),
                  lastOutputSeq: output.seq,
                })
                .where(eq(schema.agentSessions.id, msg.sessionId))
                .run();
            }
          }
          break;
        }

        case 'launcher_session_ended': {
          const completedAt = new Date().toISOString();
          db.update(schema.agentSessions)
            .set({
              status: msg.status,
              exitCode: msg.exitCode,
              outputLog: msg.outputLog.slice(-500 * 1024),
              completedAt,
            })
            .where(eq(schema.agentSessions.id, msg.sessionId))
            .run();

          if (launcherId) {
            removeSessionFromLauncher(launcherId, msg.sessionId);
          }

          broadcastToLauncherSessionAdmins(msg.sessionId, JSON.stringify({
            type: 'exit',
            exitCode: msg.exitCode,
            status: msg.status,
          }));
          break;
        }
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (launcherId) {
      unregisterLauncher(launcherId);
    }
  });

  ws.on('error', () => {
    if (launcherId) {
      unregisterLauncher(launcherId);
    }
  });
});

// Route upgrades to appropriate WebSocket server
(server as unknown as Server).on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname === '/ws/agent-session') {
    agentWss.handleUpgrade(req, socket, head, (ws) => {
      agentWss.emit('connection', ws, req);
    });
  } else if (url.pathname === '/ws/launcher') {
    launcherWss.handleUpgrade(req, socket, head, (ws) => {
      launcherWss.emit('connection', ws, req);
    });
  } else if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

process.on('SIGTERM', () => { stopPruneTimer(); process.exit(0); });
process.on('SIGINT', () => { stopPruneTimer(); process.exit(0); });
