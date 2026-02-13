import { useRef, useCallback } from 'preact/hooks';
import { AgentTerminal } from './AgentTerminal.js';
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
} from '../lib/sessions.js';

export function GlobalTerminalPanel() {
  const tabs = openTabs.value;
  if (tabs.length === 0) return null;

  const activeId = activeTabId.value;
  const minimized = panelMinimized.value;
  const height = panelHeight.value;
  const exited = exitedSessions.value;

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
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      class="global-terminal-panel"
      style={{ height: minimized ? '36px' : `${height}px`, left: `${sidebarWidth.value}px` }}
    >
      <div class="terminal-resize-handle" onMouseDown={onResizeMouseDown} />
      <div class="terminal-tab-bar">
        <div class="terminal-tabs">
          {tabs.map((sid) => {
            const isExited = exited.has(sid);
            const isActive = sid === activeId;
            return (
              <button
                key={sid}
                class={`terminal-tab ${isActive ? 'active' : ''}`}
                onClick={() => openSession(sid)}
              >
                <span class={`status-dot ${isExited ? 'exited' : ''}`} />
                <span>{sid.slice(-8)}</span>
                <span class="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(sid); }}>&times;</span>
              </button>
            );
          })}
        </div>
        <div class="terminal-tab-actions">
          <button onClick={() => (panelMinimized.value = !panelMinimized.value)}>
            {minimized ? '▲' : '▼'}
          </button>
        </div>
      </div>
      {!minimized && (
        <>
          {activeId && (
            <div class="terminal-active-header">
              {exited.has(activeId) ? (
                <button class="resume-btn" onClick={() => resumeSession(activeId)}>Resume</button>
              ) : (
                <button class="kill-btn" onClick={() => killSession(activeId)}>Kill</button>
              )}
            </div>
          )}
          <div class="terminal-body">
            {tabs.map((sid) => (
              <div key={sid} style={{ display: sid === activeId ? 'block' : 'none', width: '100%', height: '100%' }}>
                <AgentTerminal
                  sessionId={sid}
                  onExit={() => markSessionExited(sid)}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
