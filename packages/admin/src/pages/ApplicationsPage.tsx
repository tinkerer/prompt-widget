import { signal } from '@preact/signals';
import { api } from '../lib/api.js';
import { loadApplications as refreshSidebarApps } from '../lib/state.js';
import { spawnTerminal } from '../lib/sessions.js';
import { copyWithTooltip } from '../lib/clipboard.js';

const apps = signal<any[]>([]);
const loading = signal(true);
const showForm = signal(false);
const editingId = signal<string | null>(null);
const formName = signal('');
const formProjectDir = signal('');
const formServerUrl = signal('');
const formHooks = signal('');
const formDescription = signal('');
const formTmuxConfigId = signal('');
const formPermissionProfile = signal('interactive');
const formAllowedTools = signal('');
const formAgentPath = signal('');
const formScreenshotIncludeWidget = signal(false);
const formAutoDispatch = signal(false);
const formError = signal('');
const formLoading = signal(false);
const tmuxConfigs = signal<any[]>([]);

async function loadApps() {
  loading.value = true;
  try {
    const [appList, configList] = await Promise.all([
      api.getApplications(),
      api.getTmuxConfigs(),
    ]);
    apps.value = appList;
    tmuxConfigs.value = configList;
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
  formTmuxConfigId.value = '';
  formPermissionProfile.value = 'interactive';
  formAllowedTools.value = '';
  formAgentPath.value = '';
  formScreenshotIncludeWidget.value = false;
  formAutoDispatch.value = false;
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
  formTmuxConfigId.value = app.tmuxConfigId || '';
  formPermissionProfile.value = app.defaultPermissionProfile || 'interactive';
  formAllowedTools.value = app.defaultAllowedTools || '';
  formAgentPath.value = app.agentPath || '';
  formScreenshotIncludeWidget.value = !!app.screenshotIncludeWidget;
  formAutoDispatch.value = !!app.autoDispatch;
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

  const data: Record<string, unknown> = {
    name: formName.value,
    projectDir: formProjectDir.value,
    serverUrl: formServerUrl.value || undefined,
    hooks,
    description: formDescription.value,
    tmuxConfigId: formTmuxConfigId.value || null,
    defaultPermissionProfile: formPermissionProfile.value,
    defaultAllowedTools: formAllowedTools.value || null,
    agentPath: formAgentPath.value || null,
    screenshotIncludeWidget: formScreenshotIncludeWidget.value,
    autoDispatch: formAutoDispatch.value,
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
  navigator.clipboard.writeText(result.apiKey);
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
              <p style="font-size:12px;color:var(--pw-text-faint);margin:2px 0">{app.projectDir}</p>
              {app.description && <p style="font-size:12px;color:var(--pw-text-muted);margin:2px 0">{app.description}</p>}
              <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <code style="font-size:11px;background:var(--pw-code-block-bg);padding:2px 8px;border-radius:4px;color:var(--pw-code-block-text);word-break:break-all">
                  {app.apiKey}
                </code>
                <button
                  class="btn btn-sm"
                  onClick={(e) => copyWithTooltip(app.apiKey, e as any)}
                  style="font-size:11px;padding:2px 8px"
                >
                  Copy
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
                <div style="margin-top:4px;font-size:11px;color:var(--pw-text-faint)">
                  Hooks: {app.hooks.join(', ')}
                </div>
              )}
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0">
              <button class="btn btn-sm" onClick={() => spawnTerminal(app.id)} title="Open terminal in this app's directory">Terminal</button>
              <button class="btn btn-sm" onClick={() => openEdit(app)}>Edit</button>
              <button class="btn btn-sm btn-danger" onClick={() => deleteApp(app.id)}>Delete</button>
            </div>
          </div>
        ))}
        {apps.value.length === 0 && !loading.value && (
          <div style="text-align:center;padding:40px;color:var(--pw-text-faint)">
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
              <span style="font-size:11px;color:var(--pw-text-faint)">Used as --cwd for Claude Code</span>
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
              <span style="font-size:11px;color:var(--pw-text-faint)">Names of window.agent.* methods the app exposes</span>
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

            {editingId.value && (
              <>
                <div style="border-top:1px solid var(--pw-border);margin:16px 0;padding-top:12px">
                  <h4 style="margin:0 0 12px;font-size:13px;color:var(--pw-text-muted)">Session Settings</h4>
                </div>
                <div class="form-group">
                  <label>Tmux Configuration</label>
                  <select
                    value={formTmuxConfigId.value}
                    onChange={(e) => (formTmuxConfigId.value = (e.target as HTMLSelectElement).value)}
                    style="width:100%"
                  >
                    <option value="">Global Default</option>
                    {tmuxConfigs.value.map((cfg: any) => (
                      <option key={cfg.id} value={cfg.id}>
                        {cfg.name}{cfg.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="form-group">
                  <label>Default Permission Profile</label>
                  <select
                    value={formPermissionProfile.value}
                    onChange={(e) => (formPermissionProfile.value = (e.target as HTMLSelectElement).value)}
                    style="width:100%"
                  >
                    <option value="interactive">Interactive</option>
                    <option value="auto">Auto</option>
                    <option value="yolo">Yolo (skip permissions)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Default Allowed Tools</label>
                  <textarea
                    value={formAllowedTools.value}
                    onInput={(e) => (formAllowedTools.value = (e.target as HTMLTextAreaElement).value)}
                    placeholder="Edit, Bash(npm test), Read, ..."
                    style="width:100%;min-height:40px;font-family:'SF Mono',Monaco,Menlo,monospace;font-size:12px"
                  />
                  <span style="font-size:11px;color:var(--pw-text-faint)">Comma-separated list of tools for --allowedTools</span>
                </div>
                <div class="form-group">
                  <label>Agent Path</label>
                  <input
                    type="text"
                    value={formAgentPath.value}
                    onInput={(e) => (formAgentPath.value = (e.target as HTMLInputElement).value)}
                    placeholder="/usr/local/bin/claude (default: claude)"
                    style="width:100%"
                  />
                  <span style="font-size:11px;color:var(--pw-text-faint)">Custom path to Claude CLI binary</span>
                </div>
                <div class="form-group">
                  <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input
                      type="checkbox"
                      checked={formScreenshotIncludeWidget.value}
                      onChange={(e) => (formScreenshotIncludeWidget.value = (e.target as HTMLInputElement).checked)}
                    />
                    Include widget in screenshots
                  </label>
                  <span style="font-size:11px;color:var(--pw-text-faint)">When enabled, the prompt-widget overlay will appear in captured screenshots</span>
                </div>
                <div class="form-group">
                  <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input
                      type="checkbox"
                      checked={formAutoDispatch.value}
                      onChange={(e) => (formAutoDispatch.value = (e.target as HTMLInputElement).checked)}
                    />
                    Auto-dispatch to default agent
                  </label>
                  <span style="font-size:11px;color:var(--pw-text-faint)">Automatically dispatch new feedback to the default agent endpoint</span>
                </div>
              </>
            )}

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
