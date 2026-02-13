import { signal, computed } from '@preact/signals';
import { api } from './api.js';

export const openTabs = signal<string[]>([]);
export const activeTabId = signal<string | null>(null);
export const panelMinimized = signal(false);
export const panelHeight = signal(400);
export const exitedSessions = signal<Set<string>>(new Set());
export const quickDispatchState = signal<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({});
export const cachedAgents = signal<any[]>([]);

export const SIDEBAR_WIDTH_EXPANDED = 220;
export const SIDEBAR_WIDTH_COLLAPSED = 56;

export const sidebarCollapsed = signal(localStorage.getItem('pw-sidebar-collapsed') === 'true');
export const sidebarWidth = computed(() =>
  sidebarCollapsed.value ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED
);

export const allSessions = signal<any[]>([]);
export const sessionsLoading = signal(false);

export function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem('pw-sidebar-collapsed', String(sidebarCollapsed.value));
}

export async function loadAllSessions() {
  sessionsLoading.value = true;
  try {
    allSessions.value = await api.getAgentSessions();
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
}

export function closeTab(sessionId: string) {
  const tabs = openTabs.value.filter((id) => id !== sessionId);
  openTabs.value = tabs;
  if (activeTabId.value === sessionId) {
    activeTabId.value = tabs.length > 0 ? tabs[tabs.length - 1] : null;
  }
}

export async function killSession(sessionId: string) {
  try {
    await api.killAgentSession(sessionId);
    markSessionExited(sessionId);
  } catch (err: any) {
    console.error('Kill failed:', err.message);
  }
}

export function markSessionExited(sessionId: string) {
  const next = new Set(exitedSessions.value);
  next.add(sessionId);
  exitedSessions.value = next;
}

export async function resumeSession(sessionId: string): Promise<string | null> {
  try {
    const { sessionId: newId } = await api.resumeAgentSession(sessionId);
    // Replace the old tab with the new session
    const tabs = openTabs.value.map((id) => (id === sessionId ? newId : id));
    openTabs.value = tabs;
    activeTabId.value = newId;
    // Clean up exited state for old session
    const next = new Set(exitedSessions.value);
    next.delete(sessionId);
    exitedSessions.value = next;
    return newId;
  } catch (err: any) {
    console.error('Resume failed:', err.message);
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

export async function quickDispatch(feedbackId: string) {
  quickDispatchState.value = { ...quickDispatchState.value, [feedbackId]: 'loading' };
  try {
    const agents = await ensureAgentsLoaded();
    const defaultAgent = agents.find((a: any) => a.isDefault);
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

export async function batchQuickDispatch(feedbackIds: string[]) {
  for (const id of feedbackIds) {
    await quickDispatch(id);
  }
}
