import type { WebSocket } from 'ws';
import type { LauncherCapabilities, HarnessMetadata } from '@prompt-widget/shared';

export interface LauncherInfo {
  id: string;
  name: string;
  hostname: string;
  ws: WebSocket;
  connectedAt: string;
  lastHeartbeat: string;
  activeSessions: Set<string>;
  capabilities: LauncherCapabilities;
  harness?: HarnessMetadata;
  isLocal?: boolean;
}

const launchers = new Map<string, LauncherInfo>();

let pruneTimer: ReturnType<typeof setInterval> | null = null;

export function registerLauncher(info: LauncherInfo): void {
  const existing = launchers.get(info.id);
  if (existing && existing.ws && existing.ws !== info.ws) {
    try { existing.ws.close(4010, 'Replaced by new connection'); } catch {}
  }
  launchers.set(info.id, info);
  console.log(`[launcher-registry] Registered: ${info.id} (${info.name}@${info.hostname})${info.harness ? ' [harness]' : ''}`);
}

export function unregisterLauncher(id: string): void {
  launchers.delete(id);
  console.log(`[launcher-registry] Unregistered: ${id}`);
}

export function getLauncher(id: string): LauncherInfo | undefined {
  return launchers.get(id);
}

export function listLaunchers(): LauncherInfo[] {
  return Array.from(launchers.values());
}

export function findAvailableLauncher(): LauncherInfo | undefined {
  let best: LauncherInfo | undefined;
  let bestLoad = Infinity;
  for (const launcher of launchers.values()) {
    if (launcher.isLocal) continue;
    if (launcher.ws.readyState !== 1) continue; // not OPEN
    const load = launcher.activeSessions.size;
    if (load < launcher.capabilities.maxSessions && load < bestLoad) {
      best = launcher;
      bestLoad = load;
    }
  }
  return best;
}

export function updateHeartbeat(id: string, activeSessions: string[]): void {
  const launcher = launchers.get(id);
  if (!launcher) return;
  launcher.lastHeartbeat = new Date().toISOString();
  launcher.activeSessions = new Set(activeSessions);
}

export function addSessionToLauncher(launcherId: string, sessionId: string): void {
  const launcher = launchers.get(launcherId);
  if (launcher) launcher.activeSessions.add(sessionId);
}

export function removeSessionFromLauncher(launcherId: string, sessionId: string): void {
  const launcher = launchers.get(launcherId);
  if (launcher) launcher.activeSessions.delete(sessionId);
}

export function pruneStaleLaunchers(): void {
  const cutoff = Date.now() - 90_000;
  for (const [id, launcher] of launchers) {
    if (launcher.isLocal) continue;
    const lastBeat = new Date(launcher.lastHeartbeat).getTime();
    if (lastBeat < cutoff) {
      console.log(`[launcher-registry] Pruning stale launcher: ${id}`);
      try { launcher.ws.close(4011, 'Stale heartbeat'); } catch {}
      launchers.delete(id);
    }
  }
}

export function startPruneTimer(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(pruneStaleLaunchers, 30_000);
}

export function stopPruneTimer(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

export function serializeLauncher(l: LauncherInfo) {
  return {
    id: l.id,
    name: l.name,
    hostname: l.hostname,
    connectedAt: l.connectedAt,
    lastHeartbeat: l.lastHeartbeat,
    activeSessions: Array.from(l.activeSessions),
    capabilities: l.capabilities,
    online: l.isLocal ? true : l.ws?.readyState === 1,
    isHarness: !!l.harness,
    harness: l.harness || null,
  };
}

export function listHarnesses(): LauncherInfo[] {
  return Array.from(launchers.values()).filter(l => !!l.harness);
}
