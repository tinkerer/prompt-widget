import { signal } from '@preact/signals';
import { api } from '../lib/api.js';
import { navigate } from '../lib/state.js';
import { openSession, resumeSession } from '../lib/sessions.js';

const feedback = signal<any>(null);
const loading = signal(true);
const error = signal('');
const agents = signal<any[]>([]);
const dispatchAgentId = signal('');
const dispatchInstructions = signal('');
const dispatchLoading = signal(false);
const newTag = signal('');
const agentSessions = signal<any[]>([]);
const lastLoadedId = signal<string | null>(null);

const STATUSES = ['new', 'reviewed', 'dispatched', 'resolved', 'archived'];

let currentDetailAppId: string | null = null;

async function load(id: string, appId: string | null) {
  loading.value = true;
  error.value = '';
  agents.value = [];
  dispatchAgentId.value = '';
  lastLoadedId.value = id;
  currentDetailAppId = appId;
  try {
    const [fb, agentsList] = await Promise.all([
      api.getFeedbackById(id),
      api.getAgents(),
    ]);
    feedback.value = fb;
    const effectiveAppId = appId && appId !== '__unlinked__' ? appId : fb.appId;
    // Show all agents, but put the current app's agents first
    const appAgents = effectiveAppId
      ? agentsList.filter((a: any) => a.appId === effectiveAppId)
      : agentsList.filter((a: any) => !a.appId);
    const otherAgents = agentsList.filter((a: any) => !appAgents.includes(a));
    agents.value = [...appAgents, ...otherAgents];
    const def = appAgents.find((a: any) => a.isDefault);
    if (def) dispatchAgentId.value = def.id;
    else if (agentsList.length > 0) dispatchAgentId.value = agentsList[0].id;
    loadSessions(id);
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function loadSessions(feedbackId: string) {
  try {
    agentSessions.value = await api.getAgentSessions(feedbackId);
  } catch {
    // ignore
  }
}

async function updateStatus(status: string) {
  const fb = feedback.value;
  if (!fb) return;
  await api.updateFeedback(fb.id, { status });
  fb.status = status;
  feedback.value = { ...fb };
}

async function deleteFeedback() {
  const fb = feedback.value;
  if (!fb || !confirm('Delete this feedback?')) return;
  await api.deleteFeedback(fb.id);
  if (currentDetailAppId) {
    navigate(`/app/${currentDetailAppId}/feedback`);
  } else {
    navigate('/');
  }
}

async function addTag() {
  const fb = feedback.value;
  if (!fb || !newTag.value.trim()) return;
  const tags = [...(fb.tags || []), newTag.value.trim()];
  await api.updateFeedback(fb.id, { tags });
  fb.tags = tags;
  feedback.value = { ...fb };
  newTag.value = '';
}

async function removeTag(tag: string) {
  const fb = feedback.value;
  if (!fb) return;
  const tags = (fb.tags || []).filter((t: string) => t !== tag);
  await api.updateFeedback(fb.id, { tags });
  fb.tags = tags;
  feedback.value = { ...fb };
}

async function doDispatch() {
  const fb = feedback.value;
  if (!fb || !dispatchAgentId.value) return;
  dispatchLoading.value = true;
  try {
    const selectedAgent = agents.value.find((a) => a.id === dispatchAgentId.value);
    const result = await api.dispatch({
      feedbackId: fb.id,
      agentEndpointId: dispatchAgentId.value,
      instructions: dispatchInstructions.value || undefined,
    });
    dispatchInstructions.value = '';

    // Optimistically update local feedback state instead of re-fetching everything
    feedback.value = {
      ...fb,
      status: 'dispatched',
      dispatchedTo: selectedAgent?.name || 'Agent',
      dispatchedAt: new Date().toISOString(),
      dispatchStatus: result.sessionId ? 'running' : 'success',
      dispatchResponse: result.response,
    };

    if (result.sessionId) {
      openSession(result.sessionId);
    }

    // Only refresh sessions list (lightweight) instead of full page reload
    loadSessions(fb.id);
  } catch (err: any) {
    alert('Dispatch failed: ' + err.message);
  } finally {
    dispatchLoading.value = false;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function formatJson(data: any) {
  if (!data) return 'null';
  return JSON.stringify(data, null, 2);
}

export function FeedbackDetailPage({ id, appId }: { id: string; appId: string | null }) {
  if (lastLoadedId.value !== id) {
    load(id, appId);
  }

  if (loading.value) return <div>Loading...</div>;
  if (error.value) return <div class="error-msg">{error.value}</div>;

  const fb = feedback.value;
  if (!fb) return <div>Not found</div>;

  const backPath = appId ? `/app/${appId}/feedback` : '/';

  return (
    <div>
      <div class="page-header">
        <div>
          <a href={`#${backPath}`} onClick={(e) => { e.preventDefault(); navigate(backPath); }} style="color:var(--pw-text-muted);text-decoration:none;font-size:13px">
            &larr; Back to list
          </a>
          <h2 style="margin-top:4px">{fb.title}</h2>
          <span style="font-size:11px;color:var(--pw-text-muted);font-family:monospace">{fb.id}</span>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-danger" onClick={deleteFeedback}>Delete</button>
        </div>
      </div>

      {agents.value.length > 0 && (
        <div class="dispatch-bar">
          <select
            class="dispatch-bar-select"
            value={dispatchAgentId.value}
            onChange={(e) => (dispatchAgentId.value = (e.target as HTMLSelectElement).value)}
          >
            {agents.value.map((a) => (
              <option value={a.id}>
                {a.name} {a.isDefault ? '(default)' : ''} [{a.mode || 'webhook'}]
              </option>
            ))}
          </select>
          <input
            class="dispatch-bar-input"
            type="text"
            placeholder="Instructions (optional)..."
            value={dispatchInstructions.value}
            onInput={(e) => (dispatchInstructions.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doDispatch(); }}
          />
          <button
            class="btn btn-primary dispatch-bar-btn"
            disabled={!dispatchAgentId.value || dispatchLoading.value}
            onClick={doDispatch}
          >
            {dispatchLoading.value ? 'Dispatching...' : 'Dispatch'}
          </button>
        </div>
      )}

      <div class="detail-grid">
        <div>
          <div class="detail-card" style="margin-bottom:16px">
            <h3>Details</h3>
            <div class="field-row">
              <span class="field-label">Status</span>
              <span class="field-value">
                <select
                  value={fb.status}
                  onChange={(e) => updateStatus((e.target as HTMLSelectElement).value)}
                  style="padding:2px 6px;font-size:13px"
                >
                  {STATUSES.map((s) => (
                    <option value={s}>{s}</option>
                  ))}
                </select>
              </span>
            </div>
            <div class="field-row">
              <span class="field-label">Type</span>
              <span class="field-value">
                <span class={`badge badge-${fb.type}`}>{fb.type.replace(/_/g, ' ')}</span>
              </span>
            </div>
            <div class="field-row">
              <span class="field-label">Description</span>
              <span class="field-value">{fb.description || '—'}</span>
            </div>
            <div class="field-row">
              <span class="field-label">Source URL</span>
              <span class="field-value">{fb.sourceUrl || '—'}</span>
            </div>
            <div class="field-row">
              <span class="field-label">Viewport</span>
              <span class="field-value">{fb.viewport || '—'}</span>
            </div>
            <div class="field-row">
              <span class="field-label">User Agent</span>
              <span class="field-value" style="font-size:12px">{fb.userAgent || '—'}</span>
            </div>
            <div class="field-row">
              <span class="field-label">Session</span>
              <span class="field-value" style="font-size:12px">{fb.sessionId || '—'}</span>
            </div>
            <div class="field-row">
              <span class="field-label">User</span>
              <span class="field-value">{fb.userId || '—'}</span>
            </div>
            <div class="field-row">
              <span class="field-label">Created</span>
              <span class="field-value">{formatDate(fb.createdAt)}</span>
            </div>
            <div class="field-row">
              <span class="field-label">Updated</span>
              <span class="field-value">{formatDate(fb.updatedAt)}</span>
            </div>
          </div>

          {fb.data && (
            <div class="detail-card" style="margin-bottom:16px">
              <h3>Custom Data</h3>
              <div class="json-viewer">{formatJson(fb.data)}</div>
            </div>
          )}

          {fb.context?.consoleLogs && fb.context.consoleLogs.length > 0 && (
            <div class="detail-card" style="margin-bottom:16px">
              <h3>Console Logs ({fb.context.consoleLogs.length})</h3>
              <div class="console-viewer">
                {fb.context.consoleLogs.map((entry: any, i: number) => (
                  <div class={`console-entry ${entry.level}`} key={i}>
                    <span style="color:var(--pw-text-muted)">{new Date(entry.timestamp).toLocaleTimeString()}</span>{' '}
                    [{entry.level.toUpperCase()}] {entry.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {fb.context?.networkErrors && fb.context.networkErrors.length > 0 && (
            <div class="detail-card" style="margin-bottom:16px">
              <h3>Network Errors ({fb.context.networkErrors.length})</h3>
              <table class="network-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>URL</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {fb.context.networkErrors.map((err: any, i: number) => (
                    <tr key={i}>
                      <td>{err.method}</td>
                      <td style="word-break:break-all;max-width:300px">{err.url}</td>
                      <td class={err.status >= 400 ? 'status-error' : ''}>{err.status || 'ERR'}</td>
                      <td style="white-space:nowrap">{new Date(err.timestamp).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {fb.context?.performanceTiming && (
            <div class="detail-card" style="margin-bottom:16px">
              <h3>Performance</h3>
              <div class="field-row">
                <span class="field-label">Load Time</span>
                <span class="field-value">{fb.context.performanceTiming.loadTime?.toFixed(0)}ms</span>
              </div>
              <div class="field-row">
                <span class="field-label">DOM Ready</span>
                <span class="field-value">{fb.context.performanceTiming.domContentLoaded?.toFixed(0)}ms</span>
              </div>
              <div class="field-row">
                <span class="field-label">FCP</span>
                <span class="field-value">{fb.context.performanceTiming.firstContentfulPaint?.toFixed(0)}ms</span>
              </div>
            </div>
          )}
        </div>

        <div>
          <div class="detail-card" style="margin-bottom:16px">
            <h3>Tags</h3>
            <div class="tags" style="margin-bottom:8px">
              {(fb.tags || []).map((t: string) => (
                <span class="tag">
                  {t}
                  <button onClick={() => removeTag(t)}>&times;</button>
                </span>
              ))}
              {(fb.tags || []).length === 0 && <span style="color:var(--pw-text-faint);font-size:13px">No tags</span>}
            </div>
            <div style="display:flex;gap:4px">
              <input
                type="text"
                placeholder="Add tag..."
                value={newTag.value}
                onInput={(e) => (newTag.value = (e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                style="flex:1;padding:4px 8px;font-size:12px"
              />
              <button class="btn btn-sm" onClick={addTag}>Add</button>
            </div>
          </div>

          {fb.screenshots && fb.screenshots.length > 0 && (
            <div class="detail-card" style="margin-bottom:16px">
              <h3>Screenshots ({fb.screenshots.length})</h3>
              <div class="screenshots-grid">
                {fb.screenshots.map((s: any) => (
                  <a href={`/api/v1/images/${s.id}`} target="_blank" key={s.id}>
                    <img class="screenshot-img" src={`/api/v1/images/${s.id}`} alt={s.filename} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {fb.dispatchedTo && (
            <div class="detail-card" style="margin-bottom:16px">
              <h3>Dispatch Info</h3>
              <div class="field-row">
                <span class="field-label">Sent to</span>
                <span class="field-value">{fb.dispatchedTo}</span>
              </div>
              <div class="field-row">
                <span class="field-label">At</span>
                <span class="field-value">{fb.dispatchedAt ? formatDate(fb.dispatchedAt) : '—'}</span>
              </div>
              <div class="field-row">
                <span class="field-label">Status</span>
                <span class="field-value">
                  <span class={`badge ${fb.dispatchStatus === 'success' ? 'badge-resolved' : fb.dispatchStatus === 'running' ? 'badge-dispatched' : 'badge-new'}`}>
                    {fb.dispatchStatus}
                  </span>
                </span>
              </div>
              {fb.dispatchResponse && (
                <div style="margin-top:8px">
                  <div class="json-viewer" style="max-height:150px">{fb.dispatchResponse}</div>
                </div>
              )}
            </div>
          )}

          {agentSessions.value.length > 0 && (
            <div class="detail-card" style="margin-bottom:16px">
              <h3>Agent Sessions ({agentSessions.value.length})</h3>
              <div class="session-list">
                {agentSessions.value.map((s: any) => (
                  <div class="session-item" key={s.id}>
                    <div>
                      <span class="session-id">{s.id.slice(-8)}</span>
                      <span class={`session-status ${s.status}`} style="margin-left:6px">{s.status}</span>
                    </div>
                    <div style="display:flex;gap:4px">
                      <button
                        class="btn btn-sm"
                        onClick={() => openSession(s.id)}
                      >
                        {s.status === 'running' ? 'Attach' : 'View Log'}
                      </button>
                      {s.status !== 'running' && s.status !== 'pending' && (
                        <button
                          class="btn btn-sm btn-primary"
                          onClick={async () => {
                            const newId = await resumeSession(s.id);
                            if (newId) loadSessions(fb.id);
                          }}
                        >
                          Resume
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fb.context?.environment && (
            <div class="detail-card">
              <h3>Environment</h3>
              <div class="field-row">
                <span class="field-label">Platform</span>
                <span class="field-value">{fb.context.environment.platform}</span>
              </div>
              <div class="field-row">
                <span class="field-label">Language</span>
                <span class="field-value">{fb.context.environment.language}</span>
              </div>
              <div class="field-row">
                <span class="field-label">Screen</span>
                <span class="field-value">{fb.context.environment.screenResolution}</span>
              </div>
              <div class="field-row">
                <span class="field-label">Referrer</span>
                <span class="field-value" style="word-break:break-all">{fb.context.environment.referrer || '—'}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
