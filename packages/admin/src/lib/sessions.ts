import { signal } from '@preact/signals';
import { api } from './api.js';
import { autoNavigateToFeedback } from './settings.js';
import { navigate, selectedAppId } from './state.js';
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
export const previousTabId = signal<string | null>(null);
export const panelMinimized = signal(loadJson('pw-panel-minimized', false));
export const panelHeight = signal(loadJson('pw-panel-height', 400));
export const exitedSessions = signal<Set<string>>(new Set(loadJson<string[]>('pw-exited-sessions', [])));

export const splitEnabled = signal<boolean>(loadJson('pw-split-enabled', false));
export const rightPaneTabs = signal<string[]>(loadJson('pw-right-pane-tabs', []));
export const rightPaneActiveId = signal<string | null>(loadJson('pw-right-pane-active', null));
export const splitRatio = signal<number>(loadJson('pw-split-ratio', 0.5));

export interface PopoutPanelState {
  id: string;
  sessionIds: string[];
  activeSessionId: string;
  docked: boolean;
  visible: boolean;
  floatingRect: { x: number; y: number; w: number; h: number };
  dockedHeight: number;
  dockedWidth: number;
  dockedTopOffset?: number;
  minimized?: boolean;
}

function migrateOldPopoutState(): PopoutPanelState[] {
  const oldIds = loadJson<string[]>('pw-popout-tab-ids', []);
  if (oldIds.length === 0) return loadJson<PopoutPanelState[]>('pw-popout-panels', []);
  const oldActive = loadJson<string | null>('pw-popout-active', null);
  const oldVisible = loadJson<boolean>('pw-popout-visible', true);
  const oldDocked = loadJson<boolean>('pw-popout-docked', true);
  const oldRect = loadJson('pw-popout-rect', { x: 200, y: 100, w: 700, h: 500 });
  const oldDockedRect = loadJson('pw-popout-docked-rect', { top: 60, height: 500, width: 500 });
  const panel: PopoutPanelState = {
    id: 'p-migrated',
    sessionIds: oldIds,
    activeSessionId: oldActive || oldIds[0],
    docked: oldDocked,
    visible: oldVisible,
    floatingRect: oldRect,
    dockedHeight: oldDockedRect.height,
    dockedWidth: oldDockedRect.width,
  };
  localStorage.removeItem('pw-popout-tab-ids');
  localStorage.removeItem('pw-popout-active');
  localStorage.removeItem('pw-popout-visible');
  localStorage.removeItem('pw-popout-rect');
  localStorage.removeItem('pw-popout-docked');
  localStorage.removeItem('pw-popout-docked-rect');
  localStorage.removeItem('pw-docked-panel-width');
  localStorage.setItem('pw-popout-panels', JSON.stringify([panel]));
  return [panel];
}

function ensurePanelWidth(panels: PopoutPanelState[]): PopoutPanelState[] {
  return panels.map((p) => p.dockedWidth ? p : { ...p, dockedWidth: 500 });
}

export const popoutPanels = signal<PopoutPanelState[]>(ensurePanelWidth(migrateOldPopoutState()));

export type DockedOrientation = 'vertical' | 'horizontal';
export const dockedOrientation = signal<DockedOrientation>(loadJson('pw-docked-orientation', 'vertical'));

export function toggleDockedOrientation() {
  dockedOrientation.value = dockedOrientation.value === 'vertical' ? 'horizontal' : 'vertical';
  localStorage.setItem('pw-docked-orientation', JSON.stringify(dockedOrientation.value));
  nudgeResize();
}

export const focusedPanelId = signal<string | null>(null);
let focusTimer: ReturnType<typeof setTimeout> | null = null;

export function setFocusedPanel(panelId: string | null) {
  if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; }
  focusedPanelId.value = panelId;
  if (panelId) {
    focusTimer = setTimeout(() => { focusedPanelId.value = null; }, 2000);
  }
}

