import { signal, computed } from '@preact/signals';
import { api } from './api.js';
import type { ViewMode } from '../components/SessionViewToggle.js';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export const openTabs = signal<string[]>(loadJson('pw-open-tabs', []));
export const activeTabId = signal<string | null>(loadJson('pw-active-tab', null));
export const panelMinimized = signal(loadJson('pw-panel-minimized', false));
export const panelHeight = signal(loadJson('pw-panel-height', 400));
export const exitedSessions = signal<Set<string>>(new Set(loadJson<string[]>('pw-exited-sessions', [])));

export const poppedOutTabIds = signal<string[]>(loadJson('pw-popout-tab-ids', []));
export const activePopoutTabId = signal<string | null>(loadJson('pw-popout-active', null));
export const popoutVisible = signal<boolean>(loadJson('pw-popout-visible', true));
export const popoutFloatingRect = signal<{ x: number; y: number; w: number; h: number }>(
  loadJson('pw-popout-rect', { x: 200, y: 100, w: 700, h: 500 })
);
export const popoutDocked = signal<boolean>(loadJson('pw-popout-docked', true));
export const popoutDockedRect = signal<{ top: number; height: number; width: number }>(
  loadJson('pw-popout-docked-rect', { top: 60, height: 500, width: 500 })
);

export const viewModes = signal<Record<string, ViewMode>>({});

export function getViewMode(sessionId: string, permissionProfile?: string): ViewMode {
  if (viewModes.value[sessionId]) return viewModes.value[sessionId];
  if (permissionProfile === 'auto' || permissionProfile === 'yolo') return 'structured';
  return 'terminal';
}

export function setViewMode(sessionId: string, mode: ViewMode) {
  viewModes.value = { ...viewModes.value, [sessionId]: mode };
}

function persistTabs() {
  localStorage.setItem('pw-open-tabs', JSON.stringify(openTabs.value));
  localStorage.setItem('pw-active-tab', JSON.stringify(activeTabId.value));
  localStorage.setItem('pw-panel-minimized', JSON.stringify(panelMinimized.value));
  localStorage.setItem('pw-exited-sessions', JSON.stringify([...exitedSessions.value]));
}

export function persistPanelState() {
  localStorage.setItem('pw-panel-height', JSON.stringify(panelHeight.value));
  localStorage.setItem('pw-panel-minimized', JSON.stringify(panelMinimized.value));
}

export function persistPopoutState() {
  localStorage.setItem('pw-popout-tab-ids', JSON.stringify(poppedOutTabIds.value));
  localStorage.setItem('pw-popout-active', JSON.stringify(activePopoutTabId.value));
  localStorage.setItem('pw-popout-visible', JSON.stringify(popoutVisible.value));
  localStorage.setItem('pw-popout-rect', JSON.stringify(popoutFloatingRect.value));
  localStorage.setItem('pw-popout-docked', JSON.stringify(popoutDocked.value));
  localStorage.setItem('pw-popout-docked-rect', JSON.stringify(popoutDockedRect.value));
}

function nudgeResize() {
  for (const delay of [50, 150, 300]) {
    setTimeout(() => window.dispatchEvent(new Event('resize')), delay);
  }
}

export function popOutTab(sessionId: string) {
  openTabs.value = openTabs.value.filter((id) => id !== sessionId);
  if (activeTabId.value === sessionId) {
    const tabs = openTabs.value;
    activeTabId.value = tabs.length > 0 ? tabs[tabs.length - 1] : null;
  }
  if (!poppedOutTabIds.value.includes(sessionId)) {
    poppedOutTabIds.value = [...poppedOutTabIds.value, sessionId];
  }
  activePopoutTabId.value = sessionId;
  popoutVisible.value = true;
  persistTabs();
  persistPopoutState();
  nudgeResize();
}

export function popBackIn(sessionId?: string) {
  const sid = sessionId || activePopoutTabId.value;
  if (!sid) return;
  poppedOutTabIds.value = poppedOutTabIds.value.filter((id) => id !== sid);
  if (activePopoutTabId.value === sid) {
    activePopoutTabId.value = poppedOutTabIds.value.length > 0
      ? poppedOutTabIds.value[poppedOutTabIds.value.length - 1]
      : null;
  }
  if (!openTabs.value.includes(sid)) {
    openTabs.value = [...openTabs.value, sid];
  }
  activeTabId.value = sid;
  panelMinimized.value = false;
  persistTabs();
  persistPopoutState();
  persistPanelState();
  nudgeResize();
}

