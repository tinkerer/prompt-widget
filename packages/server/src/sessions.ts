import { WebSocket } from 'ws';
import { ulid } from 'ulidx';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface SessionInfo {
  sessionId: string;
  ws: WebSocket;
  connectedAt: string;
  lastActivity: string;
  userAgent: string | null;
  url: string | null;
  userId: string | null;
  viewport: string | null;
  pendingRequests: Map<string, PendingRequest>;
}

const sessions = new Map<string, SessionInfo>();

const REQUEST_TIMEOUT = 15_000;

export function registerSession(sessionId: string, ws: WebSocket, meta: { userAgent?: string; url?: string; userId?: string; viewport?: string }) {
  const existing = sessions.get(sessionId);
  if (existing && existing.ws.readyState === WebSocket.OPEN) {
    existing.ws.close(1000, 'replaced');
  }

  const session: SessionInfo = {
    sessionId,
    ws,
    connectedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    userAgent: meta.userAgent || null,
    url: meta.url || null,
    userId: meta.userId || null,
    viewport: meta.viewport || null,
    pendingRequests: new Map(),
  };

  sessions.set(sessionId, session);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      session.lastActivity = new Date().toISOString();

      if (msg.type === 'response' && msg.requestId) {
        const pending = session.pendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          session.pendingRequests.delete(msg.requestId);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.data);
          }
        }
      }

      if (msg.type === 'meta') {
        if (msg.url) session.url = msg.url;
        if (msg.viewport) session.viewport = msg.viewport;
        if (msg.userId) session.userId = msg.userId;
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    const current = sessions.get(sessionId);
    if (current && current.ws === ws) {
      for (const [, pending] of current.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Session disconnected'));
      }
      sessions.delete(sessionId);
    }
  });

  return session;
}

export function getSession(sessionId: string): SessionInfo | undefined {
  const session = sessions.get(sessionId);
  if (session && session.ws.readyState !== WebSocket.OPEN) {
    sessions.delete(sessionId);
    return undefined;
  }
  return session;
}

export function listSessions(): Omit<SessionInfo, 'ws' | 'pendingRequests'>[] {
  const result: Omit<SessionInfo, 'ws' | 'pendingRequests'>[] = [];
  for (const [, session] of sessions) {
    if (session.ws.readyState === WebSocket.OPEN) {
      const { ws, pendingRequests, ...info } = session;
      result.push(info);
    }
  }
  return result;
}

export function sendCommand(sessionId: string, command: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const session = getSession(sessionId);
  if (!session) {
    return Promise.reject(new Error('Session not found or disconnected'));
  }

  const requestId = ulid();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.pendingRequests.delete(requestId);
      reject(new Error('Request timed out'));
    }, REQUEST_TIMEOUT);

    session.pendingRequests.set(requestId, { resolve, reject, timeout });

    session.ws.send(JSON.stringify({
      type: 'command',
      requestId,
      command,
      params,
    }));
  });
}