export function cyclePanelFocus(direction: 1 | -1) {
  const panels: string[] = [];
  if (openTabs.value.length > 0) {
    if (splitEnabled.value) {
      panels.push('split-left', 'split-right');
    } else {
      panels.push('global');
    }
  }
  for (const p of popoutPanels.value) {
    if (p.visible) panels.push(p.id);
  }
  if (panels.length === 0) return;
  const currentIdx = focusedPanelId.value ? panels.indexOf(focusedPanelId.value) : -1;
  const nextIdx = currentIdx < 0 ? 0 : (currentIdx + direction + panels.length) % panels.length;
  const targetId = panels[nextIdx];
  setFocusedPanel(targetId);

  let container: Element | null = null;
  if (targetId === 'global') {
    container = document.querySelector('.global-terminal-panel');
  } else if (targetId === 'split-left' || targetId === 'split-right') {
    container = document.querySelector(`[data-split-pane="${targetId}"]`);
  } else {
    container = document.querySelector(`[data-panel-id="${targetId}"]`);
  }
  if (container) {
    const textarea = container.querySelector('.xterm-helper-textarea') as HTMLElement | null;
    if (textarea) textarea.focus();
  }
}

export function reorderTabInPanel(panelId: string, sessionId: string, insertBeforeId: string | null) {
  const panel = popoutPanels.value.find((p) => p.id === panelId);
  if (!panel) return;
  const ids = panel.sessionIds.filter((id) => id !== sessionId);
  if (insertBeforeId) {
    const idx = ids.indexOf(insertBeforeId);
    if (idx >= 0) ids.splice(idx, 0, sessionId);
    else ids.push(sessionId);
  } else {
    ids.push(sessionId);
  }
  updatePanel(panelId, { sessionIds: ids });
  persistPopoutState();
}

export function reorderGlobalTab(sessionId: string, insertBeforeId: string | null) {
  const ids = openTabs.value.filter((id) => id !== sessionId);
  if (insertBeforeId) {
    const idx = ids.indexOf(insertBeforeId);
    if (idx >= 0) ids.splice(idx, 0, sessionId);
    else ids.push(sessionId);
  } else {
    ids.push(sessionId);
  }
  openTabs.value = ids;
  persistTabs();
}

export function leftPaneTabs(): string[] {
  if (!splitEnabled.value) return openTabs.value;
  const rightSet = new Set(rightPaneTabs.value);
  return openTabs.value.filter((id) => !rightSet.has(id));
}

export function enableSplit(sessionId?: string) {
  if (splitEnabled.value) return;
  const tabs = openTabs.value;
  if (tabs.length < 2) return;
  const target = sessionId || activeTabId.value;
  if (!target || !tabs.includes(target)) return;
  splitEnabled.value = true;
  rightPaneTabs.value = [target];
  rightPaneActiveId.value = target;
  if (activeTabId.value === target) {
    const remaining = tabs.filter((id) => id !== target);
    activeTabId.value = remaining[remaining.length - 1] || null;
  }
  persistSplitState();
  persistTabs();
  nudgeResize();
}

export function disableSplit() {
  if (!splitEnabled.value) return;
  const rightActive = rightPaneActiveId.value;
  splitEnabled.value = false;
  rightPaneTabs.value = [];
  rightPaneActiveId.value = null;
  if (rightActive && openTabs.value.includes(rightActive)) {
    activeTabId.value = rightActive;
  }
  persistSplitState();
  persistTabs();
  nudgeResize();
}

export function moveToRightPane(sessionId: string) {
  if (!splitEnabled.value) return;
  if (!openTabs.value.includes(sessionId)) return;
  if (rightPaneTabs.value.includes(sessionId)) return;
  rightPaneTabs.value = [...rightPaneTabs.value, sessionId];
  rightPaneActiveId.value = sessionId;
  if (activeTabId.value === sessionId) {
    const left = leftPaneTabs();
    activeTabId.value = left.length > 0 ? left[left.length - 1] : null;
  }
  persistSplitState();
  persistTabs();
  nudgeResize();
}

export function moveToLeftPane(sessionId: string) {
  if (!rightPaneTabs.value.includes(sessionId)) return;
  const remaining = rightPaneTabs.value.filter((id) => id !== sessionId);
  rightPaneTabs.value = remaining;
  if (rightPaneActiveId.value === sessionId) {
    rightPaneActiveId.value = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  }
  activeTabId.value = sessionId;
  if (remaining.length === 0) {
    disableSplit();
    return;
  }
  persistSplitState();
  persistTabs();
  nudgeResize();
}

export function openSessionInRightPane(sessionId: string) {
  if (!splitEnabled.value) enableSplit(sessionId);
  if (!openTabs.value.includes(sessionId)) {
    openTabs.value = [...openTabs.value, sessionId];
  }
  if (!rightPaneTabs.value.includes(sessionId)) {
    rightPaneTabs.value = [...rightPaneTabs.value, sessionId];
  }
  rightPaneActiveId.value = sessionId;
  persistSplitState();
  persistTabs();
}

