import { signal, effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { api } from '../lib/api.js';
import { navigate, currentRoute } from '../lib/state.js';
import { quickDispatch, quickDispatchState, batchQuickDispatch, openSession } from '../lib/sessions.js';
import { copyWithTooltip } from '../lib/clipboard.js';

const items = signal<any[]>([]);
const total = signal(0);
const page = signal(1);
const totalPages = signal(0);
const loading = signal(false);
const filterType = signal('');
const filterStatuses = signal<Set<string>>(new Set());
const searchQuery = signal('');
const selected = signal<Set<string>>(new Set());
const currentAppId = signal<string | null>(null);
const showCreateForm = signal(false);
const createTitle = signal('');
const createDescription = signal('');
const createType = signal('manual');
const createTags = signal('');
const createLoading = signal(false);
const isStuck = signal(false);
const dispatchDropdownOpen = signal(false);
const filtersCollapsed = signal(false);
const TYPES = ['', 'manual', 'ab_test', 'analytics', 'error_report', 'programmatic'];
const STATUSES = ['', 'new', 'reviewed', 'dispatched', 'resolved', 'archived', 'deleted'];

async function loadFeedback() {
  loading.value = true;
  try {
    const params: Record<string, string | number> = { page: page.value, limit: 20 };
    if (filterType.value) params.type = filterType.value;
    if (filterStatuses.value.size > 0) params.status = Array.from(filterStatuses.value).join(',');
    if (searchQuery.value) params.search = searchQuery.value;
    if (currentAppId.value) params.appId = currentAppId.value;
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
  void filterStatuses.value;
  void page.value;
  void currentAppId.value;
  void currentRoute.value;
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
  await api.batchOperation({ ids: Array.from(selected.value), operation: 'delete' });
  selected.value = new Set();
  await loadFeedback();
}

async function batchPermanentDelete() {
  if (selected.value.size === 0) return;
  if (!confirm(`Permanently delete ${selected.value.size} items? This cannot be undone.`)) return;
  await api.batchOperation({ ids: Array.from(selected.value), operation: 'permanentDelete' });
  selected.value = new Set();
  await loadFeedback();
}

async function batchRestore() {
  if (selected.value.size === 0) return;
  await api.batchOperation({ ids: Array.from(selected.value), operation: 'updateStatus', value: 'new' });
  selected.value = new Set();
  await loadFeedback();
}

async function createFeedback() {
  if (!createTitle.value.trim() || !currentAppId.value) return;
  createLoading.value = true;
  try {
    const tags = createTags.value.trim()
      ? createTags.value.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;
    const result = await api.createFeedback({
      title: createTitle.value.trim(),
      description: createDescription.value,
      type: createType.value,
      appId: currentAppId.value,
      tags,
    });
    showCreateForm.value = false;
    createTitle.value = '';
    createDescription.value = '';
    createType.value = 'manual';
    createTags.value = '';
    navigate(`/app/${currentAppId.value}/feedback/${result.id}`);
  } catch (err: any) {
    alert('Failed to create: ' + err.message);
  } finally {
    createLoading.value = false;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function StatusCell({ item }: { item: any }) {
  const isDispatched = item.status === 'dispatched';
  const dispatchStatus = item.dispatchStatus;

  if (isDispatched && dispatchStatus && dispatchStatus !== 'running') {
    return (
      <div class="status-cell-compound">
        <span class={`badge badge-dispatch-${dispatchStatus}`}>
          {dispatchStatus}
        </span>
      </div>
    );
  }

  return (
    <div class="status-cell-compound">
      <span class={`badge badge-${item.status}`}>{item.status}</span>
      {isDispatched && dispatchStatus === 'running' && (
        <span class="dispatch-running-dot" title="Agent session running" />
      )}
    </div>
  );
}

function ActionCell({ item }: { item: any }) {
  const hasSession = !!item.latestSessionId;
  const sessionStatus = item.latestSessionStatus;
  const isRunning = hasSession && sessionStatus === 'running';
  const isCompleted = hasSession && !isRunning;
  const dispatchState = quickDispatchState.value[item.id] || 'idle';

  if (isRunning) {
    return (
      <div class="action-cell-group">
        <button
          class="btn-action-live"
          title="Open running session"
          onClick={(e) => { e.stopPropagation(); openSession(item.latestSessionId); }}
        >
          <span class="live-pulse" />
          Live
          {item.sessionCount > 1 && <span class="session-count">{item.sessionCount}</span>}
        </button>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div class="action-cell-group">
        <button
          class="btn-action-view"
          title={`View session (${sessionStatus})`}
          onClick={(e) => { e.stopPropagation(); openSession(item.latestSessionId); }}
        >
          View
          {item.sessionCount > 1 && <span class="session-count">{item.sessionCount}</span>}
        </button>
        <button
          class="btn-dispatch-mini"
          title="Re-dispatch to agent"
          disabled={dispatchState === 'loading'}
          onClick={async (e) => {
            e.stopPropagation();
            await quickDispatch(item.id, currentAppId.value);
            if (quickDispatchState.value[item.id] === 'success') {
              items.value = items.value.map((i) =>
                i.id === item.id ? { ...i, status: 'dispatched' } : i
              );
            }
          }}
        >
          {dispatchState === 'loading' ? <span class="spinner-sm" /> : '↻'}
        </button>
      </div>
    );
  }

  return (
    <button
      class="btn-dispatch-quick"
      disabled={dispatchState === 'loading'}
      onClick={async (e) => {
        e.stopPropagation();
        await quickDispatch(item.id, currentAppId.value);
        if (quickDispatchState.value[item.id] === 'success') {
          items.value = items.value.map((i) =>
            i.id === item.id ? { ...i, status: 'dispatched' } : i
          );
        }
      }}
      title="Dispatch to agent"
    >
      {dispatchState === 'loading' && <span class="spinner-sm" />}
      {dispatchState === 'success' && <span style="color:#22c55e">&#10003;</span>}
      {dispatchState === 'error' && <span style="color:#ef4444">&#10005;</span>}
      {dispatchState === 'idle' && <span>→</span>}
    </button>
  );
}

export function FeedbackListPage({ appId }: { appId: string }) {
  if (currentAppId.value !== appId) {
    currentAppId.value = appId;
    page.value = 1;
    selected.value = new Set();
  }

  useEffect(() => {
    loadFeedback();
    const token = localStorage.getItem('pw-admin-token');
    if (!token) return;
    const es = new EventSource(`/api/v1/admin/feedback/events?token=${encodeURIComponent(token)}`);
    const onEvent = (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      if (!currentAppId.value || data.appId === currentAppId.value) {
        loadFeedback();
      }
    };
    es.addEventListener('new-feedback', onEvent);
    es.addEventListener('feedback-updated', onEvent);
    return () => es.close();
  }, [appId]);

  useEffect(() => {
    const close = () => (dispatchDropdownOpen.value = false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const basePath = `/app/${appId}/feedback`;

  const viewingDeleted = filterStatuses.value.has('deleted');
  const hasSelection = selected.value.size > 0;
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { isStuck.value = !entry.isIntersecting; },
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [appId]);

  return (
    <div>
      <div class="page-header">
        <h2>Feedback ({total.value})</h2>
        <button class="btn btn-sm btn-primary" onClick={() => (showCreateForm.value = !showCreateForm.value)}>
          + New
        </button>
      </div>

      {showCreateForm.value && (
        <div class="detail-card" style="margin-bottom:16px">
          <h3 style="margin-bottom:12px">New Feedback</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <input
              type="text"
              placeholder="Title"
              value={createTitle.value}
              onInput={(e) => (createTitle.value = (e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && createFeedback()}
              style="padding:6px 10px;font-size:14px"
            />
            <textarea
              placeholder="Description (optional)"
              value={createDescription.value}
              onInput={(e) => (createDescription.value = (e.target as HTMLTextAreaElement).value)}
              style="padding:6px 10px;font-size:13px;min-height:80px;resize:vertical;font-family:inherit"
            />
            <div style="display:flex;gap:8px;align-items:center">
              <select
                value={createType.value}
                onChange={(e) => (createType.value = (e.target as HTMLSelectElement).value)}
                style="padding:4px 8px;font-size:13px"
              >
                {TYPES.filter(Boolean).map((t) => (
                  <option value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Tags (comma-separated)"
                value={createTags.value}
                onInput={(e) => (createTags.value = (e.target as HTMLInputElement).value)}
                style="flex:1;padding:4px 8px;font-size:13px"
              />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn btn-sm" onClick={() => (showCreateForm.value = false)}>Cancel</button>
              <button
                class="btn btn-sm btn-primary"
                disabled={!createTitle.value.trim() || createLoading.value}
                onClick={createFeedback}
              >
                {createLoading.value ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={sentinelRef} class="filters-sentinel" />
      <div class={`filters ${hasSelection ? 'has-selection' : ''} ${hasSelection && isStuck.value ? 'stuck' : ''}`}>
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
        <button
          class="btn-filter-toggle"
          onClick={() => (filtersCollapsed.value = !filtersCollapsed.value)}
          title={filtersCollapsed.value ? 'Show status filters' : 'Hide status filters'}
        >
          {filterStatuses.value.size > 0 && <span class="filter-count">{filterStatuses.value.size}</span>}
          <span class={`filter-toggle-chevron ${filtersCollapsed.value ? 'collapsed' : ''}`}>&#9662;</span>
        </button>
        <div class={`filter-pills ${filtersCollapsed.value || hasSelection ? 'collapsed' : ''}`}>
          {STATUSES.filter(Boolean).map((s) => {
            const active = filterStatuses.value.has(s);
            return (
              <button
                key={s}
                class={`status-filter-pill badge-${s} ${active ? 'active' : ''}`}
                onClick={() => {
                  const next = new Set(filterStatuses.value);
                  if (next.has(s)) next.delete(s);
                  else next.add(s);
                  filterStatuses.value = next;
                  page.value = 1;
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
        {hasSelection && (
          <div class="selection-actions">
            <span class="selection-bar-count">{selected.value.size} selected</span>
            {viewingDeleted ? (
              <>
                <button class="btn btn-sm btn-primary" onClick={batchRestore}>
                  Restore
                </button>
                <button class="btn btn-sm btn-danger" onClick={batchPermanentDelete}>
                  Permanently Delete
                </button>
              </>
            ) : (
              <>
                <div class="dispatch-dropdown-wrap" style="position:relative" onClick={(e) => e.stopPropagation()}>
                  <button
                    class="btn btn-sm btn-primary"
                    onClick={() => (dispatchDropdownOpen.value = !dispatchDropdownOpen.value)}
                  >
                    Dispatch &#9662;
                  </button>
                  {dispatchDropdownOpen.value && (
                    <div class="dispatch-dropdown" onClick={(e) => e.stopPropagation()}>
                      <button
                        class="dispatch-dropdown-item"
                        onClick={async () => {
                          dispatchDropdownOpen.value = false;
                          await batchQuickDispatch(Array.from(selected.value), currentAppId.value);
                          loadFeedback();
                        }}
                      >
                        &#9654; Dispatch selected
                      </button>
                    </div>
                  )}
                </div>
                <select
                  class="btn btn-sm"
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    if (v) batchUpdateStatus(v);
                    (e.target as HTMLSelectElement).value = '';
                  }}
                >
                  <option value="">Set status...</option>
                  {STATUSES.filter((s) => s && s !== 'deleted').map((s) => (
                    <option value={s}>{s}</option>
                  ))}
                </select>
                <button class="btn btn-sm btn-danger" onClick={batchDelete}>
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div class="table-wrap">
        <table class={hasSelection ? 'has-selection' : ''}>
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
              <th style="width:60px">ID</th>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Created</th>
              <th style="width:120px">Actions</th>
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
                  <code
                    style="font-size:11px;color:var(--pw-text-faint);background:var(--pw-code-block-bg);padding:1px 5px;border-radius:3px;cursor:pointer"
                    title={`Click to copy: ${item.id}`}
                    onClick={(e) => { e.stopPropagation(); copyWithTooltip(item.id, e as any); }}
                  >
                    {item.id.slice(-6)}
                  </code>
                </td>
                <td>
                  <a
                    href={`#${basePath}/${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`${basePath}/${item.id}`);
                    }}
                    style="color:var(--pw-primary-text);text-decoration:none;font-weight:500"
                  >
                    {item.title}
                  </a>
                </td>
                <td>
                  <span class={`badge badge-${item.type}`}>{item.type.replace(/_/g, ' ')}</span>
                </td>
                <td>
                  <StatusCell item={item} />
                </td>
                <td>
                  <div class="tags">
                    {(item.tags || []).map((t: string) => (
                      <span class="tag">{t}</span>
                    ))}
                  </div>
                </td>
                <td style="white-space:nowrap;color:var(--pw-text-muted);font-size:13px">{formatDate(item.createdAt)}</td>
                <td>
                  <ActionCell item={item} />
                </td>
              </tr>
            ))}
            {items.value.length === 0 && !loading.value && (
              <tr>
                <td colSpan={8} style="text-align:center;padding:32px;color:#94a3b8">
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
