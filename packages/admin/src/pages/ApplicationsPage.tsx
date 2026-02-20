import { signal } from '@preact/signals';
import { api } from '../lib/api.js';
import { loadApplications as refreshSidebarApps } from '../lib/state.js';

const apps = signal<any[]>([]);
const loading = signal(true);
const showForm = signal(false);
const editingId = signal<string | null>(null);
const formName = signal('');
const formProjectDir = signal('');
const formServerUrl = signal('');
const formHooks = signal('');
const formDescription = signal('');
const formError = signal('');
const formLoading = signal(false);
const copiedKey = signal<string | null>(null);

async function loadApps() {
  loading.value = true;
  try {
    apps.value = await api.getApplications();
  } catch (err) {
    console.error('Failed to load applications:', err);
  } finally {
    loading.value = false;
  }
}

loadApps();

function openCreate() {
  editingId.value = null;
  formName.value = '';
  formProjectDir.value = '';
  formServerUrl.value = '';
  formHooks.value = '';
  formDescription.value = '';
  formError.value = '';
  showForm.value = true;
}

function openEdit(app: any) {
  editingId.value = app.id;
  formName.value = app.name;
  formProjectDir.value = app.projectDir;
  formServerUrl.value = app.serverUrl || '';
  formHooks.value = (app.hooks || []).join(', ');
  formDescription.value = app.description || '';
  formError.value = '';
  showForm.value = true;
}

async function saveApp(e: Event) {
  e.preventDefault();
  formError.value = '';
  formLoading.value = true;

  const hooks = formHooks.value
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  const data = {
    name: formName.value,
    projectDir: formProjectDir.value,
    serverUrl: formServerUrl.value || undefined,
    hooks,
    description: formDescription.value,
  };

  try {
    if (editingId.value) {
      await api.updateApplication(editingId.value, data);
    } else {
      await api.createApplication(data);
    }
    showForm.value = false;
    await loadApps();
    refreshSidebarApps();
  } catch (err: any) {
    formError.value = err.message;
  } finally {
    formLoading.value = false;
  }
}

async function deleteApp(id: string) {
  if (!confirm('Delete this application? Agent endpoints linked to it will be unlinked.')) return;
  await api.deleteApplication(id);
  await loadApps();
  refreshSidebarApps();
}

async function regenerateKey(id: string) {
  if (!confirm('Regenerate API key? The old key will stop working immediately.')) return;
  const result = await api.regenerateApplicationKey(id);
  await loadApps();
  copyToClipboard(result.apiKey);
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    copiedKey.value = text;
    setTimeout(() => { copiedKey.value = null; }, 2000);
  });
}

export function ApplicationsPage() {
  return (
    <div>
      <div class="page-header">
        <h2>Applications</h2>
        <button class="btn btn-primary" onClick={openCreate}>Add Application</button>
      </div>

      <div class="agent-list">
        {apps.value.map((app) => (
          <div class="agent-card" key={app.id}>
            <div class="agent-info" style="flex:1;min-width:0">
              <h4>{app.name}</h4>
              <p style="font-size:12px;color:#94a3b8;margin:2px 0">{app.projectDir}</p>
              {app.description && <p style="font-size:12px;color:#64748b;margin:2px 0">{app.description}</p>}
              <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <code style="font-size:11px;background:#1e293b;padding:2px 8px;border-radius:4px;color:#e2e8f0;word-break:break-all">
                  {app.apiKey}
                </code>
                <button
                  class="btn btn-sm"
                  onClick={() => copyToClipboard(app.apiKey)}
                  style="font-size:11px;padding:2px 8px"
                >
                  {copiedKey.value === app.apiKey ? 'Copied!' : 'Copy'}
                </button>
                <button
                  class="btn btn-sm"
                  onClick={() => regenerateKey(app.id)}
                  style="font-size:11px;padding:2px 8px"
                >
                  Regenerate
                </button>
              </div>
              {app.hooks && app.hooks.length > 0 && (
                <div style="margin-top:4px;font-size:11px;color:#94a3b8">
                  Hooks: {app.hooks.join(', ')}
                </div>
              )}
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0">
              <button class="btn btn-sm" onClick={() => openEdit(app)}>Edit</button>
              <button class="btn btn-sm btn-danger" onClick={() => deleteApp(app.id)}>Delete</button>
            </div>
          </div>
        ))}
        {apps.value.length === 0 && !loading.value && (
          <div style="text-align:center;padding:40px;color:#94a3b8">
            No applications registered yet
          </div>
        )}
      </div>

      {showForm.value && (
        <div class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) showForm.value = false; }}>
          <form class="modal" onSubmit={saveApp}>
            <h3>{editingId.value ? 'Edit' : 'Add'} Application</h3>
            {formError.value && <div class="error-msg">{formError.value}</div>}
            <div class="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formName.value}
                onInput={(e) => (formName.value = (e.target as HTMLInputElement).value)}
                placeholder="e.g., My Web App"
                required
                style="width:100%"
              />
            </div>
            <div class="form-group">
              <label>Project Directory</label>
              <input
                type="text"
                value={formProjectDir.value}
                onInput={(e) => (formProjectDir.value = (e.target as HTMLInputElement).value)}
                placeholder="/home/user/projects/my-app"
                required
                style="width:100%"
              />
              <span style="font-size:11px;color:#94a3b8">Used as --cwd for Claude Code</span>
            </div>
            <div class="form-group">
              <label>Server URL (optional)</label>
              <input
                type="url"
                value={formServerUrl.value}
                onInput={(e) => (formServerUrl.value = (e.target as HTMLInputElement).value)}
                placeholder="https://myapp.example.com"
                style="width:100%"
              />
            </div>
            <div class="form-group">
              <label>Hooks (comma-separated)</label>
              <input
                type="text"
                value={formHooks.value}
                onInput={(e) => (formHooks.value = (e.target as HTMLInputElement).value)}
                placeholder="navigate, click, getState"
                style="width:100%"
              />
              <span style="font-size:11px;color:#94a3b8">Names of window.agent.* methods the app exposes</span>
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea
                value={formDescription.value}
                onInput={(e) => (formDescription.value = (e.target as HTMLTextAreaElement).value)}
                placeholder="What this application does, key features, etc."
                style="width:100%;min-height:60px"
              />
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" onClick={() => (showForm.value = false)}>Cancel</button>
              <button type="submit" class="btn btn-primary" disabled={formLoading.value}>
                {formLoading.value ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
