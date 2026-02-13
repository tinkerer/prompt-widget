import { WebSocket as WsWebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import type { PermissionProfile } from '@prompt-widget/shared';
import {
  spawnSessionRemote,
  killSessionRemote,
  getSessionServiceWsUrl,
} from './session-service-client.js';

const adminBridges = new Map<WsWebSocket, WsWebSocket>();

export async function spawnAgentSession(params: {
  sessionId: string;
  prompt: string;
  cwd: string;
  permissionProfile: PermissionProfile;
  allowedTools?: string | null;
  resume?: boolean;
}): Promise<void> {
  await spawnSessionRemote(params);
}

export function attachAdmin(sessionId: string, ws: WsWebSocket): boolean {
  const serviceWsUrl = getSessionServiceWsUrl(sessionId);
  const serviceWs = new WsWebSocket(serviceWsUrl);

  let connected = false;

  serviceWs.on('open', () => {
    connected = true;
    adminBridges.set(ws, serviceWs);
  });

  serviceWs.on('message', (raw) => {
    try {
      ws.send(raw.toString());
    } catch {
      serviceWs.close();
    }
  });

  serviceWs.on('close', () => {
    adminBridges.delete(ws);
  });

  serviceWs.on('error', () => {
    adminBridges.delete(ws);
    if (!connected) {
      // Session service unreachable — fall back to DB for completed sessions
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
      } else {
        ws.close(4004, 'Session not found');
      }
    }
  });

  // Always return true — the bridge is async; if the session service rejects
  // it, the serviceWs close/error handlers will notify the admin WS.
  return true;
}

export function detachAdmin(_sessionId: string, ws: WsWebSocket): void {
  const serviceWs = adminBridges.get(ws);
  if (serviceWs) {
    serviceWs.close();
    adminBridges.delete(ws);
  }
}

export function forwardToService(ws: WsWebSocket, data: string): void {
  const serviceWs = adminBridges.get(ws);
  if (serviceWs && serviceWs.readyState === WsWebSocket.OPEN) {
    serviceWs.send(data);
  }
}

export async function killSession(sessionId: string): Promise<boolean> {
  try {
    const killed = await killSessionRemote(sessionId);
    if (killed) return true;
  } catch {
    // Session service unreachable — fall through to local DB update
  }

  // Fallback: mark killed directly in DB (session process may be orphaned/dead)
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, sessionId))
    .get();

  if (!session || (session.status !== 'running' && session.status !== 'pending')) {
    return false;
  }

  db.update(schema.agentSessions)
    .set({
      status: 'killed',
      completedAt: new Date().toISOString(),
    })
    .where(eq(schema.agentSessions.id, sessionId))
    .run();

  return true;
}

export function cleanupOrphanedSessions(): void {
  db.update(schema.agentSessions)
    .set({ status: 'failed', completedAt: new Date().toISOString() })
    .where(eq(schema.agentSessions.status, 'running'))
    .run();
}

export function getSessionStatus(sessionId: string): string | null {
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, sessionId))
    .get();
  return session?.status || null;
}
