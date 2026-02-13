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
  cleanupOrphanedSessions,
} from './agent-sessions.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

runMigrations();
cleanupOrphanedSessions();

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
  if (apiKey) {
    const application = db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.apiKey, apiKey))
      .get();
    if (application) {
      appId = application.id;
    }
  }

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

// Route upgrades to appropriate WebSocket server
(server as unknown as Server).on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname === '/ws/agent-session') {
    agentWss.handleUpgrade(req, socket, head, (ws) => {
      agentWss.emit('connection', ws, req);
    });
  } else if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});