export function popBackInAll() {
  const ids = [...poppedOutTabIds.value];
  poppedOutTabIds.value = [];
  activePopoutTabId.value = null;
  for (const sid of ids) {
    if (!openTabs.value.includes(sid)) {
      openTabs.value = [...openTabs.value, sid];
    }
  }
  if (ids.length > 0) activeTabId.value = ids[ids.length - 1];
  panelMinimized.value = false;
  persistTabs();
  persistPopoutState();
  persistPanelState();
  nudgeResize();
}

export function togglePopoutVisibility() {
  if (poppedOutTabIds.value.length === 0) {
    const active = activeTabId.value;
    if (active) popOutTab(active);
    return;
  }
  popoutVisible.value = !popoutVisible.value;
  persistPopoutState();
  if (popoutVisible.value) nudgeResize();
}

export function setPopoutDocked(docked: boolean) {
  popoutDocked.value = docked;
  persistPopoutState();
  nudgeResize();
}

export function togglePopOutActive() {
  const active = activeTabId.value;
  if (active) popOutTab(active);
}

export const quickDispatchState = signal<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});
export const cachedAgents = signal<any[]>([]);

export const SIDEBAR_WIDTH_COLLAPSED = 56;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 500;
export const SIDEBAR_DEFAULT_WIDTH = 220;

export const sidebarCollapsed = signal(localStorage.getItem('pw-sidebar-collapsed') === 'true');
export const sidebarWidth = signal(
  sidebarCollapsed.value ? SIDEBAR_WIDTH_COLLAPSED : loadJson('pw-sidebar-width', SIDEBAR_DEFAULT_WIDTH)
);

export const allSessions = signal<any[]>([]);
export const sessionsLoading = signal(false);
export const sessionsDrawerOpen = signal(localStorage.getItem('pw-sessions-drawer') !== 'false');
export const showResolvedSessions = signal(localStorage.getItem('pw-show-resolved') === 'true');
export const sessionSearchQuery = signal('');
export const sessionsHeight = signal(loadJson('pw-sessions-height', 300));

export type SessionStatusFilter = 'running' | 'pending' | 'completed' | 'failed' | 'killed';
export type SessionTypeFilter = 'agent' | 'terminal';

const DEFAULT_STATUS_FILTERS: SessionStatusFilter[] = ['running', 'pending'];
const DEFAULT_TYPE_FILTERS: SessionTypeFilter[] = ['agent', 'terminal'];

export const sessionStatusFilters = signal<Set<SessionStatusFilter>>(
  new Set(loadJson<SessionStatusFilter[]>('pw-session-status-filters', DEFAULT_STATUS_FILTERS))
);
export const sessionTypeFilters = signal<Set<SessionTypeFilter>>(
  new Set(loadJson<SessionTypeFilter[]>('pw-session-type-filters', DEFAULT_TYPE_FILTERS))
);
export const sessionFiltersOpen = signal(loadJson('pw-session-filters-open', false));

export function toggleStatusFilter(status: SessionStatusFilter) {
  const next = new Set(sessionStatusFilters.value);
  if (next.has(status)) next.delete(status);
  else next.add(status);
  sessionStatusFilters.value = next;
  localStorage.setItem('pw-session-status-filters', JSON.stringify([...next]));
}

export function toggleTypeFilter(type: SessionTypeFilter) {
  const next = new Set(sessionTypeFilters.value);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  sessionTypeFilters.value = next;
  localStorage.setItem('pw-session-type-filters', JSON.stringify([...next]));
}

export function toggleSessionFiltersOpen() {
  sessionFiltersOpen.value = !sessionFiltersOpen.value;
  localStorage.setItem('pw-session-filters-open', JSON.stringify(sessionFiltersOpen.value));
}

export function sessionPassesFilters(s: any, tabSet: Set<string>): boolean {
  if (s.status === 'deleted') return false;
  if (tabSet.has(s.id)) return true;

  const statusFilters = sessionStatusFilters.value;
  if (!statusFilters.has(s.status)) return false;

  const typeFilters = sessionTypeFilters.value;
  const isPlain = s.permissionProfile === 'plain';
  const sType: SessionTypeFilter = isPlain ? 'terminal' : 'agent';
  if (!typeFilters.has(sType)) return false;

  return true;
}

