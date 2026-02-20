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
const formMode = signal<'webhook' | 'headless' | 'interactive'>('interactive');
const formPromptTemplate = signal('');
const formPermissionProfile = signal<'interactive' | 'auto' | 'yolo'>('interactive');
const formAllowedTools = signal('');
const formAutoPlan = signal(false);
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
  formMode.value = 'interactive';
  formPromptTemplate.value = '';
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
  formMode.value = agent.mode || 'interactive';
  formPromptTemplate.value = agent.promptTemplate || '';
  formPermissionProfile.value = agent.permissionProfile || 'interactive';
  formAllowedTools.value = agent.allowedTools || '';
  formAutoPlan.value = agent.autoPlan || false;
  formError.value = '';
  // Show advanced if non-default settings are configured
  showAdvanced.value = !!(agent.mode === 'webhook' || agent.promptTemplate || agent.allowedTools || agent.url);
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

const PROFILE_DESCRIPTIONS: Record<string, { label: string; desc: string }> = {
  interactive: { label: 'Supervised', desc: 'You approve each tool use in real-time' },
  auto: { label: 'Autonomous', desc: 'Pre-approved tools run automatically' },
  yolo: { label: 'Full Auto', desc: 'No permission checks (sandboxed only)' },
};

export function AgentsPage() {
  if (!loaded) {
    loaded = true;
    loadAgents();
  }
  return (
    <div>
      <div class="page-header">
        <h2>Agents</h2>
        <button class="btn btn-primary" onClick={openCreate}>Add Agent</button>
      </div>

      <p style="font-size:13px;color:var(--pw-text-muted);margin:-8px 0 16px">
        Agents are compute environments where Claude Code runs. Each application specifies its own project directory.
      </p>

      <div class="agent-list">
        {agents.value.map((agent) => {
          const profile = PROFILE_DESCRIPTIONS[agent.permissionProfile] || PROFILE_DESCRIPTIONS.interactive;
          const isWebhook = agent.mode === 'webhook';
          return (
            <div class="agent-card" key={agent.id}>
              <div class="agent-info">
                <h4>
                  {agent.name}
                  {agent.isDefault && <span class="badge badge-resolved" style="margin-left:8px">default</span>}
                </h4>
                <p style="font-size:12px;color:var(--pw-text-muted);margin:2px 0">
                  {isWebhook ? `Webhook: ${agent.url}` : profile.label}
                  {!isWebhook && agent.autoPlan && ' + Auto-plan'}
                </p>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-sm" onClick={() => openEdit(agent)}>Edit</button>
                <button class="btn btn-sm btn-danger" onClick={() => deleteAgent(agent.id)}>Delete</button>
              </div>
            </div>
          );
        })}
        {agents.value.length === 0 && !loading.value && (
          <div style="text-align:center;padding:40px;color:var(--pw-text-faint)">
            No agents configured. Add one to start dispatching feedback to Claude Code.
          </div>
        )}
      </div>

      {showForm.value && (
        <div class="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) showForm.value = false; }}>
          <form class="modal" onSubmit={saveAgent}>
            <h3>{editingId.value ? 'Edit' : 'Add'} Agent</h3>
            {formError.value && <div class="error-msg">{formError.value}</div>}
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
              <span style="font-size:11px;color:var(--pw-text-faint)">
                Where Claude Code runs — a machine or environment name
              </span>
            </div>
            {formMode.value !== 'webhook' && (
              <div class="form-group">
                <label>Permission Level</label>
                <div style="display:flex;flex-direction:column;gap:8px">
                  {(['interactive', 'auto', 'yolo'] as const).map((p) => {
                    const info = PROFILE_DESCRIPTIONS[p];
                    return (
                      <label
                        key={p}
                        style={`display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;border-radius:6px;border:1px solid ${formPermissionProfile.value === p ? 'var(--pw-primary)' : 'var(--pw-border)'};background:${formPermissionProfile.value === p ? 'var(--pw-primary-bg)' : 'transparent'}`}
                      >
                        <input
                          type="radio"
                          name="permissionProfile"
                          value={p}
                          checked={formPermissionProfile.value === p}
                          onChange={() => (formPermissionProfile.value = p)}
                        />
                        <div>
                          <div style="font-size:13px;font-weight:500">{info.label}</div>
                          <div style="font-size:11px;color:var(--pw-text-faint)">{info.desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {formPermissionProfile.value === 'yolo' && (
                  <div style="background:var(--pw-danger-border);color:#fecaca;padding:8px 12px;border-radius:6px;font-size:12px;margin-top:8px">
                    Full Auto skips ALL permission checks. Only use in sandboxed/Docker environments.
                  </div>
                )}
              </div>
            )}
            <div class="form-group">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input
                  type="checkbox"
                  checked={formDefault.value}
                  onChange={(e) => (formDefault.value = (e.target as HTMLInputElement).checked)}
                />
                Default agent
              </label>
              <span style="font-size:11px;color:var(--pw-text-faint);display:block;margin-top:2px">
                Used automatically when dispatching feedback
              </span>
            </div>

            <div style="margin-top:8px">
              <button
                type="button"
                class="btn btn-sm"
                style="font-size:12px;padding:4px 10px"
                onClick={() => (showAdvanced.value = !showAdvanced.value)}
              >
                {showAdvanced.value ? 'Hide' : 'Show'} advanced options
              </button>
            </div>

            {showAdvanced.value && (
              <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--pw-border)">
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
                        placeholder="Optional custom prompt template. Leave blank for default."
                        style="width:100%;min-height:80px;font-family:monospace;font-size:12px"
                      />
                      <span style="font-size:11px;color:var(--pw-text-faint)">
                        Variables: {'{{feedback.title}}'}, {'{{feedback.description}}'}, {'{{app.name}}'}, {'{{app.projectDir}}'}, {'{{instructions}}'}
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
                        <span style="font-size:11px;color:var(--pw-text-faint)">
                          Comma-separated. e.g. Edit,Read,Write,Bash(git *)
                        </span>
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
                      <span style="font-size:11px;color:var(--pw-text-faint);display:block;margin-top:2px">
                        Agent creates a plan and waits for approval before implementing
                      </span>
                    </div>
                  </>
                )}
              </div>
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
