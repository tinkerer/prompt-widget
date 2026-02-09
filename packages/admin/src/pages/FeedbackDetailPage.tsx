import { signal, effect } from '@preact/signals';
import { api } from '../lib/api.js';
import { navigate } from '../lib/state.js';

const feedback = signal<any>(null);
const loading = signal(true);
const error = signal('');
const showDispatch = signal(false);
const agents = signal<any[]>([]);
const dispatchAgentId = signal('');
const dispatchInstructions = signal('');
const dispatchLoading = signal(false);
const editingTags = signal(false);
const newTag = signal('');

const STATUSES = ['new', 'reviewed', 'dispatched', 'resolved', 'archived'];

async function load(id: string) {
  loading.value = true;
  error.value = '';
  try {
    feedback.value = await api.getFeedbackById(id);
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
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
  navigate('/');
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

async function openDispatch() {
  agents.value = await api.getAgents();
  const def = agents.value.find((a) => a.isDefault);
  if (def) dispatchAgentId.value = def.id;
  else if (agents.value.length > 0) dispatchAgentId.value = agents.value[0].id;
  showDispatch.value = true;
}

async function doDispatch() {
  const fb = feedback.value;
  if (!fb || !dispatchAgentId.value) return;
  dispatchLoading.value = true;
  try {
    await api.dispatch({
      feedbackId: fb.id,
      agentEndpointId: dispatchAgentId.value,
      instructions: dispatchInstructions.value || undefined,
    });
    showDispatch.value = false;
    dispatchInstructions.value = '';
    await load(fb.id);
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

export function FeedbackDetailPage({ id }: { id: string }) {
  if (feedback.value?.id !== id) {
    load(id);
  }

  if (loading.value) return <div>Loading...</div>;
  if (error.value) return <div class="error-msg">{error.value}</div>;

  const fb = feedback.value;
  if (!fb) return <div>Not found</div>;

  return (
    <div>
      <div class="page-header">
        <div>
          <a href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); }} style="color:#64748b;text-decoration:none;font-size:13px">
            &larr; Back to list
          </a>
          <h2 style="margin-top:4px">{fb.title}</h2>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onClick={openDispatch}>Dispatch to Agent</button>
          <button class="btn btn-danger" onClick={deleteFeedback}>Delete</button>
        </div>
      </div>

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
                    <span style="color:#64748b">{new Date(entry.timestamp).toLocaleTimeString()}</span>{' '}
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
              {(fb.tags || []).length === 0 && <span style="color:#94a3b8;font-size:13px">No tags</span>}
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
                  <span class={`badge ${fb.dispatchStatus === 'success' ? 'badge-resolved' : 'badge-new'}`}>
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

      {showDispatch.value && (
        <div class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) showDispatch.value = false; }}>
          <div class="modal">
            <h3>Dispatch to Agent</h3>
            <div class="form-group">
              <label>Agent Endpoint</label>
              <select
                value={dispatchAgentId.value}
                onChange={(e) => (dispatchAgentId.value = (e.target as HTMLSelectElement).value)}
                style="width:100%"
              >
                {agents.value.map((a) => (
                  <option value={a.id}>{a.name} {a.isDefault ? '(default)' : ''}</option>
                ))}
              </select>
              {agents.value.length === 0 && (
                <p style="color:#dc2626;font-size:13px;margin-top:4px">
                  No agent endpoints configured. Add one in Settings first.
                </p>
              )}
            </div>
            <div class="form-group">
              <label>Instructions (optional)</label>
              <textarea
                value={dispatchInstructions.value}
                onInput={(e) => (dispatchInstructions.value = (e.target as HTMLTextAreaElement).value)}
                placeholder="Additional instructions for the agent..."
                style="width:100%;min-height:80px"
              />
            </div>
            <div class="form-group">
              <label>Preview Payload</label>
              <div class="json-viewer" style="max-height:200px;font-size:11px">
                {formatJson({
                  feedback: { id: fb.id, type: fb.type, title: fb.title, status: fb.status },
                  instructions: dispatchInstructions.value || undefined,
                })}
              </div>
            </div>
            <div class="modal-actions">
              <button class="btn" onClick={() => (showDispatch.value = false)}>Cancel</button>
              <button
                class="btn btn-primary"
                disabled={!dispatchAgentId.value || dispatchLoading.value}
                onClick={doDispatch}
              >
                {dispatchLoading.value ? 'Dispatching...' : 'Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