export function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem('pw-sidebar-collapsed', String(sidebarCollapsed.value));
  sidebarWidth.value = sidebarCollapsed.value
    ? SIDEBAR_WIDTH_COLLAPSED
    : loadJson('pw-sidebar-width', SIDEBAR_DEFAULT_WIDTH);
}

export function setSidebarWidth(w: number) {
  const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(w, SIDEBAR_MAX_WIDTH));
  sidebarWidth.value = clamped;
  localStorage.setItem('pw-sidebar-width', JSON.stringify(clamped));
}

export function toggleSessionsDrawer() {
  sessionsDrawerOpen.value = !sessionsDrawerOpen.value;
  localStorage.setItem('pw-sessions-drawer', String(sessionsDrawerOpen.value));
}

export function toggleShowResolved() {
  showResolvedSessions.value = !showResolvedSessions.value;
  localStorage.setItem('pw-show-resolved', String(showResolvedSessions.value));
}

export function setSessionsHeight(h: number) {
  const clamped = Math.max(80, Math.min(h, window.innerHeight - 200));
  sessionsHeight.value = clamped;
  localStorage.setItem('pw-sessions-height', JSON.stringify(clamped));
}

export async function loadAllSessions(includeDeleted = false) {
  sessionsLoading.value = true;
  try {
    const tabs = [...openTabs.value];
    for (const pid of poppedOutTabIds.value) {
      if (!tabs.includes(pid)) tabs.push(pid);
    }
    allSessions.value = await api.getAgentSessions(undefined, tabs.length > 0 ? tabs : undefined, includeDeleted);
  } catch {
    // ignore
  } finally {
    sessionsLoading.value = false;
  }
}

export function startSessionPolling(): () => void {
  loadAllSessions();
  const id = setInterval(loadAllSessions, 5000);
  return () => clearInterval(id);
}

export function openSession(sessionId: string) {
  if (!openTabs.value.includes(sessionId)) {
    openTabs.value = [...openTabs.value, sessionId];
  }
  activeTabId.value = sessionId;
  panelMinimized.value = false;
  persistTabs();
}

export function closeTab(sessionId: string) {
  if (poppedOutTabIds.value.includes(sessionId)) {
    poppedOutTabIds.value = poppedOutTabIds.value.filter((id) => id !== sessionId);
    if (activePopoutTabId.value === sessionId) {
      activePopoutTabId.value = poppedOutTabIds.value.length > 0
        ? poppedOutTabIds.value[poppedOutTabIds.value.length - 1] : null;
    }
    persistPopoutState();
    return;
  }
  const oldTabs = openTabs.value;
  const idx = oldTabs.indexOf(sessionId);
  const tabs = oldTabs.filter((id) => id !== sessionId);
  openTabs.value = tabs;
  if (activeTabId.value === sessionId) {
    const neighbor = tabs[Math.min(idx, tabs.length - 1)] ?? null;
    activeTabId.value = neighbor;
  }
  persistTabs();
}

export async function deleteSession(sessionId: string) {
  try {
    await api.archiveAgentSession(sessionId);
    allSessions.value = allSessions.value.map((s) =>
      s.id === sessionId ? { ...s, status: 'deleted' } : s
    );
    closeTab(sessionId);
  } catch (err: any) {
    console.error('Archive session failed:', err.message);
  }
}

export async function permanentlyDeleteSession(sessionId: string) {
  try {
    await api.deleteAgentSession(sessionId);
    allSessions.value = allSessions.value.filter((s) => s.id !== sessionId);
    closeTab(sessionId);
  } catch (err: any) {
    console.error('Delete session failed:', err.message);
  }
}

export async function killSession(sessionId: string) {
  try {
    await api.killAgentSession(sessionId);
    // Optimistically update sidebar status to 'killed' immediately
    allSessions.value = allSessions.value.map((s) =>
      s.id === sessionId ? { ...s, status: 'killed' } : s
    );
    markSessionExited(sessionId);
  } catch (err: any) {
    console.error('Kill failed:', err.message);
  }
}

