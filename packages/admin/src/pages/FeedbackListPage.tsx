import { signal, effect } from '@preact/signals';
import { api } from '../lib/api.js';
import { navigate } from '../lib/state.js';
import { quickDispatch, quickDispatchState, batchQuickDispatch } from '../lib/sessions.js';

const items = signal<any[]>([]);
const total = signal(0);
const page = signal(1);
const totalPages = signal(0);
const loading = signal(false);
const filterType = signal('');
const filterStatus = signal('');
const searchQuery = signal('');
const selected = signal<Set<string>>(new Set());

const TYPES = ['', 'manual', 'ab_test', 'analytics', 'error_report', 'programmatic'];
const STATUSES = ['', 'new', 'reviewed', 'dispatched', 'resolved', 'archived'];

async function loadFeedback() {
  loading.value = true;
  try {
    const params: Record<string, string | number> = { page: page.value, limit: 20 };
    if (filterType.value) params.type = filterType.value;
    if (filterStatus.value) params.status = filterStatus.value;
    if (searchQuery.value) params.search = searchQuery.value;
    const result = await api.getFeedback(params);
    items.value = result.items;
    total.value = result.total;
    totalPages.value = result.totalPages;
  } catch (err) {
    console.error('Failed to load feedback:', err);
  } finally {
    loading.value = false;
  }
}

effect(() => {
  void filterType.value;
  void filterStatus.value;
  void page.value;
  loadFeedback();
});

function toggleSelect(id: string) {
  const s = new Set(selected.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  selected.value = s;
}

function toggleSelectAll() {
  if (selected.value.size === items.value.length) {
    selected.value = new Set();
  } else {
    selected.value = new Set(items.value.map((i) => i.id));
  }
}

async function batchUpdateStatus(status: string) {
  if (selected.value.size === 0) return;
  await api.batchOperation({ ids: Array.from(selected.value), operation: 'updateStatus', value: status });
  selected.value = new Set();
  await loadFeedback();
}

async function batchDelete() {
  if (selected.value.size === 0) return;
  if (!confirm(`Delete ${selected.value.size} items?`)) return;
  await api.batchOperation({ ids: Array.from(selected.value), operation: 'delete' });
  selected.value = new Set();
  await loadFeedback();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function DispatchButton({ id }: { id: string }) {
  const state = quickDispatchState.value[id] || 'idle';
  return (
    <button
      class="btn-dispatch-quick"
      disabled={state === 'loading'}
      onClick={(e) => {
        e.stopPropagation();
        quickDispatch(id);
      }}
      title="Quick dispatch to default agent"
    >
      {state === 'loading' && <span class="spinner-sm" />}
      {state === 'success' && <span style="color:#22c55e">&#10003;</span>}
      {state === 'error' && <span style="color:#ef4444">&#10005;</span>}
      {state === 'idle' && <span>&#9654;</span>}
    </button>
  );
}

export function FeedbackListPage() {
  return (
    <div>
      <div class="page-header">
        <h2>Feedback ({total.value})</h2>
        <div style="display:flex;gap:8px">
          {selected.value.size > 0 && (
            <>
              <button
                class="btn btn-sm btn-primary"
                onClick={() => batchQuickDispatch(Array.from(selected.value))}
              >
                Dispatch ({selected.value.size})
              </button>
              <select
                class="btn btn-sm"
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  if (v) batchUpdateStatus(v);
                  (e.target as HTMLSelectElement).value = '';
                }}
              >
                <option value="">Set status...</option>
                {STATUSES.filter(Boolean).map((s) => (
                  <option value={s}>{s}</option>
                ))}
              </select>
              <button class="btn btn-sm btn-danger" onClick={batchDelete}>
                Delete ({selected.value.size})
              </button>
            </>
          )}
        </div>
      </div>

      <div class="filters">
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery.value}
          onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              page.value = 1;
              loadFeedback();
            }
          }}
        />
        <select
          value={filterType.value}
          onChange={(e) => {
            filterType.value = (e.target as HTMLSelectElement).value;
            page.value = 1;
          }}
        >
          <option value="">All types</option>
          {TYPES.filter(Boolean).map((t) => (
            <option value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          value={filterStatus.value}
          onChange={(e) => {
            filterStatus.value = (e.target as HTMLSelectElement).value;
            page.value = 1;
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map((s) => (
            <option value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  class="checkbox"
                  checked={selected.value.size === items.value.length && items.value.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Created</th>
              <th style="width:80px">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.value.map((item) => (
              <tr key={item.id}>
                <td>
                  <input
                    type="checkbox"
                    class="checkbox"
                    checked={selected.value.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                  />
                </td>
                <td>
                  <a
                    href={`#/feedback/${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/feedback/${item.id}`);
                    }}
                    style="color:#6366f1;text-decoration:none;font-weight:500"
                  >
                    {item.title}
                  </a>
                </td>
                <td>
                  <span class={`badge badge-${item.type}`}>{item.type.replace(/_/g, ' ')}</span>
                </td>
                <td>
                  <span class={`badge badge-${item.status}`}>{item.status}</span>
                </td>
                <td>
                  <div class="tags">
                    {(item.tags || []).map((t: string) => (
                      <span class="tag">{t}</span>
                    ))}
                  </div>
                </td>
                <td style="white-space:nowrap;color:#64748b;font-size:13px">{formatDate(item.createdAt)}</td>
                <td>
                  <DispatchButton id={item.id} />
                </td>
              </tr>
            ))}
            {items.value.length === 0 && !loading.value && (
              <tr>
                <td colSpan={7} style="text-align:center;padding:32px;color:#94a3b8">
                  No feedback items found
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {totalPages.value > 1 && (
          <div class="pagination">
            <span>
              Page {page.value} of {totalPages.value} ({total.value} items)
            </span>
            <div class="pagination-btns">
              <button
                class="btn btn-sm"
                disabled={page.value <= 1}
                onClick={() => (page.value = page.value - 1)}
              >
                Prev
              </button>
              <button
                class="btn btn-sm"
                disabled={page.value >= totalPages.value}
                onClick={() => (page.value = page.value + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
