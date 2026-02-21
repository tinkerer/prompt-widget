import { useRef, useCallback, useEffect } from 'preact/hooks';
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
  spawnTerminal,
  popOutTab,
  getViewMode,
  setViewMode,
  pendingFirstDigit,
  allNumberedSessions,
  sidebarDragging,
} from '../lib/sessions.js';
import { startTabDrag } from '../lib/tab-drag.js';
import { navigate, selectedAppId } from '../lib/state.js';
import { showTabs } from '../lib/settings.js';
import { ctrlShiftHeld } from '../lib/shortcuts.js';
import { api } from '../lib/api.js';
import { copyWithTooltip } from '../lib/clipboard.js';

const statusMenuOpen = signal<{ sessionId: string; x: number; y: number } | null>(null);

async function resolveSession(sessionId: string, feedbackId?: string) {
  await killSession(sessionId);
  if (feedbackId) {
    try {
      await api.updateFeedback(feedbackId, { status: 'resolved' });
    } catch (err: any) {
      console.error('Resolve feedback failed:', err.message);
    }
  }
  closeTab(sessionId);
}

function TabBadge({ tabNum }: { tabNum: number }) {
  const pending = pendingFirstDigit.value;
  const digits = String(tabNum);
  if (pending !== null) {
    const pendingStr = String(pending);
    // Grey out tabs that can't be reached with the pending prefix
    if (!digits.startsWith(pendingStr)) {
      return <span class="tab-number-badge tab-badge-dimmed">{tabNum}</span>;
    }
    // Show first digit(s) in green, rest normal
    return (
      <span class="tab-number-badge tab-badge-pending">
        <span class="tab-badge-green">{pendingStr}</span>
        {digits.slice(pendingStr.length) || ''}
      </span>
    );
  }
  return <span class="tab-number-badge">{tabNum}</span>;
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
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId) return;
    requestAnimationFrame(() => {
      const container = tabsRef.current;
      if (!container) return;
      const el = container.querySelector('.terminal-tab.active') as HTMLElement | null;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
  }, [activeId, tabs.length]);

  useEffect(() => {
    if (!statusMenuOpen.value) return;
    const close = () => { statusMenuOpen.value = null; };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [statusMenuOpen.value]);

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
  const activeViewMode = activeId ? getViewMode(activeId, activeSess?.permissionProfile) : 'terminal';
  const isActiveExited = activeId ? exited.has(activeId) : false;

  const collapseBtn = (
    <button class="terminal-collapse-btn" onClick={toggleMinimized}>
      {minimized ? '\u25B2' : '\u25BC'}
    </button>
  );

  return (
    <div
      class={`global-terminal-panel${sidebarDragging.value ? ' no-transition' : ''}`}
      style={{ height: minimized ? (hasTabs ? '66px' : '32px') : `${height}px`, left: `${sidebarWidth.value}px` }}
    >
      <div class="terminal-resize-handle" onMouseDown={onResizeMouseDown} />
      {hasTabs && (
        <div class="terminal-tab-bar">
          <div ref={tabsRef} class="terminal-tabs" onWheel={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).scrollLeft += e.deltaY; }}>
            {tabs.map((sid) => {
              const isExited = exited.has(sid);
              const isActive = sid === activeId;
              const sess = sessionMap.get(sid);
              const isPlain = sess?.permissionProfile === 'plain';
              const raw = isPlain ? `Terminal ${sid.slice(-6)}` : (sess?.feedbackTitle || sess?.agentName || `Session ${sid.slice(-6)}`);
              const tabLabel = raw.length > 24 ? raw.slice(0, 24) + '\u2026' : raw;
              const globalSessions = allNumberedSessions();
              const globalIdx = globalSessions.indexOf(sid);
              const tabNum = globalIdx >= 0 ? globalIdx + 1 : null;
              return (
                <button
                  key={sid}
                  class={`terminal-tab ${isActive ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    startTabDrag(e, {
                      sessionId: sid,
                      source: 'main',
                      label: tabLabel,
                      onClickFallback: () => openSession(sid),
                    });
                  }}
                  title={sess?.feedbackTitle || sess?.agentName || sid}
                >
                  <span
                    class={`status-dot ${isExited ? 'exited' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      statusMenuOpen.value = { sessionId: sid, x: rect.left, y: rect.bottom + 4 };
                    }}
                  >
                    {ctrlShiftHeld.value && tabNum !== null && (
                      <TabBadge tabNum={tabNum} />
                    )}
                  </span>
                  <span>{tabLabel}</span>
                  <span class="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(sid); }}>&times;</span>
                </button>
              );
            })}
          </div>
          <div class="terminal-tab-actions">
            <button class="terminal-new-btn" onClick={() => spawnTerminal(appId)} title="New terminal">+</button>
            {collapseBtn}
          </div>
        </div>
      )}
      {statusMenuOpen.value && (() => {
        const menuSid = statusMenuOpen.value!.sessionId;
        const menuSess = sessionMap.get(menuSid);
        const menuExited = exited.has(menuSid);
        return (
          <div
            class="status-dot-menu"
            style={{ left: `${statusMenuOpen.value!.x}px`, top: `${statusMenuOpen.value!.y}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            {!menuExited && (
              <button onClick={() => { statusMenuOpen.value = null; killSession(menuSid); }}>Kill</button>
            )}
            {!menuExited && menuSess?.feedbackId && (
              <button onClick={() => { statusMenuOpen.value = null; resolveSession(menuSid, menuSess.feedbackId); }}>Resolve</button>
            )}
            {menuExited && (
              <button onClick={() => { statusMenuOpen.value = null; resumeSession(menuSid); }}>Resume</button>
            )}
            <button onClick={() => { statusMenuOpen.value = null; closeTab(menuSid); }}>Close tab</button>
          </div>
        );
      })()}
      <div class="terminal-active-header">
        {activeId && (
          <>
            <span
              class="tmux-id-label"
              title="Copy tmux attach command to clipboard"
              onClick={(e) => { copyWithTooltip(`TMUX= tmux -L prompt-widget attach-session -t pw-${activeId}`, e as any); }}
            >
              pw-{activeId.slice(-6)}
            </span>
            {feedbackPath && (
              <a
                href={`#${feedbackPath}`}
                onClick={(e) => { e.preventDefault(); navigate(feedbackPath); }}
                class="feedback-title-link"
                title={activeSess?.feedbackTitle || 'View feedback'}
              >
                {activeSess?.feedbackTitle ? (activeSess.feedbackTitle.length > 60 ? activeSess.feedbackTitle.slice(0, 60) + '\u2026' : activeSess.feedbackTitle) : 'View feedback'}
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
            <button
              class="popout-btn"
              onClick={() => popOutTab(activeId)}
              title="Pop out to floating panel (Ctrl+Shift+-)"
            >
              {'\u2197'} Pop out
            </button>
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
            <div key={sid} style={{ display: sid === activeId ? 'flex' : 'none', width: '100%', flex: 1, minHeight: 0 }}>
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