export function markSessionExited(sessionId: string) {
  const next = new Set(exitedSessions.value);
  next.add(sessionId);
  exitedSessions.value = next;
  persistTabs();
}

export async function resumeSession(sessionId: string): Promise<string | null> {
  try {
    const { sessionId: newId } = await api.resumeAgentSession(sessionId);
    if (poppedOutTabIds.value.includes(sessionId)) {
      poppedOutTabIds.value = poppedOutTabIds.value.map((id) => id === sessionId ? newId : id);
      if (activePopoutTabId.value === sessionId) activePopoutTabId.value = newId;
      persistPopoutState();
    } else {
      const tabs = openTabs.value.map((id) => (id === sessionId ? newId : id));
      openTabs.value = tabs;
      activeTabId.value = newId;
    }
    const next = new Set(exitedSessions.value);
    next.delete(sessionId);
    exitedSessions.value = next;
    persistTabs();
    return newId;
  } catch (err: any) {
    console.error('Resume failed:', err.message);
    return null;
  }
}

export async function spawnTerminal(appId?: string | null) {
  try {
    const data: { appId?: string } = {};
    if (appId && appId !== '__unlinked__') data.appId = appId;
    const { sessionId } = await api.spawnTerminal(data);
    openSession(sessionId);
    loadAllSessions();
    return sessionId;
  } catch (err: any) {
    console.error('Spawn terminal failed:', err.message);
    return null;
  }
}

let agentsLoading: Promise<any[]> | null = null;

export async function ensureAgentsLoaded(): Promise<any[]> {
  if (cachedAgents.value.length > 0) return cachedAgents.value;
  if (agentsLoading) return agentsLoading;
  agentsLoading = api.getAgents().then((agents) => {
    cachedAgents.value = agents;
    agentsLoading = null;
    return agents;
  });
  return agentsLoading;
}

export async function quickDispatch(feedbackId: string, appId?: string | null) {
  quickDispatchState.value = { ...quickDispatchState.value, [feedbackId]: 'loading' };
  try {
    const agents = appId
      ? await api.getAgents(appId)
      : await ensureAgentsLoaded();
    const appDefault = appId ? agents.find((a: any) => a.isDefault && a.appId === appId) : null;
    const globalDefault = agents.find((a: any) => a.isDefault && !a.appId);
    const defaultAgent = appDefault || globalDefault || agents[0];
    if (!defaultAgent) {
      quickDispatchState.value = { ...quickDispatchState.value, [feedbackId]: 'error' };
      setTimeout(() => {
        quickDispatchState.value = { ...quickDispatchState.value, [feedbackId]: 'idle' };
      }, 2000);
      return;
    }
    const result = await api.dispatch({ feedbackId, agentEndpointId: defaultAgent.id });
    quickDispatchState.value = { ...quickDispatchState.value, [feedbackId]: 'success' };
    if (result.sessionId) {
      openSession(result.sessionId);
    }
  } catch {
    quickDispatchState.value = { ...quickDispatchState.value, [feedbackId]: 'error' };
  }
  setTimeout(() => {
    quickDispatchState.value = { ...quickDispatchState.value, [feedbackId]: 'idle' };
  }, 2000);
}

export async function batchQuickDispatch(feedbackIds: string[], appId?: string | null) {
  await Promise.all(feedbackIds.map((id) => quickDispatch(id, appId)));
}

export const pendingFirstDigit = signal<number | null>(null);
let pendingTabTimer: ReturnType<typeof setTimeout> | null = null;

function clearPending() {
  pendingFirstDigit.value = null;
  if (pendingTabTimer) { clearTimeout(pendingTabTimer); pendingTabTimer = null; }
}

export function handleTabDigit(digit: number) {
  const tabs = openTabs.value;

  if (pendingFirstDigit.value !== null) {
    const combined = pendingFirstDigit.value * 10 + digit;
    clearPending();
    if (combined >= 1 && combined - 1 < tabs.length) openSession(tabs[combined - 1]);
    return;
  }

  // Jump immediately to single-digit tab
  if (digit >= 1 && digit - 1 < tabs.length) openSession(tabs[digit - 1]);

  // Always start pending window for second digit
  pendingFirstDigit.value = digit;
  pendingTabTimer = setTimeout(clearPending, 500);
}

export function handleTabDigit0to9(digit: number) {
  handleTabDigit(digit);
}