export function reorderRightPaneTab(sessionId: string, insertBeforeId: string | null) {
  const ids = rightPaneTabs.value.filter((id) => id !== sessionId);
  if (insertBeforeId) {
    const idx = ids.indexOf(insertBeforeId);
    if (idx >= 0) ids.splice(idx, 0, sessionId);
    else ids.push(sessionId);
  } else {
    ids.push(sessionId);
  }
  rightPaneTabs.value = ids;
  persistSplitState();
}

function persistSplitState() {
  localStorage.setItem('pw-split-enabled', JSON.stringify(splitEnabled.value));
  localStorage.setItem('pw-right-pane-tabs', JSON.stringify(rightPaneTabs.value));
  localStorage.setItem('pw-right-pane-active', JSON.stringify(rightPaneActiveId.value));
  localStorage.setItem('pw-split-ratio', JSON.stringify(splitRatio.value));
}

export function setSplitRatio(ratio: number) {
  splitRatio.value = Math.max(0.2, Math.min(0.8, ratio));
  persistSplitState();
}

export interface PanelPreset {
  name: string;
  openTabs: string[];
  activeTabId: string | null;
  panels: PopoutPanelState[];
  panelHeight: number;
  panelMinimized: boolean;
  dockedOrientation: DockedOrientation;
  splitEnabled?: boolean;
  rightPaneTabs?: string[];
  rightPaneActiveId?: string | null;
  splitRatio?: number;
  savedAt: string;
}

export const panelPresets = signal<PanelPreset[]>(loadJson('pw-panel-presets', []));

export function savePreset(name: string) {
  const preset: PanelPreset = {
    name,
    openTabs: openTabs.value,
    activeTabId: activeTabId.value,
    panels: popoutPanels.value,
    panelHeight: panelHeight.value,
    panelMinimized: panelMinimized.value,
    dockedOrientation: dockedOrientation.value,
    splitEnabled: splitEnabled.value,
    rightPaneTabs: rightPaneTabs.value,
    rightPaneActiveId: rightPaneActiveId.value,
    splitRatio: splitRatio.value,
    savedAt: new Date().toISOString(),
  };
  panelPresets.value = [...panelPresets.value.filter((p) => p.name !== name), preset];
  localStorage.setItem('pw-panel-presets', JSON.stringify(panelPresets.value));
}

export function restorePreset(name: string) {
  const preset = panelPresets.value.find((p) => p.name === name);
  if (!preset) return;
  openTabs.value = preset.openTabs;
  activeTabId.value = preset.activeTabId;
  popoutPanels.value = preset.panels;
  panelHeight.value = preset.panelHeight;
  panelMinimized.value = preset.panelMinimized;
  dockedOrientation.value = preset.dockedOrientation;
  splitEnabled.value = preset.splitEnabled ?? false;
  rightPaneTabs.value = preset.rightPaneTabs ?? [];
  rightPaneActiveId.value = preset.rightPaneActiveId ?? null;
  splitRatio.value = preset.splitRatio ?? 0.5;
  localStorage.setItem('pw-docked-orientation', JSON.stringify(preset.dockedOrientation));
  persistTabs();
  persistPopoutState();
  persistPanelState();
  persistSplitState();
  nudgeResize();
}

export function deletePreset(name: string) {
  panelPresets.value = panelPresets.value.filter((p) => p.name !== name);
  localStorage.setItem('pw-panel-presets', JSON.stringify(panelPresets.value));
}

export const snapGuides = signal<{ x?: number; y?: number }[]>([]);

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
  localStorage.setItem('pw-popout-panels', JSON.stringify(popoutPanels.value));
}

function nudgeResize() {
  for (const delay of [50, 150, 300]) {
    setTimeout(() => window.dispatchEvent(new Event('resize')), delay);
  }
}

export function allNumberedSessions(): string[] {
  const result = [...openTabs.value];
  for (const panel of popoutPanels.value) {
    for (const sid of panel.sessionIds) {
      if (!result.includes(sid)) result.push(sid);
    }
  }
  return result;
}

export function findPanelForSession(sessionId: string): PopoutPanelState | undefined {
  return popoutPanels.value.find((p) => p.sessionIds.includes(sessionId));
}

export function updatePanel(panelId: string, updates: Partial<PopoutPanelState>) {
  popoutPanels.value = popoutPanels.value.map((p) =>
    p.id === panelId ? { ...p, ...updates } : p
  );
}

