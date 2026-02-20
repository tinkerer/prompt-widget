import { signal } from '@preact/signals';
import { api } from '../lib/api.js';

const DEFAULT_PROMPT_TEMPLATE = `do feedback item {{feedback.id}}

Title: {{feedback.title}}
{{feedback.description}}
URL: {{feedback.sourceUrl}}

App: {{app.name}}
Project dir: {{app.projectDir}}
App description: {{app.description}}

{{feedback.consoleLogs}}
{{feedback.networkErrors}}
{{feedback.data}}
{{instructions}}

consider screenshot`;

const agents = signal<any[]>([]);
const applications = signal<any[]>([]);
const loading = signal(true);
const showForm = signal(false);
const editingId = signal<string | null>(null);
const formName = signal('');
const formUrl = signal('');
const formAuth = signal('');
const formDefault = signal(false);
const formMode = signal<'webhook' | 'headless' | 'interactive'>('interactive');
const formPromptTemplate = signal('');
const formPermissionProfile = signal<'interactive' | 'auto' | 'yolo'>('interactive');
const formAllowedTools = signal('');
const formAutoPlan = signal(false);
const formAppId = signal<string>('');
const formError = signal('');
const formLoading = signal(false);
const showAdvanced = signal(false);

async function loadAgents() {
  loading.value = true;
  try {
    const [agentsList, appsList] = await Promise.all([
      api.getAgents(),
      api.getApplications(),
    ]);
    agents.value = agentsList;
    applications.value = appsList;
  } catch (err) {
    console.error('Failed to load agents:', err);
  } finally {
    loading.value = false;
  }
}

let loaded = false;

function openCreate() {
  editingId.value = null;
  formName.value = '';
  formUrl.value = '';
  formAuth.value = '';
  formDefault.value = false;
  formAppId.value = '';
  formMode.value = 'interactive';
  formPromptTemplate.value = DEFAULT_PROMPT_TEMPLATE;
  formPermissionProfile.value = 'interactive';
  formAllowedTools.value = '';
  formAutoPlan.value = false;
  formError.value = '';
  showAdvanced.value = false;
  showForm.value = true;
}

function openEdit(agent: any) {
  editingId.value = agent.id;
  formName.value = agent.name;
  formUrl.value = agent.url || '';
  formAuth.value = agent.authHeader || '';
  formDefault.value = agent.isDefault;
  formAppId.value = agent.appId || '';
  formMode.value = agent.mode || 'interactive';
  formPromptTemplate.value = agent.promptTemplate || DEFAULT_PROMPT_TEMPLATE;
  formPermissionProfile.value = agent.permissionProfile || 'interactive';
  formAllowedTools.value = agent.allowedTools || '';
  formAutoPlan.value = agent.autoPlan || false;
  formError.value = '';
  showAdvanced.value = !!(agent.mode === 'webhook' || (agent.promptTemplate && agent.promptTemplate !== DEFAULT_PROMPT_TEMPLATE) || agent.allowedTools || agent.url);
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
    promptTemplate: (formPromptTemplate.value && formPromptTemplate.value !== DEFAULT_PROMPT_TEMPLATE) ? formPromptTemplate.value : undefined,
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
    await loadAgents();
  } catch (err: any) {
    formError.value = err.message;
  } finally {
    formLoading.value = false;
  }
}

async function deleteAgent(id: string) {
  if (!confirm('Delete this agent?')) return;
  await api.deleteAgent(id);
  await loadAgents();
}

const MODE_INFO: Record<string, { icon: string; label: string; color: string }> = {
  interactive: { icon: '\u{1F4BB}', label: 'Interactive', color: 'var(--pw-primary)' },
  headless: { icon: '\u{2699}\uFE0F', label: 'Headless', color: '#22c55e' },
  webhook: { icon: '\u{1F517}', label: 'Webhook', color: '#f59e0b' },
};

