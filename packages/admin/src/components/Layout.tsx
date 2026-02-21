import { ComponentChildren } from 'preact';
import { useEffect, useRef, useCallback, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { currentRoute, clearToken, navigate, selectedAppId, applications, unlinkedCount, appFeedbackCounts } from '../lib/state.js';
import { api } from '../lib/api.js';
import { GlobalTerminalPanel } from './GlobalTerminalPanel.js';
import { PopoutPanel } from './PopoutPanel.js';
import { Tooltip } from './Tooltip.js';
import { ShortcutHelpModal } from './ShortcutHelpModal.js';
import { SpotlightSearch } from './SpotlightSearch.js';
import { registerShortcut, ctrlShiftHeld } from '../lib/shortcuts.js';
import { toggleTheme, showTabs, arrowTabSwitching } from '../lib/settings.js';
import {
  openTabs,
  activeTabId,
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
  spawnTerminal,
  handleTabDigit0to9,
  togglePopOutActive,
  pendingFirstDigit,
  sessionStatusFilters,
  sessionTypeFilters,
  sessionFiltersOpen,
  toggleStatusFilter,
  toggleTypeFilter,
  toggleSessionFiltersOpen,
  sessionPassesFilters,
  allNumberedSessions,
  popoutPanels,
  findPanelForSession,
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

function SidebarTabBadge({ tabNum }: { tabNum: number }) {
  const pending = pendingFirstDigit.value;
  const digits = String(tabNum);
  if (pending !== null) {
    const pendingStr = String(pending);
    if (!digits.startsWith(pendingStr)) {
      return <span class="sidebar-tab-badge tab-badge-dimmed">{tabNum}</span>;
    }
    return (
      <span class="sidebar-tab-badge tab-badge-pending">
        <span class="tab-badge-green">{pendingStr}</span>
        {digits.slice(pendingStr.length) || ''}
      </span>
    );
  }
  return <span class="sidebar-tab-badge">{tabNum}</span>;
}

export function Layout({ children }: { children: ComponentChildren }) {
  const route = currentRoute.value;
  const hasTabs = openTabs.value.length > 0;
  const minimizedHeight = showTabs.value ? 66 : 32;
  const bottomPad = hasTabs ? (panelMinimized.value ? minimizedHeight : panelHeight.value) : 0;
  const collapsed = sidebarCollapsed.value;
  const width = sidebarWidth.value;
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showSpotlight, setShowSpotlight] = useState(false);

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
        action: () => { setShowShortcutHelp(false); setShowSpotlight(false); },
      }),
      registerShortcut({
        key: ' ',
        code: 'Space',
        modifiers: { ctrl: true, shift: true },
        label: 'Spotlight search',
        category: 'General',
        action: () => setShowSpotlight((v) => !v),
      }),
      registerShortcut({
        key: 'k',
        modifiers: { meta: true },
        label: 'Spotlight search',
        category: 'General',
        action: () => setShowSpotlight((v) => !v),
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
        action: () => navigate('/settings/agents'),
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
      registerShortcut({
        key: 'ArrowUp',
        modifiers: { ctrl: true, shift: true },
        label: 'Previous page',
        category: 'Navigation',
        action: () => { if (arrowTabSwitching.value) cycleNav(-1); },
      }),
      registerShortcut({
        key: 'ArrowDown',
        modifiers: { ctrl: true, shift: true },
        label: 'Next page',
        category: 'Navigation',
        action: () => { if (arrowTabSwitching.value) cycleNav(1); },
      }),
      registerShortcut({
        key: 'ArrowLeft',
        modifiers: { ctrl: true, shift: true },
        label: 'Previous session tab',
        category: 'Panels',
        action: () => { if (arrowTabSwitching.value) cycleSessionTab(-1); },
      }),
      registerShortcut({
        key: 'ArrowRight',
        modifiers: { ctrl: true, shift: true },
        label: 'Next session tab',
        category: 'Panels',
        action: () => { if (arrowTabSwitching.value) cycleSessionTab(1); },
      }),
      registerShortcut({
        sequence: 'g t',
        key: 't',
        label: 'New terminal',
        category: 'Panels',
        action: () => spawnTerminal(selectedAppId.value),
      }),
      // Ctrl+Shift+0-9: tab switching (0 = toggle pop-out, 1-9 = tab by index)
      ...Array.from({ length: 10 }, (_, i) => registerShortcut({
        key: String(i),
        code: `Digit${i}`,
        modifiers: { ctrl: true, shift: true },
        label: `Switch to tab ${i}`,
        category: 'Panels',
        action: () => handleTabDigit0to9(i),
      })),
      registerShortcut({
        key: '_',
        code: 'Minus',
        modifiers: { ctrl: true, shift: true },
        label: 'Toggle pop out / dock',
        category: 'Panels',
        action: togglePopOutActive,
      }),
      registerShortcut({
        key: '+',
        code: 'Equal',
        modifiers: { ctrl: true, shift: true },
        label: 'New terminal',
        category: 'Panels',
        action: () => spawnTerminal(selectedAppId.value),
      }),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  const sessions = allSessions.value;
  const tabs = openTabs.value;
  const tabSet = new Set(tabs);
  for (const panel of popoutPanels.value) {
    for (const sid of panel.sessionIds) tabSet.add(sid);
  }
  const visibleSessions = sessions.filter((s: any) => sessionPassesFilters(s, tabSet));
  const recentSessions = [...visibleSessions]
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
  const nonDeletedSessions = sessions.filter((s: any) => s.status !== 'deleted');
  const statusCounts: Record<string, number> = {};
  const typeCounts = { agent: 0, terminal: 0 };
  for (const s of nonDeletedSessions) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
    if (s.permissionProfile === 'plain') typeCounts.terminal++;
    else typeCounts.agent++;
  }
  const filtersOpen = sessionFiltersOpen.value;
  const activeStatusFilters = sessionStatusFilters.value;
  const activeTypeFilters = sessionTypeFilters.value;
  const activeFilterCount = activeStatusFilters.size + activeTypeFilters.size;

  const appSubTabs = ['feedback', 'aggregate', 'sessions', 'live'];
  const settingsTabs = ['/settings/agents', '/settings/applications', '/settings/getting-started', '/settings/preferences'];

  function cycleNav(dir: number) {
    const r = currentRoute.value;
    const appId = selectedAppId.value;
    if (appId && r.startsWith(`/app/${appId}/`)) {
      const segment = r.replace(`/app/${appId}/`, '').split('/')[0];
      const idx = appSubTabs.indexOf(segment);
      if (idx >= 0) {
        const next = appSubTabs[(idx + dir + appSubTabs.length) % appSubTabs.length];
        navigate(`/app/${appId}/${next}`);
      }
    } else if (r.startsWith('/settings/')) {
      const idx = settingsTabs.indexOf(r);
      if (idx >= 0) {
        navigate(settingsTabs[(idx + dir + settingsTabs.length) % settingsTabs.length]);
      }
    }
  }

  function cycleSessionTab(dir: number) {
    const tabs = openTabs.value;
    if (tabs.length === 0) return;
    const current = activeTabId.value;
    const idx = current ? tabs.indexOf(current) : -1;
    const next = tabs[(idx + dir + tabs.length) % tabs.length];
    openSession(next);
  }

  const settingsItems = [
    { path: '/settings/agents', label: 'Agents', icon: '\u{1F916}' },
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
                Sessions ({visibleSessions.length})
                {runningSessions > 0 && <span class="sidebar-running-badge">{runningSessions} running</span>}
                <button
                  class="sidebar-new-terminal-btn"
                  onClick={(e) => { e.stopPropagation(); spawnTerminal(selAppId); }}
                  title="New terminal (g t)"
                >+</button>
              </div>
              {sessionsDrawerOpen.value && (
                <>
                  <div class="sidebar-sessions-filters">
                    <input
                      type="text"
                      placeholder="Search..."
                      value={sessionSearchQuery.value}
                      onInput={(e) => (sessionSearchQuery.value = (e.target as HTMLInputElement).value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      class={`sidebar-filter-toggle-btn ${filtersOpen ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleSessionFiltersOpen(); }}
                      title="Filter options"
                    >
                      {'\u2630'}
                      {activeFilterCount < 7 && <span class="filter-active-dot" />}
                    </button>
                  </div>
                  {filtersOpen && (
                    <div class="sidebar-filter-panel" onClick={(e) => e.stopPropagation()}>
                      <div class="sidebar-filter-section">
                        <div class="sidebar-filter-section-label">Status</div>
                        <div class="sidebar-filter-checkboxes">
                          {(['running', 'pending', 'completed', 'failed', 'killed'] as const).map((status) => (
                            <label key={status} class="sidebar-filter-checkbox">
                              <input
                                type="checkbox"
                                checked={activeStatusFilters.has(status)}
                                onChange={() => toggleStatusFilter(status)}
                              />
                              <span class={`session-status-dot ${status}`} />
                              <span>{status}</span>
                              {(statusCounts[status] || 0) > 0 && (
                                <span class="sidebar-filter-count">{statusCounts[status]}</span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div class="sidebar-filter-section">
                        <div class="sidebar-filter-section-label">Type</div>
                        <div class="sidebar-filter-checkboxes">
                          {([['agent', 'Agent sessions'], ['terminal', 'Terminals']] as const).map(([type, label]) => (
                            <label key={type} class="sidebar-filter-checkbox">
                              <input
                                type="checkbox"
                                checked={activeTypeFilters.has(type)}
                                onChange={() => toggleTypeFilter(type)}
                              />
                              <span>{label}</span>
                              {typeCounts[type] > 0 && (
                                <span class="sidebar-filter-count">{typeCounts[type]}</span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div class="sidebar-sessions-list">
                    {recentSessions
                      .filter((s) => {
                        if (!sessionSearchQuery.value) return true;
                        const q = sessionSearchQuery.value.toLowerCase();
                        const text = (s.feedbackTitle || s.agentName || s.id).toLowerCase();
                        return text.includes(q);
                      })
                      .map((s, i, arr) => {
                        const isTabbed = tabSet.has(s.id);
                        const isInPanel = !!findPanelForSession(s.id);
                        const isNumbered = isTabbed || isInPanel;
                        const prevTabbed = i > 0 && tabSet.has(arr[i - 1].id);
                        const isPlain = s.permissionProfile === 'plain';
                        const raw = isPlain ? `Terminal ${s.id.slice(-6)}` : (s.feedbackTitle || s.agentName || `Session ${s.id.slice(-6)}`);
                        const tooltip = isPlain
                          ? `Terminal \u2014 ${s.status}`
                          : s.feedbackTitle
                            ? `${s.feedbackTitle} \u2014 ${s.status}`
                            : `${s.agentName || 'Session'} \u2014 ${s.status}`;
                        const globalSessions = allNumberedSessions();
                        const globalIdx = globalSessions.indexOf(s.id);
                        const globalNum = globalIdx >= 0 ? globalIdx + 1 : null;
                        return (
                          <div key={s.id}>
                            {i > 0 && prevTabbed && !isTabbed && (
                              <div class="sidebar-divider" style={{ margin: '4px 0' }} />
                            )}
                            <div
                              class={`sidebar-session-item ${isTabbed ? 'tabbed' : ''} ${isInPanel ? 'in-panel' : ''}`}
                              onClick={() => openSession(s.id)}
                              title={tooltip}
                            >
                              {ctrlShiftHeld.value && isNumbered && globalNum !== null ? (
                                <SidebarTabBadge tabNum={globalNum} />
                              ) : (
                                <span class={`session-status-dot ${s.status}`} title={s.status} />
                              )}
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
      <div class="main" style={{
        paddingBottom: bottomPad ? `${bottomPad + 16}px` : undefined,
      }}>
        {children}
      </div>
      <GlobalTerminalPanel />
      <PopoutPanel />
      {showShortcutHelp && <ShortcutHelpModal onClose={() => setShowShortcutHelp(false)} />}
      {showSpotlight && <SpotlightSearch onClose={() => setShowSpotlight(false)} />}
    </div>
  );
}
