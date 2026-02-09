import { signal } from '@preact/signals';
import { api } from '../lib/api.js';

const agents = signal<any[]>([]);
const loading = signal(true);
const showForm = signal(false);
const editingId = signal<string | null>(null);
const formName = signal('');
const formUrl = signal('');
const formAuth = signal('');
const formDefault = signal(false);
const formError = signal('');
const formLoading = signal(false);

async function loadAgents() {
  loading.value = true;
  try {
    agents.value = await api.getAgents();
  } catch (err) {
    console.error('Failed to load agents:', err);
  } finally {
    loading.value = false;
  }
}

loadAgents();

function openCreate() {
  editingId.value = null;
  formName.value = '';
  formUrl.value = '';
  formAuth.value = '';
  formDefault.value = false;
  formError.value = '';
  showForm.value = true;
}

function openEdit(agent: any) {
  editingId.value = agent.id;
  formName.value = agent.name;
  formUrl.value = agent.url;
  formAuth.value = agent.authHeader || '';
  formDefault.value = agent.isDefault;
  formError.value = '';
  showForm.value = true;
}

async function saveAgent(e: Event) {
  e.preventDefault();
  formError.value = '';
  formLoading.value = true;

  const data = {
    name: formName.value,
    url: formUrl.value,
    authHeader: formAuth.value || undefined,
    isDefault: formDefault.value,
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
  if (!confirm('Delete this agent endpoint?')) return;
  await api.deleteAgent(id);
  await loadAgents();
}

export function AgentsPage() {
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
              </h4>
              <p>{agent.url}</p>
              {agent.authHeader && <p style="font-size:12px;color:#94a3b8">Auth header configured</p>}
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm" onClick={() => openEdit(agent)}>Edit</button>
              <button class="btn btn-sm btn-danger" onClick={() => deleteAgent(agent.id)}>Delete</button>
            </div>
          </div>
        ))}
        {agents.value.length === 0 && !loading.value && (
          <div style="text-align:center;padding:40px;color:#94a3b8">
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
              <label>URL</label>
              <input
                type="url"
                value={formUrl.value}
                onInput={(e) => (formUrl.value = (e.target as HTMLInputElement).value)}
                placeholder="https://agent.example.com/webhook"
                required
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
