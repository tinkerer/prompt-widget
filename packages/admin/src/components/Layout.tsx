import { ComponentChildren } from 'preact';
import { useEffect, useRef, useCallback, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { currentRoute, clearToken, navigate, selectedAppId, applications, unlinkedCount, appFeedbackCounts } from '../lib/state.js';
import { api } from '../lib/api.js';
import { GlobalTerminalPanel } from './GlobalTerminalPanel.js';
import { Tooltip } from './Tooltip.js';
import { ShortcutHelpModal } from './ShortcutHelpModal.js';
import { registerShortcut } from '../lib/shortcuts.js';
import { toggleTheme, showTabs } from '../lib/settings.js';
import {
  openTabs,
  panelHeight,
  panelMinimized,
  persistPanelState,
  sidebarCollapsed,
  sidebarWidth,
  toggleSidebar,
  allSessions,
  startSessionPolling,
  openSession,
  deleteSession,
  sessionsDrawerOpen,
  sessionSearchQuery,
  toggleSessionsDrawer,
  sessionsHeight,
  setSessionsHeight,
  setSidebarWidth,
} from '../lib/sessions.js';

const liveConnectionCounts = signal<Record<string, number>>({});
const totalLiveConnections = signal(0);

async function pollLiveConnections() {
  try {
    const conns = await api.getLiveConnections();
    totalLiveConnections.value = conns.length;
    const counts: Record<string, number> = {};
    for (const c of conns) {
      const key = c.appId || '__unlinked__';
      counts[key] = (counts[key] || 0) + 1;
    }
    liveConnectionCounts.value = counts;
  } catch {
    // ignore
  }
}

export function Layout({ children }: { children: ComponentChildren }) {
  const route = currentRoute.value;
  const hasTabs = openTabs.value.length > 0;
  const minimizedHeight = showTabs.value ? 66 : 32;
  const bottomPad = hasTabs ? (panelMinimized.value ? minimizedHeight : panelHeight.value) : 0;
  const collapsed = sidebarCollapsed.value;
  const width = sidebarWidth.value;
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  useEffect(() => {
    pollLiveConnections();
    const liveInterval = setInterval(pollLiveConnections, 5_000);
    const stopSessionPolling = startSessionPolling();
    return () => {
      clearInterval(liveInterval);
      stopSessionPolling();
    };
  }, []);

  useEffect(() => {
    const cleanups = [
      registerShortcut({
        key: '?',
        label: 'Show keyboard shortcuts',
        category: 'General',
        action: () => setShowShortcutHelp(true),
      }),
      registerShortcut({
        key: 't',
        label: 'Toggle theme',
        category: 'General',
        action: toggleTheme,
      }),
      registerShortcut({
        key: 'Escape',
        label: 'Close modal',
        category: 'General',
        action: () => setShowShortcutHelp(false),
      }),
      registerShortcut({
        key: '\\',
        modifiers: { ctrl: true },
        label: 'Toggle sidebar',
        category: 'Panels',
        action: toggleSidebar,
      }),
      registerShortcut({
        key: '`',
        label: 'Toggle terminal panel',
        category: 'Panels',
        action: () => {
          if (openTabs.value.length > 0) {
            panelMinimized.value = !panelMinimized.value;
            persistPanelState();
          }
        },
      }),
      registerShortcut({
        sequence: 'g f',
        key: 'f',
        label: 'Go to Feedback',
        category: 'Navigation',
        action: () => {
          const appId = selectedAppId.value || applications.value[0]?.id;
          if (appId) navigate(`/app/${appId}/feedback`);
        },
      }),
      registerShortcut({
        sequence: 'g a',
        key: 'a',
        label: 'Go to Agents',
        category: 'Navigation',
        action: () => {
          const appId = selectedAppId.value || applications.value[0]?.id;
          if (appId) navigate(`/app/${appId}/agents`);
        },
      }),
      registerShortcut({
        sequence: 'g g',
        key: 'g',
        label: 'Go to Aggregate',
        category: 'Navigation',
        action: () => {
          const appId = selectedAppId.value || applications.value[0]?.id;
          if (appId) navigate(`/app/${appId}/aggregate`);
        },
      }),
      registerShortcut({
        sequence: 'g s',
        key: 's',
        label: 'Go to Sessions',
        category: 'Navigation',
        action: () => {
          const appId = selectedAppId.value || applications.value[0]?.id;
          if (appId) navigate(`/app/${appId}/sessions`);
        },
      }),
      registerShortcut({
        sequence: 'g l',
        key: 'l',
        label: 'Go to Live',
        category: 'Navigation',
        action: () => {
          const appId = selectedAppId.value || applications.value[0]?.id;
          if (appId) navigate(`/app/${appId}/live`);
        },
      }),
      registerShortcut({
        sequence: 'g p',
        key: 'p',
        label: 'Go to Preferences',
        category: 'Navigation',
        action: () => navigate('/settings/preferences'),
      }),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  const sessions = allSessions.value;
  const tabs = openTabs.value;
  const tabSet = new Set(tabs);
  const recentSessions = [...sessions]
    .sort((a, b) => {
      const aOpen = tabSet.has(a.id) ? 0 : 1;
      const bOpen = tabSet.has(b.id) ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      const statusOrder = (s: string) =>
        s === 'running' ? 0 : s === 'pending' ? 1 : 2;
      const diff = statusOrder(a.status) - statusOrder(b.status);
      if (diff !== 0) return diff;
      return new Date(b.startedAt || b.createdAt || 0).getTime() -
        new Date(a.startedAt || a.createdAt || 0).getTime();
    });

  const apps = applications.value;
  const selAppId = selectedAppId.value;
  const hasUnlinked = unlinkedCount.value > 0;
  const fbCounts = appFeedbackCounts.value;
  const runningSessions = sessions.filter((s: any) => s.status === 'running').length;

  const settingsItems = [
    { path: '/settings/applications', label: 'Applications', icon: '\u{1F4E6}' },
    { path: '/settings/getting-started', label: 'Getting Started', icon: '\u{1F4D6}' },
    { path: '/settings/preferences', label: 'Preferences', icon: '\u2699' },
  ];

  return (
    <div class="layout">
      <div class={`sidebar ${collapsed ? 'collapsed' : ''}`} style={{ width: `${width}px` }}>
        <div class="sidebar-header">
          <Tooltip text={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} shortcut="Ctrl+\" position="right">
            <button class="sidebar-toggle" onClick={toggleSidebar}>
              &#9776;
            </button>
          </Tooltip>
          <span class="sidebar-title">Prompt Widget</span>
        </div>
        <nav>
          {!collapsed && apps.length > 0 && (
            <div class="sidebar-section-header">Apps</div>
          )}
          {apps.map((app) => {
            const isSelected = selAppId === app.id;
            return (
              <div key={app.id}>
                <a
                  href={`#/app/${app.id}/feedback`}
                  class={`sidebar-app-item ${isSelected ? 'active' : ''}`}
                  onClick={(e) => { e.preventDefault(); navigate(`/app/${app.id}/feedback`); }}
                  title={collapsed ? app.name : undefined}
                >
                  <span class="nav-icon">{'\u{1F4BB}'}</span>
                  <span class="nav-label">{app.name}</span>
                </a>
                {isSelected && !collapsed && (
                  <div class="sidebar-subnav">
                    <a
                      href={`#/app/${app.id}/feedback`}
                      class={route === `/app/${app.id}/feedback` || route.startsWith(`/app/${app.id}/feedback/`) ? 'active' : ''}
                      onClick={(e) => { e.preventDefault(); navigate(`/app/${app.id}/feedback`); }}
                    >
                      {'\u{1F4CB}'} Feedback
                      {fbCounts[app.id] > 0 && <span class="sidebar-count">{fbCounts[app.id]}</span>}
                    </a>
                    <a
                      href={`#/app/${app.id}/agents`}
                      class={route === `/app/${app.id}/agents` ? 'active' : ''}
                      onClick={(e) => { e.preventDefault(); navigate(`/app/${app.id}/agents`); }}
                    >
                      {'\u{1F916}'} Agents
                    </a>
                    <a
                      href={`#/app/${app.id}/aggregate`}
                      class={route === `/app/${app.id}/aggregate` ? 'active' : ''}
                      onClick={(e) => { e.preventDefault(); navigate(`/app/${app.id}/aggregate`); }}
                    >
                      {'\u{1F4CA}'} Aggregate
                    </a>
                    <a
                      href={`#/app/${app.id}/sessions`}
                      class={route === `/app/${app.id}/sessions` ? 'active' : ''}
                      onClick={(e) => { e.preventDefault(); navigate(`/app/${app.id}/sessions`); }}
                    >
                      {'\u26A1'} Sessions
                    </a>
                    <a
                      href={`#/app/${app.id}/live`}
                      class={route === `/app/${app.id}/live` ? 'active' : ''}
                      onClick={(e) => { e.preventDefault(); navigate(`/app/${app.id}/live`); }}
                    >
                      {'\u{1F310}'} Live
                      {(liveConnectionCounts.value[app.id] || 0) > 0 && (
                        <span class="sidebar-count">{liveConnectionCounts.value[app.id]}</span>
                      )}
                    </a>
                  </div>
                )}
              </div>
            );
          })}
          {hasUnlinked && (
            <div>
              <a
                href="#/app/__unlinked__/feedback"
                class={`sidebar-app-item ${selAppId === '__unlinked__' ? 'active' : ''}`}
                onClick={(e) => { e.preventDefault(); navigate('/app/__unlinked__/feedback'); }}
                title={collapsed ? 'Unlinked' : undefined}
              >
                <span class="nav-icon">{'\u{1F517}'}</span>
                <span class="nav-label">Unlinked</span>
                {!collapsed && unlinkedCount.value > 0 && <span class="sidebar-count">{unlinkedCount.value}</span>}
              </a>
              {selAppId === '__unlinked__' && !collapsed && (
                <div class="sidebar-subnav">
                  <a
                    href="#/app/__unlinked__/feedback"
                    class={route.startsWith('/app/__unlinked__/feedback') ? 'active' : ''}
                    onClick={(e) => { e.preventDefault(); navigate('/app/__unlinked__/feedback'); }}
                  >
                    {'\u{1F4CB}'} Feedback
                  </a>
                </div>
              )}
            </div>
          )}

          <div class="sidebar-divider" />

          {!collapsed && (
            <div class="sidebar-section-header">Settings</div>
          )}
          {settingsItems.map((item) => (
            <a
              key={item.path}
              href={`#${item.path}`}
              class={route === item.path ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); navigate(item.path); }}
              title={collapsed ? item.label : undefined}
            >
              <span class="nav-icon">{item.icon}</span>
              <span class="nav-label">{item.label}</span>
            </a>
          ))}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              clearToken();
              navigate('/login');
            }}
            title={collapsed ? 'Logout' : undefined}
          >
            <span class="nav-icon">{'\u21A9'}</span>
            <span class="nav-label">Logout</span>
          </a>
        </nav>
        {!collapsed && (
          <>
            <div
              class="sidebar-resize-handle"
              onMouseDown={(e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startH = sessionsHeight.value;
                const onMove = (ev: MouseEvent) => {
                  setSessionsHeight(startH - (ev.clientY - startY));
                };
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            />
            <div
              class={`sidebar-sessions ${sessionsDrawerOpen.value ? 'open' : 'closed'}`}
              style={sessionsDrawerOpen.value ? { height: `${sessionsHeight.value}px` } : undefined}
            >
              <div class="sidebar-sessions-header" onClick={toggleSessionsDrawer}>
                <span class={`sessions-chevron ${sessionsDrawerOpen.value ? 'expanded' : ''}`}>{'\u25B8'}</span>
                Sessions ({sessions.length})
                {runningSessions > 0 && <span class="sidebar-running-badge">{runningSessions} running</span>}
              </div>
              {sessionsDrawerOpen.value && (
                <>
                  <div class="sidebar-sessions-search">
                    <input
                      type="text"
                      placeholder="Search sessions..."
                      value={sessionSearchQuery.value}
                      onInput={(e) => (sessionSearchQuery.value = (e.target as HTMLInputElement).value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div class="sidebar-sessions-list">
                    {recentSessions
                      .filter((s) => {
                        if (!sessionSearchQuery.value) return true;
                        const q = sessionSearchQuery.value.toLowerCase();
                        const text = (s.feedbackTitle || s.agentName || s.id).toLowerCase();
                        return text.includes(q);
                      })
                      .filter((s) => s.status !== 'deleted')
                      .map((s, i, arr) => {
                        const isTabbed = tabSet.has(s.id);
                        const prevTabbed = i > 0 && tabSet.has(arr[i - 1].id);
                        const isPlain = s.permissionProfile === 'plain';
                        const raw = isPlain ? `Terminal ${s.id.slice(-6)}` : (s.feedbackTitle || s.agentName || `Session ${s.id.slice(-6)}`);
                        const tooltip = isPlain
                          ? `Terminal \u2014 ${s.status}`
                          : s.feedbackTitle
                            ? `${s.feedbackTitle} \u2014 ${s.status}`
                            : `${s.agentName || 'Session'} \u2014 ${s.status}`;
                        return (
                          <div key={s.id}>
                            {i > 0 && prevTabbed && !isTabbed && (
                              <div class="sidebar-divider" style={{ margin: '4px 0' }} />
                            )}
                            <div
                              class={`sidebar-session-item ${isTabbed ? 'tabbed' : ''}`}
                              onClick={() => openSession(s.id)}
                              title={tooltip}
                            >
                              <span class={`session-status-dot ${s.status}`} title={s.status} />
                              <span class="session-label">{raw}</span>
                              <button
                                class="session-delete-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteSession(s.id);
                                }}
                                title="Archive session"
                              >
                                {'\u00D7'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {!collapsed && (
        <div
          class="sidebar-edge-handle"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = width;
            const onMove = (ev: MouseEvent) => setSidebarWidth(startW + (ev.clientX - startX));
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        />
      )}
      <div class="main" style={{ paddingBottom: bottomPad ? `${bottomPad + 16}px` : undefined }}>
        {children}
      </div>
      <GlobalTerminalPanel />
      {showShortcutHelp && <ShortcutHelpModal onClose={() => setShowShortcutHelp(false)} />}
    </div>
  );
}
