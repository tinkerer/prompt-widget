import { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { currentRoute, clearToken, navigate } from '../lib/state.js';
import { GlobalTerminalPanel } from './GlobalTerminalPanel.js';
import {
  openTabs,
  panelHeight,
  panelMinimized,
  sidebarCollapsed,
  sidebarWidth,
  toggleSidebar,
  allSessions,
  startSessionPolling,
  openSession,
} from '../lib/sessions.js';

export function Layout({ children }: { children: ComponentChildren }) {
  const route = currentRoute.value;
  const hasTabs = openTabs.value.length > 0;
  const bottomPad = hasTabs ? (panelMinimized.value ? 36 : panelHeight.value) : 0;
  const collapsed = sidebarCollapsed.value;
  const width = sidebarWidth.value;

  useEffect(() => startSessionPolling(), []);

  const sessions = allSessions.value;
  const recentSessions = [...sessions]
    .sort((a, b) => {
      const statusOrder = (s: string) =>
        s === 'running' ? 0 : s === 'pending' ? 1 : 2;
      const diff = statusOrder(a.status) - statusOrder(b.status);
      if (diff !== 0) return diff;
      return new Date(b.startedAt || b.createdAt || 0).getTime() -
        new Date(a.startedAt || a.createdAt || 0).getTime();
    })
    .slice(0, 10);

  const navItems = [
    { path: '/', match: (r: string) => r === '/' || r === '', icon: '\u{1F4CB}', label: 'Feedback' },
    { path: '/sessions', match: (r: string) => r === '/sessions', icon: '\u26A1', label: 'Sessions' },
    { path: '/applications', match: (r: string) => r === '/applications', icon: '\u{1F4E6}', label: 'Applications' },
    { path: '/agents', match: (r: string) => r === '/agents', icon: '\u{1F916}', label: 'Agent Endpoints' },
    { path: '/getting-started', match: (r: string) => r === '/getting-started', icon: '\u{1F4D6}', label: 'Getting Started' },
  ];

  return (
    <div class="layout">
      <div class={`sidebar ${collapsed ? 'collapsed' : ''}`} style={{ width: `${width}px` }}>
        <div class="sidebar-header">
          <button class="sidebar-toggle" onClick={toggleSidebar} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            &#9776;
          </button>
          <span class="sidebar-title">Prompt Widget</span>
        </div>
        <nav>
          {navItems.map((item) => (
            <a
              key={item.path}
              href={`#${item.path}`}
              class={item.match(route) ? 'active' : ''}
              onClick={() => navigate(item.path)}
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
          <div class="sidebar-sessions">
            <div class="sidebar-sessions-header">
              Sessions ({sessions.length})
            </div>
            {recentSessions.map((s) => (
              <div
                key={s.id}
                class="sidebar-session-item"
                onClick={() => openSession(s.id)}
                title={`${s.id} — ${s.status}`}
              >
                <span class={`session-status-dot ${s.status}`} />
                <span style={{ fontFamily: "'SF Mono', Monaco, monospace" }}>{s.id.slice(-8)}</span>
                <span style={{ opacity: 0.6, fontSize: '11px' }}>{s.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div class="main" style={{ paddingBottom: bottomPad ? `${bottomPad + 16}px` : undefined }}>
        {children}
      </div>
      <GlobalTerminalPanel />
    </div>
  );
}
