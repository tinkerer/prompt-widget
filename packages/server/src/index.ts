import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { eq } from 'drizzle-orm';
import { app } from './app.js';
import { runMigrations, db, schema } from './db/index.js';
import { registerSession } from './sessions.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

runMigrations();

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});

const wss = new WebSocketServer({ server: server as unknown as Server, path: '/ws' });

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
