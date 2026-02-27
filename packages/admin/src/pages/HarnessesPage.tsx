import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { api } from '../lib/api.js';

const harnesses = signal<any[]>([]);
const loading = signal(true);
const error = signal('');

async function loadHarnesses() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.getHarnesses();
    harnesses.value = res.harnesses;
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

export function HarnessesPage() {
  useEffect(() => {
    loadHarnesses();
    const interval = setInterval(loadHarnesses, 10_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style="max-width:800px">
      <div class="page-header">
        <div>
          <h2>Harnesses</h2>
          <p style="font-size:13px;color:var(--pw-text-muted);margin-top:4px">
            Docker harness instances running pw-server + browser + optional app container.
          </p>
        </div>
        <button class="btn" onClick={loadHarnesses} disabled={loading.value}>
          {loading.value ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error.value && <div class="error-msg">{error.value}</div>}

      <div class="agent-list">
        {harnesses.value.map((h) => (
          <div class="agent-card" key={h.id}>
            <div class="agent-card-body">
              <div class="agent-card-top">
                <div class="agent-card-name">
                  {h.name}
                  <span class="agent-badge" style="background:var(--pw-primary);color:#fff;margin-left:8px">
                    {h.online ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
              </div>
              <div class="agent-card-meta">
                <span class="agent-meta-tag">{h.id}</span>
                <span class="agent-meta-tag">{h.hostname}</span>
                {h.activeSessions?.length > 0 && (
                  <span class="agent-meta-tag" style="border-color:var(--pw-primary)40;color:var(--pw-primary)">
                    {h.activeSessions.length} session{h.activeSessions.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {h.harness && (
                <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--pw-text-muted)">
                  <div>
                    <span style="font-weight:500;color:var(--pw-text)">App URL: </span>
                    <a href={h.harness.targetAppUrl} target="_blank" rel="noopener" style="color:var(--pw-primary)">
                      {h.harness.targetAppUrl}
                    </a>
                  </div>
                  <div>
                    <span style="font-weight:500;color:var(--pw-text)">Browser MCP: </span>
                    <a href={h.harness.browserMcpUrl} target="_blank" rel="noopener" style="color:var(--pw-primary)">
                      {h.harness.browserMcpUrl}
                    </a>
                  </div>
                  {h.harness.appImage && (
                    <div>
                      <span style="font-weight:500;color:var(--pw-text)">Image: </span>
                      <code style="font-size:11px">{h.harness.appImage}</code>
                    </div>
                  )}
                  {h.harness.appPort && (
                    <div>
                      <span style="font-weight:500;color:var(--pw-text)">App Port: </span>
                      {h.harness.appPort}
                    </div>
                  )}
                </div>
              )}
              <div style="margin-top:6px;font-size:11px;color:var(--pw-text-faint)">
                Connected {h.connectedAt}
              </div>
            </div>
          </div>
        ))}
        {harnesses.value.length === 0 && !loading.value && (
          <div class="agent-empty">
            <div class="agent-empty-icon">{'\u{1F433}'}</div>
            <div class="agent-empty-title">No harnesses running</div>
            <div class="agent-empty-desc">
              Start a Docker harness with <code>docker compose up -d</code> in <code>packages/harness/</code>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
