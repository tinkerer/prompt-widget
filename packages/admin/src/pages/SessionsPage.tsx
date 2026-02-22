import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { api } from '../lib/api.js';
import { navigate, isEmbedded } from '../lib/state.js';
import { allSessions, openSession, closeTab, loadAllSessions, deleteSession, permanentlyDeleteSession, spawnTerminal, waitingSessions } from '../lib/sessions.js';

const filterStatus = signal('');
const feedbackMap = signal<Record<string, string>>({});
const agentMap = signal<Record<string, string>>({});
const agentAppMap = signal<Record<string, string | null>>({});
const mapsLoaded = signal(false);

async function loadMaps() {
  if (mapsLoaded.value) return;
  try {
    const [fbResult, agents] = await Promise.all([
      api.getFeedback({ limit: 200 }),
      api.getAgents(),
    ]);
    const fm: Record<string, string> = {};
    for (const fb of fbResult.items) {
      fm[fb.id] = fb.title || fb.id.slice(-8);
    }
    feedbackMap.value = fm;
    const am: Record<string, string> = {};
    const aam: Record<string, string | null> = {};
    for (const a of agents) {
      am[a.id] = a.name || a.id.slice(-8);
      aam[a.id] = a.appId || null;
    }
    agentMap.value = am;
    agentAppMap.value = aam;
    mapsLoaded.value = true;
  } catch {
    // ignore
  }
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const secs = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

async function permanentlyDelete(id: string) {
  if (!confirm('Permanently delete this session? This cannot be undone.')) return;
  await permanentlyDeleteSession(id);
}

async function permanentlyDeleteAll(ids: string[]) {
  if (!confirm(`Permanently delete ${ids.length} session(s)? This cannot be undone.`)) return;
  await Promise.all(ids.map((id) => permanentlyDeleteSession(id)));
}

export function SessionsPage({ appId }: { appId?: string | null }) {
  const autoTerminalDone = useRef(false);

  useEffect(() => {
    loadMaps();
    loadAllSessions(true);
    const id = setInterval(() => loadAllSessions(true), 5000);
    return () => clearInterval(id);
  }, []);

  const isAutoTerminal = isEmbedded.value && new URLSearchParams(window.location.search).get('autoTerminal') === '1';

  useEffect(() => {
    if (autoTerminalDone.current) return;
    if (isAutoTerminal) {
      autoTerminalDone.current = true;
      spawnTerminal(appId ?? null);
    }
  }, [appId]);

  if (isAutoTerminal) {
    return <div />;
  }

  const sessions = allSessions.value;

  let appFiltered = sessions;
  if (appId && appId !== '__unlinked__') {
    const appAgentIds = new Set(
      Object.entries(agentAppMap.value)
        .filter(([, aid]) => aid === appId)
        .map(([id]) => id)
    );
    appFiltered = sessions.filter((s) => s.agentEndpointId && appAgentIds.has(s.agentEndpointId));
  }

  const filtered = filterStatus.value
    ? appFiltered.filter((s) => s.status === filterStatus.value)
    : appFiltered.filter((s) => s.status !== 'deleted');

  const sorted = [...filtered].sort((a, b) => {
    const statusOrder = (s: string) =>
      s === 'running' ? 0 : s === 'pending' ? 1 : 2;
    const diff = statusOrder(a.status) - statusOrder(b.status);
    if (diff !== 0) return diff;
    return new Date(b.startedAt || b.createdAt || 0).getTime() -
      new Date(a.startedAt || a.createdAt || 0).getTime();
  });

  const statusCounts = appFiltered.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  const feedbackPath = appId ? `/app/${appId}/feedback` : '/feedback';

  return (
    <div>
      <div class="page-header">
        <h2>Sessions ({appFiltered.length})</h2>
        <button class="btn btn-sm" onClick={() => spawnTerminal(appId)}>
          Open Terminal
        </button>
      </div>

      <div class="sessions-page-filters">
        <select
          value={filterStatus.value}
          onChange={(e) => { filterStatus.value = (e.target as HTMLSelectElement).value; }}
        >
          <option value="">All statuses</option>
          <option value="running">Running{statusCounts.running ? ` (${statusCounts.running})` : ''}</option>
          <option value="pending">Pending{statusCounts.pending ? ` (${statusCounts.pending})` : ''}</option>
          <option value="completed">Completed{statusCounts.completed ? ` (${statusCounts.completed})` : ''}</option>
          <option value="failed">Failed{statusCounts.failed ? ` (${statusCounts.failed})` : ''}</option>
          <option value="killed">Killed{statusCounts.killed ? ` (${statusCounts.killed})` : ''}</option>
          <option value="deleted">Deleted{statusCounts.deleted ? ` (${statusCounts.deleted})` : ''}</option>
        </select>
        <span style={{ color: 'var(--pw-text-muted)', fontSize: '13px' }}>
          {sorted.length} shown
          {statusCounts.running ? ` \u00b7 ${statusCounts.running} running` : ''}
        </span>
        {filterStatus.value === 'deleted' && sorted.length > 0 && (
          <button
            class="btn btn-sm btn-danger"
            onClick={() => permanentlyDeleteAll(sorted.map((s) => s.id))}
          >
            Purge all ({sorted.length})
          </button>
        )}
      </div>

      <div class="session-card-list">
        {sorted.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--pw-text-faint)', padding: '24px' }}>No sessions found</div>
        )}
        {sorted.map((s) => {
          const agentLabel = s.permissionProfile === 'plain' ? 'Terminal' : (agentMap.value[s.agentEndpointId] || s.agentEndpointId?.slice(-8) || null);
          const feedbackTitle = feedbackMap.value[s.feedbackId];
          return (
            <div key={s.id} class={`session-card ${s.status}`} onClick={() => openSession(s.id)}>
              <div class="session-card-main">
                <span class={`session-status-dot ${s.status}${s.status === 'running' && waitingSessions.value.has(s.id) ? ' waiting' : ''}`} />
                <span class="session-card-label">
                  {feedbackTitle || agentLabel || `Session ${s.id.slice(-8)}`}
                </span>
                <span class="session-card-id">{s.id.slice(-8)}</span>
                <span class={`session-card-status ${s.status}`}>{s.status}</span>
              </div>
              <div class="session-card-meta">
                {agentLabel && feedbackTitle && <span>{agentLabel}</span>}
                <span>{formatRelativeTime(s.startedAt || s.createdAt)}</span>
                <span>{formatDuration(s.startedAt, s.completedAt)}</span>
                {feedbackTitle && (
                  <span
                    class="session-feedback-link"
                    onClick={(e) => { e.stopPropagation(); navigate(`${feedbackPath}/${s.feedbackId}`); }}
                  >
                    feedback
                  </span>
                )}
              </div>
              <div class="session-card-actions" onClick={(e) => e.stopPropagation()}>
                {s.status !== 'deleted' && (
                  <>
                    <button class="btn btn-sm" onClick={() => openSession(s.id)}>
                      {s.status === 'running' ? 'Attach' : 'View'}
                    </button>
                    <button
                      class="btn btn-sm btn-danger"
                      onClick={() => deleteSession(s.id)}
                      title="Archive session"
                    >
                      &times;
                    </button>
                  </>
                )}
                {s.status === 'deleted' && (
                  <button
                    class="btn btn-sm btn-danger"
                    onClick={() => permanentlyDelete(s.id)}
                    title="Permanently delete"
                  >
                    Delete forever
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
