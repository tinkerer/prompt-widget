import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { api } from '../lib/api.js';
import { navigate } from '../lib/state.js';
import { allSessions, openSession, startSessionPolling } from '../lib/sessions.js';

const filterStatus = signal('');
const feedbackMap = signal<Record<string, string>>({});
const agentMap = signal<Record<string, string>>({});
const mapsLoaded = signal(false);

async function loadMaps() {
  if (mapsLoaded.value) return;
  try {
    const [fbResult, agents] = await Promise.all([
      api.getFeedback({ limit: 200 }),
      api.getAgents(),
    ]);
    const fm: Record<string, string> = {};
    for (const fb of fbResult.data) {
      fm[fb.id] = fb.message?.slice(0, 60) || fb.id.slice(-8);
    }
    feedbackMap.value = fm;
    const am: Record<string, string> = {};
    for (const a of agents) {
      am[a.id] = a.name || a.id.slice(-8);
    }
    agentMap.value = am;
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

export function SessionsPage() {
  useEffect(() => {
    loadMaps();
    return startSessionPolling();
  }, []);

  const sessions = allSessions.value;
  const filtered = filterStatus.value
    ? sessions.filter((s) => s.status === filterStatus.value)
    : sessions;

  const sorted = [...filtered].sort((a, b) => {
    const statusOrder = (s: string) =>
      s === 'running' ? 0 : s === 'pending' ? 1 : 2;
    const diff = statusOrder(a.status) - statusOrder(b.status);
    if (diff !== 0) return diff;
    return new Date(b.startedAt || b.createdAt || 0).getTime() -
      new Date(a.startedAt || a.createdAt || 0).getTime();
  });

  return (
    <div>
      <div class="page-header">
        <h2>Sessions</h2>
      </div>

      <div class="sessions-page-filters">
        <select
          value={filterStatus.value}
          onChange={(e) => { filterStatus.value = (e.target as HTMLSelectElement).value; }}
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="killed">Killed</option>
        </select>
        <span style={{ color: '#64748b', fontSize: '13px' }}>{sorted.length} sessions</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Session ID</th>
              <th>Feedback</th>
              <th>Agent</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: '24px' }}>No sessions found</td></tr>
            )}
            {sorted.map((s) => (
              <tr key={s.id}>
                <td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span class={`session-status-dot ${s.status}`} />
                    {s.status}
                  </span>
                </td>
                <td>
                  <span class="session-id-link" onClick={() => openSession(s.id)}>
                    {s.id.slice(-8)}
                  </span>
                </td>
                <td>
                  {feedbackMap.value[s.feedbackId] ? (
                    <span
                      class="session-feedback-link"
                      onClick={() => navigate(`/feedback/${s.feedbackId}`)}
                    >
                      {feedbackMap.value[s.feedbackId]}
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>{s.feedbackId?.slice(-8) || '—'}</span>
                  )}
                </td>
                <td>{agentMap.value[s.agentEndpointId] || s.agentEndpointId?.slice(-8) || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatRelativeTime(s.startedAt || s.createdAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDuration(s.startedAt, s.completedAt)}</td>
                <td>
                  <button class="btn btn-sm" onClick={() => openSession(s.id)}>
                    {s.status === 'running' ? 'Attach' : 'View'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
