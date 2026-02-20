import { signal } from '@preact/signals';
import { api } from '../lib/api.js';

const agents = signal<any[]>([]);
const applications = signal<any[]>([]);
const loading = signal(true);
const showForm = signal(false);
const editingId = signal<string | null>(null);
const formName = signal('');
const formUrl = signal('');
const formAuth = signal('');
const formDefault = signal(false);
const formAppId = signal('');
const formMode = signal<'webhook' | 'headless' | 'interactive'>('webhook');
const formPromptTemplate = signal('');
const formPermissionProfile = signal<'interactive' | 'auto' | 'yolo'>('interactive');
const formAllowedTools = signal('');
const formAutoPlan = signal(false);
const formError = signal('');
const formLoading = signal(false);

let currentAppId: string | null = null;

async function loadAgents(appId: string | null) {
  loading.value = true;
  currentAppId = appId;
  try {
    const [agentsList, appsList] = await Promise.all([
      api.getAgents(),
      api.getApplications(),
    ]);
    agents.value = appId
      ? agentsList.filter((a: any) => a.appId === appId)
      : agentsList;
    applications.value = appsList;
  } catch (err) {
    console.error('Failed to load agents:', err);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  formName.value = '';
  formUrl.value = '';
  formAuth.value = '';
  formDefault.value = false;
  formAppId.value = currentAppId || '';
  formMode.value = 'webhook';
  formPromptTemplate.value = '';
  formPermissionProfile.value = 'interactive';
  formAllowedTools.value = '';
  formAutoPlan.value = false;
  formError.value = '';
  showForm.value = true;
}

function openEdit(agent: any) {
  editingId.value = agent.id;
  formName.value = agent.name;
  formUrl.value = agent.url || '';
  formAuth.value = agent.authHeader || '';
  formDefault.value = agent.isDefault;
  formAppId.value = agent.appId || '';
  formMode.value = agent.mode || 'webhook';
  formPromptTemplate.value = agent.promptTemplate || '';
  formPermissionProfile.value = agent.permissionProfile || 'interactive';
  formAllowedTools.value = agent.allowedTools || '';
  formAutoPlan.value = agent.autoPlan || false;
  formError.value = '';
  showForm.value = true;
}

async function saveAgent(e: Event) {
  e.preventDefault();
  formError.value = '';
  formLoading.value = true;

  const data: Record<string, unknown> = {
    name: formName.value,
    url: formUrl.value || undefined,
    authHeader: formAuth.value || undefined,
    isDefault: formDefault.value,
    appId: formAppId.value || undefined,
    mode: formMode.value,
    promptTemplate: formPromptTemplate.value || undefined,
    permissionProfile: formPermissionProfile.value,
    allowedTools: formAllowedTools.value || undefined,
    autoPlan: formAutoPlan.value,
  };

  try {
    if (editingId.value) {
      await api.updateAgent(editingId.value, data);
    } else {
      await api.createAgent(data);
    }
    showForm.value = false;
    await loadAgents(currentAppId);
  } catch (err: any) {
    formError.value = err.message;
  } finally {
    formLoading.value = false;
  }
}

async function deleteAgent(id: string) {
  if (!confirm('Delete this agent endpoint?')) return;
  await api.deleteAgent(id);
  await loadAgents(currentAppId);
}

function getAppName(appId: string | null): string | null {
  if (!appId) return null;
  const app = applications.value.find((a) => a.id === appId);
  return app?.name || null;
}

const MODE_LABELS: Record<string, string> = {
  webhook: 'Webhook',
  headless: 'Headless',
  interactive: 'Interactive',
};

const PROFILE_LABELS: Record<string, string> = {
  interactive: 'Interactive',
  auto: 'Auto',
  yolo: 'YOLO',
};

export function AgentsPage({ appId }: { appId: string | null }) {
  if (currentAppId !== appId) {
    loadAgents(appId);
  }
  return (
    <div>
      <div class="page-header">
        <h2>Agent Endpoints</h2>
        <button class="btn btn-primary" onClick={openCreate}>Add Endpoint</button>
      </div>

      <div class="agent-list">
        {agents.value.map((agent) => (
          <div class="agent-card" key={agent.id}>
            <div class="agent-info">
              <h4>
                {agent.name}
                {agent.isDefault && <span class="badge badge-resolved" style="margin-left:8px">default</span>}
                <span class="badge" style="margin-left:8px;background:var(--pw-bg-raised)">{MODE_LABELS[agent.mode] || 'Webhook'}</span>
                {agent.mode !== 'webhook' && (
                  <span class="badge" style="margin-left:4px;background:#1e1b4b;color:#a5b4fc">
                    {PROFILE_LABELS[agent.permissionProfile] || 'Interactive'}
                  </span>
                )}
                {agent.autoPlan && (
                  <span class="badge" style="margin-left:4px;background:#064e3b;color:#6ee7b7">
                    Auto-plan
                  </span>
                )}
              </h4>
              {agent.mode === 'webhook' && <p>{agent.url}</p>}
              {agent.authHeader && <p style="font-size:12px;color:var(--pw-text-faint)">Auth header configured</p>}
              {getAppName(agent.appId) && (
                <p style="font-size:12px;color:var(--pw-text-faint)">App: {getAppName(agent.appId)}</p>
              )}
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm" onClick={() => openEdit(agent)}>Edit</button>
              <button class="btn btn-sm btn-danger" onClick={() => deleteAgent(agent.id)}>Delete</button>
            </div>
          </div>
        ))}
        {agents.value.length === 0 && !loading.value && (
          <div style="text-align:center;padding:40px;color:var(--pw-text-faint)">
            No agent endpoints configured yet
          </div>
        )}
      </div>

      {showForm.value && (
        <div class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) showForm.value = false; }}>
          <form class="modal" onSubmit={saveAgent}>
            <h3>{editingId.value ? 'Edit' : 'Add'} Agent Endpoint</h3>
            {formError.value && <div class="error-msg">{formError.value}</div>}
            <div class="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formName.value}
                onInput={(e) => (formName.value = (e.target as HTMLInputElement).value)}
                placeholder="e.g., Claude Code Agent"
                required
                style="width:100%"
              />
            </div>
            <div class="form-group">
              <label>Mode</label>
              <div style="display:flex;gap:16px">
                {(['webhook', 'headless', 'interactive'] as const).map((m) => (
                  <label key={m} style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px">
                    <input
                      type="radio"
                      name="mode"
                      value={m}
                      checked={formMode.value === m}
                      onChange={() => (formMode.value = m)}
                    />
                    {MODE_LABELS[m]}
                  </label>
                ))}
              </div>
            </div>
            {!currentAppId && (
              <div class="form-group">
                <label>Application (optional)</label>
                <select
                  value={formAppId.value}
                  onChange={(e) => (formAppId.value = (e.target as HTMLSelectElement).value)}
                  style="width:100%"
                >
                  <option value="">None</option>
                  {applications.value.map((app) => (
                    <option value={app.id} key={app.id}>{app.name}</option>
                  ))}
                </select>
              </div>
            )}
            {formMode.value === 'webhook' && (
              <>
                <div class="form-group">
                  <label>URL</label>
                  <input
                    type="url"
                    value={formUrl.value}
                    onInput={(e) => (formUrl.value = (e.target as HTMLInputElement).value)}
                    placeholder="https://agent.example.com/webhook"
                    style="width:100%"
                  />
                </div>
                <div class="form-group">
                  <label>Authorization Header (optional)</label>
                  <input
                    type="text"
                    value={formAuth.value}
                    onInput={(e) => (formAuth.value = (e.target as HTMLInputElement).value)}
                    placeholder="Bearer sk-..."
                    style="width:100%"
                  />
                </div>
              </>
            )}
            {(formMode.value === 'headless' || formMode.value === 'interactive') && (
              <>
                <div class="form-group">
                  <label>Prompt Template</label>
                  <textarea
                    value={formPromptTemplate.value}
                    onInput={(e) => (formPromptTemplate.value = (e.target as HTMLTextAreaElement).value)}
                    placeholder={'{{feedback.title}}\n\n{{feedback.description}}\n\n{{instructions}}'}
                    style="width:100%;min-height:120px;font-family:monospace;font-size:12px"
                  />
                  <span style="font-size:11px;color:var(--pw-text-faint)">
                    Variables: {'{{feedback.title}}'}, {'{{feedback.description}}'}, {'{{feedback.consoleLogs}}'}, {'{{feedback.networkErrors}}'}, {'{{feedback.data}}'}, {'{{feedback.tags}}'}, {'{{app.name}}'}, {'{{app.projectDir}}'}, {'{{app.hooks}}'}, {'{{app.description}}'}, {'{{instructions}}'}, {'{{session.url}}'}, {'{{session.viewport}}'}
                  </span>
                </div>
                <div class="form-group">
                  <label>Permission Profile</label>
                  <div style="display:flex;gap:16px">
                    {(['interactive', 'auto', 'yolo'] as const).map((p) => (
                      <label key={p} style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px">
                        <input
                          type="radio"
                          name="permissionProfile"
                          value={p}
                          checked={formPermissionProfile.value === p}
                          onChange={() => (formPermissionProfile.value = p)}
                        />
                        {PROFILE_LABELS[p]}
                      </label>
                    ))}
                  </div>
                  <span style="font-size:11px;color:var(--pw-text-faint);margin-top:4px;display:block">
                    {formPermissionProfile.value === 'interactive' && 'Admin watches and approves all tool uses in real-time.'}
                    {formPermissionProfile.value === 'auto' && 'Pre-approved tools run automatically; admin sees output and handles remaining prompts.'}
                    {formPermissionProfile.value === 'yolo' && 'Fully autonomous — skips all permission checks. Use only in sandboxed environments.'}
                  </span>
                </div>
                {formPermissionProfile.value === 'auto' && (
                  <div class="form-group">
                    <label>Allowed Tools</label>
                    <textarea
                      value={formAllowedTools.value}
                      onInput={(e) => (formAllowedTools.value = (e.target as HTMLTextAreaElement).value)}
                      placeholder={'Edit,Read,Bash(git *)'}
                      style="width:100%;min-height:60px;font-family:monospace;font-size:12px"
                    />
                    <span style="font-size:11px;color:var(--pw-text-faint)">
                      Comma-separated list of tools to auto-approve. e.g. Edit,Read,Write,Bash(git *),Bash(npm run *)
                    </span>
                  </div>
                )}
                {formPermissionProfile.value === 'yolo' && (
                  <div style="background:var(--pw-danger-border);color:#fecaca;padding:8px 12px;border-radius:6px;font-size:12px;margin-top:-8px">
                    Warning: YOLO mode skips ALL permission checks. The agent can execute any command, edit any file, and access any resource. Only use in sandboxed/Docker environments.
                  </div>
                )}
                <div class="form-group">
                  <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input
                      type="checkbox"
                      checked={formAutoPlan.value}
                      onChange={(e) => (formAutoPlan.value = (e.target as HTMLInputElement).checked)}
                    />
                    Auto-plan
                  </label>
                  <span style="font-size:11px;color:var(--pw-text-faint);margin-top:4px;display:block">
                    Agent creates a plan and waits for approval before implementing. Resumed sessions continue with the plan context.
                  </span>
                </div>
              </>
            )}
            <div class="form-group">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input
                  type="checkbox"
                  checked={formDefault.value}
                  onChange={(e) => (formDefault.value = (e.target as HTMLInputElement).checked)}
                />
                Default endpoint
              </label>
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
