import { signal } from '@preact/signals';
import { api } from '../lib/api.js';

export interface DispatchTarget {
  launcherId: string;
  name: string;
  hostname: string;
  machineName: string | null;
  machineId: string | null;
  isHarness: boolean;
  harnessConfigId: string | null;
  activeSessions: number;
  maxSessions: number;
}

export const cachedTargets = signal<DispatchTarget[]>([]);
let lastFetch = 0;

export async function refreshTargets() {
  try {
    const { targets } = await api.getDispatchTargets();
    cachedTargets.value = targets;
    lastFetch = Date.now();
  } catch {
    // ignore — leave stale data
  }
}

export function ensureTargetsLoaded() {
  if (Date.now() - lastFetch > 10_000) refreshTargets();
}

export function DispatchTargetSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (launcherId: string | undefined) => void;
  className?: string;
}) {
  const targets = cachedTargets.value;

  if (targets.length === 0 && Date.now() - lastFetch > 10_000) {
    refreshTargets();
  }

  if (targets.length === 0) return null;

  const machines = targets.filter(t => !t.isHarness);
  const harnesses = targets.filter(t => t.isHarness);

  return (
    <select
      class={className || 'dispatch-bar-select'}
      value={value}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        onChange(v || undefined);
      }}
      onFocus={() => refreshTargets()}
    >
      <option value="">Local</option>
      {machines.length > 0 && (
        <optgroup label="Machines">
          {machines.map(t => (
            <option key={t.launcherId} value={t.launcherId}>
              {t.machineName || t.name} ({t.activeSessions}/{t.maxSessions})
            </option>
          ))}
        </optgroup>
      )}
      {harnesses.length > 0 && (
        <optgroup label="Harnesses">
          {harnesses.map(t => (
            <option key={t.launcherId} value={t.launcherId}>
              {t.name} ({t.activeSessions}/{t.maxSessions})
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
