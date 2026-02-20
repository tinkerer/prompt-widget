import { useRef, useCallback } from 'preact/hooks';
import { signal } from '@preact/signals';
import { SessionViewToggle, type ViewMode } from './SessionViewToggle.js';
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
import { api } from '../lib/api.js';

const viewModes = signal<Record<string, ViewMode>>({});

function getViewMode(sessionId: string): ViewMode {
  return viewModes.value[sessionId] || 'terminal';
}

function setViewMode(sessionId: string, mode: ViewMode) {
  viewModes.value = { ...viewModes.value, [sessionId]: mode };
}

async function resolveSession(sessionId: string, feedbackId?: string) {
  await killSession(sessionId);
  if (feedbackId) {
    try {
      await api.updateFeedback(feedbackId, { status: 'resolved' });
    } catch (err: any) {
      console.error('Resolve feedback failed:', err.message);
    }
  }
}

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
  const activeSess = activeId ? sessionMap.get(activeId) : null;
  const appId = selectedAppId.value;
  const feedbackPath = activeSess?.feedbackId
    ? appId ? `/app/${appId}/feedback/${activeSess.feedbackId}` : `/feedback/${activeSess.feedbackId}`
    : null;
  const activeViewMode = activeId ? getViewMode(activeId) : 'terminal';
  const isActiveExited = activeId ? exited.has(activeId) : false;

  const collapseBtn = (
    <button class="terminal-collapse-btn" onClick={toggleMinimized}>
      {minimized ? '\u25B2' : '\u25BC'}
    </button>
  );

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
          <div class="terminal-tab-actions">
            {collapseBtn}
          </div>
        </div>
      )}
      <div class="terminal-active-header">
        {activeId && (
          <>
            <span style="color:var(--pw-terminal-text-dim);font-size:12px;font-family:monospace;margin-right:8px">{activeId.slice(-8)}</span>
            {feedbackPath && (
              <a
                href={`#${feedbackPath}`}
                onClick={(e) => { e.preventDefault(); navigate(feedbackPath); }}
                style="color:var(--pw-primary-text);font-size:12px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title={activeSess?.feedbackTitle || 'View feedback'}
              >
                {activeSess?.feedbackTitle ? (activeSess.feedbackTitle.length > 50 ? activeSess.feedbackTitle.slice(0, 50) + '\u2026' : activeSess.feedbackTitle) : 'View feedback'}
              </a>
            )}
          </>
        )}
        <span style="flex:1" />
        {activeId && (
          <>
            <select
              class="view-mode-select"
              value={activeViewMode}
              onChange={(e) => setViewMode(activeId, (e.target as HTMLSelectElement).value as ViewMode)}
            >
              <option value="terminal">Term</option>
              <option value="structured">Struct</option>
              <option value="split">Split</option>
            </select>
            {!isActiveExited && activeSess?.feedbackId && (
              <button class="resolve-btn" onClick={() => resolveSession(activeId, activeSess.feedbackId)}>Resolve</button>
            )}
            {isActiveExited ? (
              <button class="resume-btn" onClick={() => resumeSession(activeId)}>Resume</button>
            ) : (
              <button class="kill-btn" onClick={() => killSession(activeId)}>Kill</button>
            )}
          </>
        )}
        {!hasTabs && collapseBtn}
      </div>
      {!minimized && (
        <div class="terminal-body">
          {tabs.map((sid) => (
            <div key={sid} style={{ display: sid === activeId ? 'flex' : 'none', width: '100%', height: '100%' }}>
              <SessionViewToggle
                sessionId={sid}
                isActive={sid === activeId}
                onExit={() => markSessionExited(sid)}
                permissionProfile={sessionMap.get(sid)?.permissionProfile}
                mode={getViewMode(sid)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
