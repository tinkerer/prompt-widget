import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { api } from '../lib/api.js';

interface LiveConnection {
  sessionId: string;
  connectedAt: string;
  lastActivity: string;
  userAgent: string | null;
  url: string | null;
  viewport: string | null;
  userId: string | null;
  appId: string | null;
  name: string | null;
  tags: string[];
}

const connections = signal<LiveConnection[]>([]);
const loading = signal(false);

async function loadConnections() {
  try {
    connections.value = await api.getLiveConnections();
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function isIdle(lastActivity: string): boolean {
  return Date.now() - new Date(lastActivity).getTime() > 30_000;
}

function parseBrowser(ua: string | null): string {
  if (!ua) return '\u2014';
  if (ua.includes('Chrome/') && !ua.includes('Edg/')) return 'Chrome';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari';
  return 'Other';
}

function shortenUrl(url: string | null): string {
  if (!url) return '\u2014';
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const hash = u.hash || '';
    return `${u.host}${path}${hash}`;
  } catch {
    return url;
  }
}

export function LiveConnectionsPage({ appId }: { appId?: string | null }) {
  useEffect(() => {
    loading.value = true;
    loadConnections();
    const interval = setInterval(loadConnections, 5_000);
    return () => clearInterval(interval);
  }, []);

  let filtered = connections.value;
  if (appId && appId !== '__unlinked__') {
    filtered = filtered.filter((c) => c.appId === appId);
  } else if (appId === '__unlinked__') {
    filtered = filtered.filter((c) => !c.appId);
  }

  const activeCount = filtered.filter((c) => !isIdle(c.lastActivity)).length;
  const idleCount = filtered.length - activeCount;

  return (
    <div>
      <div class="page-header">
        <h2>Live Connections ({filtered.length})</h2>
        <span style={{ color: '#64748b', fontSize: '13px' }}>
          {activeCount} active
          {idleCount > 0 && ` \u00b7 ${idleCount} idle`}
        </span>
      </div>

      {loading.value && filtered.length === 0 && (
        <p style={{ color: '#94a3b8', textAlign: 'center', padding: '24px' }}>Loading...</p>
      )}

      {!loading.value && filtered.length === 0 && (
        <p style={{ color: '#94a3b8', textAlign: 'center', padding: '24px' }}>
          No widget connections active. Open a page with the widget embedded to see it here.
        </p>
      )}

      {filtered.length > 0 && (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>URL</th>
                <th>Browser</th>
                <th>Viewport</th>
                <th>User</th>
                <th>Connected</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const idle = isIdle(c.lastActivity);
                return (
                  <tr key={c.sessionId}>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span class={`session-status-dot ${idle ? 'pending' : 'running'}`} />
                        {idle ? 'idle' : 'active'}
                      </span>
                    </td>
                    <td title={c.url || undefined} style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {shortenUrl(c.url)}
                    </td>
                    <td>{parseBrowser(c.userAgent)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.viewport || '\u2014'}</td>
                    <td>{c.userId || c.name || '\u2014'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDuration(c.connectedAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatRelativeTime(c.lastActivity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
