import { useRef, useCallback } from 'preact/hooks';
import { SessionViewToggle } from './SessionViewToggle.js';
import {
  openTabs,
  activeTabId,
  panelMinimized,
  panelHeight,
  exitedSessions,
  openSession,
  closeTab,
  killSession,
  resumeSession,
  markSessionExited,
  sidebarWidth,
  allSessions,
  persistPanelState,
} from '../lib/sessions.js';
import { navigate, selectedAppId } from '../lib/state.js';
import { showTabs } from '../lib/settings.js';

export function GlobalTerminalPanel() {
  const tabs = openTabs.value;
  if (tabs.length === 0) return null;

  const activeId = activeTabId.value;
  const minimized = panelMinimized.value;
  const height = panelHeight.value;
  const exited = exitedSessions.value;
  const sessions = allSessions.value;
  const sessionMap = new Map(sessions.map((s: any) => [s.id, s]));

  const dragging = useRef(false);

  const onResizeMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newH = window.innerHeight - ev.clientY;
      panelHeight.value = Math.max(150, Math.min(newH, window.innerHeight - 100));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persistPanelState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const hasTabs = showTabs.value;
  const toggleMinimized = () => { panelMinimized.value = !panelMinimized.value; persistPanelState(); };

  const activeHeader = activeId && (() => {
    const sess = sessionMap.get(activeId);
    const appId = selectedAppId.value;
    const feedbackPath = sess?.feedbackId
      ? appId ? `/app/${appId}/feedback/${sess.feedbackId}` : `/feedback/${sess.feedbackId}`
      : null;
    return (
      <div class="terminal-active-header">
        <span style="color:var(--pw-terminal-text-dim);font-size:12px;font-family:monospace;margin-right:8px">{activeId.slice(-8)}</span>
        {feedbackPath && (
          <a
            href={`#${feedbackPath}`}
            onClick={(e) => { e.preventDefault(); navigate(feedbackPath); }}
            style="color:var(--pw-primary-text);font-size:12px;text-decoration:none;margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title={sess?.feedbackTitle || 'View feedback'}
          >
            {sess?.feedbackTitle ? (sess.feedbackTitle.length > 50 ? sess.feedbackTitle.slice(0, 50) + '\u2026' : sess.feedbackTitle) : 'View feedback'}
          </a>
        )}
        {!feedbackPath && <span style="margin-right:auto" />}
        {exited.has(activeId) ? (
          <button class="resume-btn" onClick={() => resumeSession(activeId)}>Resume</button>
        ) : (
          <button class="kill-btn" onClick={() => killSession(activeId)}>Kill</button>
        )}
        <button class="terminal-collapse-btn" onClick={toggleMinimized}>
          {minimized ? '▲' : '▼'}
        </button>
      </div>
    );
  })();

  return (
    <div
      class="global-terminal-panel"
      style={{ height: minimized ? (hasTabs ? '66px' : '32px') : `${height}px`, left: `${sidebarWidth.value}px` }}
    >
      <div class="terminal-resize-handle" onMouseDown={onResizeMouseDown} />
      {hasTabs && (
        <div class="terminal-tab-bar">
          <div class="terminal-tabs">
            {tabs.map((sid) => {
              const isExited = exited.has(sid);
              const isActive = sid === activeId;
              const sess = sessionMap.get(sid);
              const isPlain = sess?.permissionProfile === 'plain';
              const raw = isPlain ? `Terminal ${sid.slice(-6)}` : (sess?.feedbackTitle || sess?.agentName || `Session ${sid.slice(-6)}`);
              const tabLabel = raw.length > 24 ? raw.slice(0, 24) + '\u2026' : raw;
              return (
                <button
                  key={sid}
                  class={`terminal-tab ${isActive ? 'active' : ''}`}
                  onClick={() => openSession(sid)}
                  title={sess?.feedbackTitle || sess?.agentName || sid}
                >
                  <span class={`status-dot ${isExited ? 'exited' : ''}`} />
                  <span>{tabLabel}</span>
                  <span class="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(sid); }}>&times;</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {activeHeader}
      {!minimized && (
        <div class="terminal-body">
          {tabs.map((sid) => (
            <div key={sid} style={{ display: sid === activeId ? 'flex' : 'none', width: '100%', height: '100%' }}>
              <SessionViewToggle
                sessionId={sid}
                isActive={sid === activeId}
                onExit={() => markSessionExited(sid)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