const PROFILE_DESCRIPTIONS: Record<string, { label: string; desc: string; icon: string }> = {
  interactive: { label: 'Supervised', desc: 'You approve each tool use in real-time', icon: '\u{1F441}' },
  auto: { label: 'Autonomous', desc: 'Pre-approved tools run automatically', icon: '\u{1F916}' },
  yolo: { label: 'Full Auto', desc: 'No permission checks (sandboxed only)', icon: '\u26A1' },
};

export function AgentsPage() {
  if (!loaded) {
    loaded = true;
    loadAgents();
  }
  return (
    <div style="max-width:800px">
      <div class="page-header">
        <div>
          <h2>Agents</h2>
          <p style="font-size:13px;color:var(--pw-text-muted);margin-top:4px">
            Compute environments where Claude Code runs to handle dispatched feedback.
          </p>
        </div>
        <button class="btn btn-primary" onClick={openCreate}>+ Add Agent</button>
      </div>

      <div class="agent-list">
        {agents.value.map((agent) => {
          const profile = PROFILE_DESCRIPTIONS[agent.permissionProfile] || PROFILE_DESCRIPTIONS.interactive;
          const mode = MODE_INFO[agent.mode] || MODE_INFO.interactive;
          const isWebhook = agent.mode === 'webhook';
          const app = agent.appId ? applications.value.find((a) => a.id === agent.appId) : null;
          return (
            <div class={`agent-card agent-card--${agent.mode || 'interactive'}`} key={agent.id}>
              <div class="agent-card-body">
                <div class="agent-card-top">
                  <div class="agent-card-name">
                    {agent.name}
                    {agent.isDefault && <span class="agent-badge agent-badge--default">DEFAULT</span>}
                  </div>
                  <div class="agent-card-actions">
                    <button class="btn btn-sm" onClick={() => openEdit(agent)}>Edit</button>
                    <button class="btn btn-sm btn-danger" onClick={() => deleteAgent(agent.id)}>Delete</button>
                  </div>
                </div>
                <div class="agent-card-meta">
                  <span class="agent-meta-tag" style={`border-color:${mode.color}40;color:${mode.color}`}>
                    {mode.label}
                  </span>
                  {!isWebhook && (
                    <span class="agent-meta-tag">
                      {profile.icon} {profile.label}
                    </span>
                  )}
                  {app ? (
                    <span class="agent-meta-tag agent-meta-tag--app">{app.name}</span>
                  ) : (
                    <span class="agent-meta-tag agent-meta-tag--global">Global</span>
                  )}
                  {!isWebhook && agent.autoPlan && (
                    <span class="agent-meta-tag agent-meta-tag--plan">Auto-plan</span>
                  )}
                </div>
                {isWebhook && agent.url && (
                  <div class="agent-card-url">{agent.url}</div>
                )}
              </div>
            </div>
          );
        })}
        {agents.value.length === 0 && !loading.value && (
          <div class="agent-empty">
            <div class="agent-empty-icon">{'\u{1F916}'}</div>
            <div class="agent-empty-title">No agents configured</div>
            <div class="agent-empty-desc">Add an agent to start dispatching feedback to Claude Code.</div>
            <button class="btn btn-primary" style="margin-top:12px" onClick={openCreate}>+ Add Agent</button>
          </div>
        )}
      </div>

      {showForm.value && (
        <div class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) showForm.value = false; }}>
          <form class="modal agent-modal" onSubmit={saveAgent}>
            <h3>{editingId.value ? 'Edit' : 'Add'} Agent</h3>
            {formError.value && <div class="error-msg">{formError.value}</div>}

            <div class="agent-form-grid">
              <div class="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={formName.value}
                  onInput={(e) => (formName.value = (e.target as HTMLInputElement).value)}
                  placeholder="e.g., My Laptop, Cloud Server, Dev Box"
                  required
                  style="width:100%"
                />
                <span class="form-hint">Where Claude Code runs</span>
              </div>
              <div class="form-group">
                <label>Application</label>
                <select
                  value={formAppId.value}
                  onChange={(e) => (formAppId.value = (e.target as HTMLSelectElement).value)}
                  style="width:100%"
                >
                  <option value="">Global (all apps)</option>
                  {applications.value.map((app) => (
                    <option value={app.id} key={app.id}>{app.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {formMode.value !== 'webhook' && (
              <div class="form-group">
                <label>Permission Level</label>
                <div class="permission-grid">
                  {(['interactive', 'auto', 'yolo'] as const).map((p) => {
                    const info = PROFILE_DESCRIPTIONS[p];
                    const selected = formPermissionProfile.value === p;
                    return (
                      <label key={p} class={`permission-option ${selected ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="permissionProfile"
                          value={p}
                          checked={selected}
                          onChange={() => (formPermissionProfile.value = p)}
                          style="display:none"
                        />
                        <span class="permission-icon">{info.icon}</span>
                        <span class="permission-label">{info.label}</span>
                        <span class="permission-desc">{info.desc}</span>
                      </label>
                    );
                  })}
                </div>
                {formPermissionProfile.value === 'yolo' && (
                  <div class="permission-warning">
                    Full Auto skips ALL permission checks. Only use in sandboxed/Docker environments.
                  </div>
                )}
              </div>
            )}

            <div class="agent-form-row">
              <label class="agent-checkbox-label">
                <input
                  type="checkbox"
                  checked={formDefault.value}
                  onChange={(e) => (formDefault.value = (e.target as HTMLInputElement).checked)}
                />
                <span>Default agent</span>
                <span class="form-hint" style="margin-left:0">— used automatically when dispatching</span>
              </label>
            </div>

            <details class="agent-advanced" open={showAdvanced.value || undefined}
              onToggle={(e) => (showAdvanced.value = (e.target as HTMLDetailsElement).open)}>
              <summary>Advanced options</summary>
              <div class="agent-advanced-body">
                <div class="form-group">
                  <label>Mode</label>
                  <select
                    value={formMode.value}
                    onChange={(e) => (formMode.value = (e.target as HTMLSelectElement).value as any)}
                    style="width:100%"
                  >
                    <option value="interactive">Claude Code (interactive)</option>
                    <option value="headless">Claude Code (headless)</option>
                    <option value="webhook">Webhook</option>
                  </select>
                </div>
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
                      <label>Authorization Header</label>
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
                {formMode.value !== 'webhook' && (
                  <>
                    <div class="form-group">
                      <label>Prompt Template</label>
                      <textarea
                        value={formPromptTemplate.value}
                        onInput={(e) => (formPromptTemplate.value = (e.target as HTMLTextAreaElement).value)}
                        style="width:100%;min-height:160px;font-family:monospace;font-size:12px"
                      />
                      <span style="font-size:11px;color:var(--pw-text-faint)">
                        Variables: {'{{feedback.id}}'}, {'{{feedback.title}}'}, {'{{feedback.description}}'}, {'{{feedback.sourceUrl}}'}, {'{{feedback.tags}}'}, {'{{feedback.consoleLogs}}'}, {'{{feedback.networkErrors}}'}, {'{{feedback.data}}'}, {'{{app.name}}'}, {'{{app.projectDir}}'}, {'{{app.description}}'}, {'{{instructions}}'}
                      </span>
                    </div>
                    {formPermissionProfile.value === 'auto' && (
                      <div class="form-group">
                        <label>Allowed Tools</label>
                        <textarea
                          value={formAllowedTools.value}
                          onInput={(e) => (formAllowedTools.value = (e.target as HTMLTextAreaElement).value)}
                          placeholder="Edit,Read,Bash(git *)"
                          style="width:100%;min-height:60px;font-family:monospace;font-size:12px"
                        />
                        <span class="form-hint">
                          Comma-separated. e.g. Edit,Read,Write,Bash(git *)
                        </span>
                      </div>
                    )}
                    <label class="agent-checkbox-label">
                      <input
                        type="checkbox"
                        checked={formAutoPlan.value}
                        onChange={(e) => (formAutoPlan.value = (e.target as HTMLInputElement).checked)}
                      />
                      <span>Auto-plan</span>
                      <span class="form-hint" style="margin-left:0">— agent creates a plan before implementing</span>
                    </label>
                  </>
                )}
              </div>
            </details>

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