export function removePanel(panelId: string) {
  popoutPanels.value = popoutPanels.value.filter((p) => p.id !== panelId);
}

export function getDockedPanels(): PopoutPanelState[] {
  return popoutPanels.value.filter((p) => p.docked && p.visible);
}

const COLLAPSED_HANDLE_H = 48;

export function getDockedPanelTop(panelId: string): number {
  const docked = popoutPanels.value.filter((p) => p.docked);
  let top = 40;
  for (const p of docked) {
    if (p.id === panelId) return top + (p.visible ? (p.dockedTopOffset || 0) : 0);
    if (p.visible) {
      top += p.dockedHeight + (p.dockedTopOffset || 0) + 4;
    } else {
      top += COLLAPSED_HANDLE_H + 4;
    }
  }
  return top;
}

export function popOutTab(sessionId: string) {
  openTabs.value = openTabs.value.filter((id) => id !== sessionId);
  if (activeTabId.value === sessionId) {
    const tabs = openTabs.value;
    activeTabId.value = tabs.length > 0 ? tabs[tabs.length - 1] : null;
  }
  if (rightPaneTabs.value.includes(sessionId)) {
    const remaining = rightPaneTabs.value.filter((id) => id !== sessionId);
    rightPaneTabs.value = remaining;
    if (rightPaneActiveId.value === sessionId) {
      rightPaneActiveId.value = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
    if (remaining.length === 0 && splitEnabled.value) {
      splitEnabled.value = false;
    }
    persistSplitState();
  }
  // If already in a panel, just make sure it's visible
  const existing = findPanelForSession(sessionId);
  if (existing) {
    updatePanel(existing.id, { activeSessionId: sessionId, visible: true });
    persistTabs();
    persistPopoutState();
    nudgeResize();
    return;
  }
  const panel: PopoutPanelState = {
    id: 'p-' + Math.random().toString(36).slice(2, 8),
    sessionIds: [sessionId],
    activeSessionId: sessionId,
    docked: true,
    visible: true,
    floatingRect: { x: 200, y: 100, w: 700, h: 500 },
    dockedHeight: 400,
    dockedWidth: 500,
  };
  popoutPanels.value = [...popoutPanels.value, panel];
  persistTabs();
  persistPopoutState();
  nudgeResize();
}

export function popBackIn(sessionId: string) {
  if (!sessionId) return;
  const panel = findPanelForSession(sessionId);
  if (panel) {
    const remaining = panel.sessionIds.filter((id) => id !== sessionId);
    if (remaining.length === 0) {
      removePanel(panel.id);
    } else {
      updatePanel(panel.id, {
        sessionIds: remaining,
        activeSessionId: panel.activeSessionId === sessionId
          ? remaining[remaining.length - 1]
          : panel.activeSessionId,
      });
    }
  }
  if (!openTabs.value.includes(sessionId)) {
    openTabs.value = [...openTabs.value, sessionId];
  }
  activeTabId.value = sessionId;
  panelMinimized.value = false;
  persistTabs();
  persistPopoutState();
  persistPanelState();
  nudgeResize();
}

export function popBackInAll() {
  const allIds: string[] = [];
  for (const panel of popoutPanels.value) {
    allIds.push(...panel.sessionIds);
  }
  popoutPanels.value = [];
  for (const sid of allIds) {
    if (!openTabs.value.includes(sid)) {
      openTabs.value = [...openTabs.value, sid];
    }
  }
  if (allIds.length > 0) activeTabId.value = allIds[allIds.length - 1];
  panelMinimized.value = false;
  persistTabs();
  persistPopoutState();
  persistPanelState();
  nudgeResize();
}

export function moveSessionToPanel(sessionId: string, targetPanelId: string) {
  // Remove from main tabs
  if (openTabs.value.includes(sessionId)) {
    openTabs.value = openTabs.value.filter((id) => id !== sessionId);
    if (activeTabId.value === sessionId) {
      activeTabId.value = openTabs.value.length > 0 ? openTabs.value[openTabs.value.length - 1] : null;
    }
  }
  // Remove from source panel
  const srcPanel = findPanelForSession(sessionId);
  if (srcPanel && srcPanel.id !== targetPanelId) {
    const remaining = srcPanel.sessionIds.filter((id) => id !== sessionId);
    if (remaining.length === 0) {
      removePanel(srcPanel.id);
    } else {
      updatePanel(srcPanel.id, {
        sessionIds: remaining,
        activeSessionId: srcPanel.activeSessionId === sessionId
          ? remaining[remaining.length - 1]
          : srcPanel.activeSessionId,
      });
    }
  }
  // Add to target panel
  const target = popoutPanels.value.find((p) => p.id === targetPanelId);
  if (target && !target.sessionIds.includes(sessionId)) {
    updatePanel(targetPanelId, {
      sessionIds: [...target.sessionIds, sessionId],
      activeSessionId: sessionId,
    });
  }
  persistTabs();
  persistPopoutState();
  nudgeResize();
}

export function splitFromPanel(sessionId: string) {
  const srcPanel = findPanelForSession(sessionId);
  if (!srcPanel) return;
  const remaining = srcPanel.sessionIds.filter((id) => id !== sessionId);
  if (remaining.length === 0) {
    removePanel(srcPanel.id);
  } else {
    updatePanel(srcPanel.id, {
      sessionIds: remaining,
      activeSessionId: srcPanel.activeSessionId === sessionId
        ? remaining[remaining.length - 1]
        : srcPanel.activeSessionId,
    });
  }
  const panel: PopoutPanelState = {
    id: 'p-' + Math.random().toString(36).slice(2, 8),
    sessionIds: [sessionId],
    activeSessionId: sessionId,
    docked: true,
    visible: true,
    floatingRect: { x: 200, y: 100, w: 700, h: 500 },
    dockedHeight: 400,
    dockedWidth: 500,
  };
  popoutPanels.value = [...popoutPanels.value, panel];
  persistPopoutState();
  nudgeResize();
}

export function togglePopoutVisibility() {
  if (popoutPanels.value.length === 0) {
    const active = activeTabId.value;
    if (active) popOutTab(active);
    return;
  }
  const anyVisible = popoutPanels.value.some((p) => p.visible);
  popoutPanels.value = popoutPanels.value.map((p) => ({ ...p, visible: !anyVisible }));
  persistPopoutState();
  if (!anyVisible) nudgeResize();
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
export const sidebarAnimating = signal(false);

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
  sidebarAnimating.value = true;
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem('pw-sidebar-collapsed', String(sidebarCollapsed.value));
  sidebarWidth.value = sidebarCollapsed.value
    ? SIDEBAR_WIDTH_COLLAPSED
    : loadJson('pw-sidebar-width', SIDEBAR_DEFAULT_WIDTH);
  setTimeout(() => { sidebarAnimating.value = false; }, 220);
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
    for (const panel of popoutPanels.value) {
      for (const sid of panel.sessionIds) {
        if (!tabs.includes(sid)) tabs.push(sid);
      }
    }
    const sessions = await api.getAgentSessions(undefined, tabs.length > 0 ? tabs : undefined, includeDeleted);
    allSessions.value = sessions;

    // Update waiting state from API for all sessions (covers sessions without open tabs)
    const next = new Set(waitingSessions.value);
    for (const s of sessions) {
      if (s.waitingForInput) next.add(s.id);
      else next.delete(s.id);
    }
    waitingSessions.value = next;
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

export function goToPreviousTab() {
  const prev = previousTabId.value;
  if (!prev) return;
  if (openTabs.value.includes(prev)) {
    openSession(prev);
  }
}

export function openSession(sessionId: string) {
  if (!openTabs.value.includes(sessionId)) {
    openTabs.value = [...openTabs.value, sessionId];
  }
  const current = activeTabId.value;
  if (current && current !== sessionId) {
    previousTabId.value = current;
  }
  activeTabId.value = sessionId;
  panelMinimized.value = false;
  persistTabs();

  if (autoNavigateToFeedback.value) {
    const session = allSessions.value.find((s) => s.id === sessionId);
    if (session?.feedbackId) {
      const appId = selectedAppId.value;
      const path = appId
        ? `/app/${appId}/feedback/${session.feedbackId}`
        : `/feedback/${session.feedbackId}`;
      navigate(path);
    }
  }
}

export function closeTab(sessionId: string) {
  const panel = findPanelForSession(sessionId);
  if (panel) {
    const remaining = panel.sessionIds.filter((id) => id !== sessionId);
    if (remaining.length === 0) {
      removePanel(panel.id);
    } else {
      updatePanel(panel.id, {
        sessionIds: remaining,
        activeSessionId: panel.activeSessionId === sessionId
          ? remaining[remaining.length - 1]
          : panel.activeSessionId,
      });
    }
    persistPopoutState();
    return;
  }
  if (rightPaneTabs.value.includes(sessionId)) {
    const remaining = rightPaneTabs.value.filter((id) => id !== sessionId);
    rightPaneTabs.value = remaining;
    if (rightPaneActiveId.value === sessionId) {
      rightPaneActiveId.value = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
    if (remaining.length === 0 && splitEnabled.value) {
      splitEnabled.value = false;
    }
    persistSplitState();
  }
  const oldTabs = openTabs.value;
  const idx = oldTabs.indexOf(sessionId);
  const tabs = oldTabs.filter((id) => id !== sessionId);
  openTabs.value = tabs;
  if (activeTabId.value === sessionId) {
    const left = splitEnabled.value ? leftPaneTabs() : tabs;
    const neighbor = left[Math.min(idx, left.length - 1)] ?? null;
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
    allSessions.value = allSessions.value.map((s) =>
      s.id === sessionId ? { ...s, status: 'killed' } : s
    );
    markSessionExited(sessionId);
    closeTab(sessionId);
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
    const panel = findPanelForSession(sessionId);
    if (panel) {
      updatePanel(panel.id, {
        sessionIds: panel.sessionIds.map((id) => id === sessionId ? newId : id),
        activeSessionId: panel.activeSessionId === sessionId ? newId : panel.activeSessionId,
      });
      persistPopoutState();
    } else {
      const tabs = openTabs.value.map((id) => (id === sessionId ? newId : id));
      openTabs.value = tabs;
      if (rightPaneTabs.value.includes(sessionId)) {
        rightPaneTabs.value = rightPaneTabs.value.map((id) => id === sessionId ? newId : id);
        if (rightPaneActiveId.value === sessionId) rightPaneActiveId.value = newId;
        persistSplitState();
      } else {
        activeTabId.value = newId;
      }
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

export const actionToast = signal<{ key: string; label: string; color: string } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showActionToast(key: string, label: string, color = 'var(--pw-primary)') {
  if (toastTimer) clearTimeout(toastTimer);
  actionToast.value = { key, label, color };
  toastTimer = setTimeout(() => { actionToast.value = null; }, 1500);
}

export const waitingSessions = signal<Set<string>>(new Set());

export function setSessionWaiting(sessionId: string, waiting: boolean) {
  const next = new Set(waitingSessions.value);
  if (waiting) next.add(sessionId);
  else next.delete(sessionId);
  waitingSessions.value = next;
}

export const hotkeyMenuOpen = signal<{ sessionId: string; x: number; y: number } | null>(null);

export function openHotkeyMenu(sessionId: string) {
  const tab = document.querySelector(`.terminal-tab.active .status-dot`) as HTMLElement | null;
  if (tab) {
    const rect = tab.getBoundingClientRect();
    hotkeyMenuOpen.value = { sessionId, x: rect.left, y: rect.bottom + 4 };
  } else {
    hotkeyMenuOpen.value = { sessionId, x: window.innerWidth / 2 - 60, y: window.innerHeight - 200 };
  }
}

export const pendingFirstDigit = signal<number | null>(null);
let pendingTabTimer: ReturnType<typeof setTimeout> | null = null;

function clearPending() {
  pendingFirstDigit.value = null;
  if (pendingTabTimer) { clearTimeout(pendingTabTimer); pendingTabTimer = null; }
}

function activateGlobalSession(all: string[], num: number) {
  // Blur any focused input so the terminal can grab focus
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (num === 0) {
    togglePopoutVisibility();
    return;
  }
  const idx = num - 1;
  if (idx < 0 || idx >= all.length) return;
  const sid = all[idx];
  if (openTabs.value.includes(sid)) {
    openSession(sid);
    return;
  }
  const panel = findPanelForSession(sid);
  if (panel) {
    if (panel.activeSessionId === sid && panel.visible) {
      updatePanel(panel.id, { visible: false });
    } else {
      updatePanel(panel.id, { activeSessionId: sid, visible: true });
    }
    persistPopoutState();
    nudgeResize();
  }
}

export function handleTabDigit(digit: number) {
  const all = allNumberedSessions();

  if (pendingFirstDigit.value !== null) {
    const combined = pendingFirstDigit.value * 10 + digit;
    clearPending();
    activateGlobalSession(all, combined);
    return;
  }

  activateGlobalSession(all, digit);

  if (digit !== 0) {
    if (all.length >= digit * 10 + 1) {
      pendingFirstDigit.value = digit;
      pendingTabTimer = setTimeout(clearPending, 500);
    }
  }
}

export function handleTabDigit0to9(digit: number) {
  handleTabDigit(digit);
}
