import type { PermissionProfile } from '@prompt-widget/shared';

const SESSION_SERVICE_URL = process.env.SESSION_SERVICE_URL || 'http://localhost:3002';

export interface SpawnParams {
  sessionId: string;
  prompt?: string;
  cwd: string;
  permissionProfile: PermissionProfile;
  allowedTools?: string | null;
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${SESSION_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function spawnSessionRemote(params: SpawnParams): Promise<void> {
  const res = await post('/spawn', params);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((data as { error?: string }).error || `Spawn failed: ${res.status}`);
  }
}

export async function killSessionRemote(sessionId: string): Promise<boolean> {
  const res = await post(`/kill/${sessionId}`);
  return res.ok;
}

export async function resizeSessionRemote(sessionId: string, cols: number, rows: number): Promise<void> {
  await post(`/resize/${sessionId}`, { cols, rows });
}

export async function inputSessionRemote(sessionId: string, data: string): Promise<void> {
  await post(`/input/${sessionId}`, { data });
}

export async function getSessionServiceHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SESSION_SERVICE_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getSessionServiceActiveSessions(): Promise<string[] | null> {
  try {
    const res = await fetch(`${SESSION_SERVICE_URL}/health`);
    if (!res.ok) return null;
    const data = await res.json() as { sessions?: string[] };
    return data.sessions || [];
  } catch {
    return null;
  }
}

export function getSessionServiceWsUrl(sessionId: string): string {
  const wsBase = SESSION_SERVICE_URL.replace(/^http/, 'ws');
  return `${wsBase}/ws/agent-session?sessionId=${sessionId}`;
}
