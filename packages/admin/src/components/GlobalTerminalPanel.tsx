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
  sidebarAnimating,
  focusedPanelId,
  hotkeyMenuOpen,
  waitingSessions,
  setSessionWaiting,
  splitEnabled,
  rightPaneTabs,
  rightPaneActiveId,
  splitRatio,
  leftPaneTabs,
  enableSplit,
  disableSplit,
  setSplitRatio,
} from '../lib/sessions.js';
import { startTabDrag, type TabDragSource } from '../lib/tab-drag.js';
import { navigate, selectedAppId } from '../lib/state.js';
import { showTabs } from '../lib/settings.js';
import { ctrlShiftHeld } from '../lib/shortcuts.js';
import { api } from '../lib/api.js';
import { copyWithTooltip } from '../lib/clipboard.js';

const statusMenuOpen = signal<{ sessionId: string; x: number; y: number } | null>(null);
const panelResizing = signal(false);

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
    if (!digits.startsWith(pendingStr)) {
      return <span class="tab-number-badge tab-badge-dimmed">{tabNum}</span>;
    }
    return (
      <span class="tab-number-badge tab-badge-pending">
        <span class="tab-badge-green">{pendingStr}</span>
        {digits.slice(pendingStr.length) || ''}
      </span>
    );
  }
  return <span class="tab-number-badge">{tabNum}</span>;
}

function PaneTabBar({
  tabs,
  activeId,
  source,
  exited,
  sessionMap,
  tabsRef,
  onActivate,
}: {
  tabs: string[];
  activeId: string | null;
  source: TabDragSource;
  exited: Set<string>;
  sessionMap: Map<string, any>;
  tabsRef?: preact.RefObject<HTMLDivElement>;
  onActivate: (sid: string) => void;
}) {
  const globalSessions = allNumberedSessions();
  return (
    <div ref={tabsRef} class="terminal-tabs" onWheel={(e) => { const delta = e.deltaX || e.deltaY; if (delta) { e.preventDefault(); (e.currentTarget as HTMLElement).scrollLeft += delta; } }}>
      {tabs.map((sid) => {
        const isExited = exited.has(sid);
        const isWaiting = !isExited && waitingSessions.value.has(sid);
        const isActive = sid === activeId;
        const sess = sessionMap.get(sid);
        const isPlain = sess?.permissionProfile === 'plain';
        const raw = isPlain ? `Terminal ${sid.slice(-6)}` : (sess?.feedbackTitle || sess?.agentName || `Session ${sid.slice(-6)}`);
        const tabLabel = raw.length > 24 ? raw.slice(0, 24) + '\u2026' : raw;
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
                source,
                label: tabLabel,
                onClickFallback: () => onActivate(sid),
              });
            }}
            title={sess?.feedbackTitle || sess?.agentName || sid}
          >
            <span
              class={`status-dot ${isExited ? 'exited' : ''}${isWaiting ? ' waiting' : ''}`}
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
  );
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
  const isSplit = splitEnabled.value;
  const leftTabs = isSplit ? leftPaneTabs() : tabs;
  const rightTabs = isSplit ? rightPaneTabs.value : [];
  const rightActive = rightPaneActiveId.value;

  const dragging = useRef(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const splitDragging = useRef(false);

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

  useEffect(() => {
    const held = ctrlShiftHeld.value;
    if (!held || !activeId) {
      hotkeyMenuOpen.value = null;
      return;
    }

    function updatePos() {
      const dot = tabsRef.current?.querySelector('.terminal-tab.active .status-dot') as HTMLElement | null;
      const scrollBox = tabsRef.current;
      if (!dot || !scrollBox) { hotkeyMenuOpen.value = null; return; }
      const dotRect = dot.getBoundingClientRect();
      const scrollRect = scrollBox.getBoundingClientRect();
      if (dotRect.right < scrollRect.left || dotRect.left > scrollRect.right) {
        hotkeyMenuOpen.value = null;
        return;
      }
      const x = Math.max(scrollRect.left, Math.min(dotRect.left, scrollRect.right - 120));
      const y = dotRect.bottom + 4;
      hotkeyMenuOpen.value = { sessionId: activeId!, x, y };
    }

    updatePos();
    const scrollEl = tabsRef.current;
    scrollEl?.addEventListener('scroll', updatePos, { passive: true });
    return () => scrollEl?.removeEventListener('scroll', updatePos);
  }, [ctrlShiftHeld.value, activeId]);

  const onResizeMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    panelResizing.value = true;
    if (panelMinimized.value) {
      panelMinimized.value = false;
    }
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newH = window.innerHeight - ev.clientY;
      panelHeight.value = Math.max(150, Math.min(newH, window.innerHeight - 100));
    };
    const onUp = () => {
      dragging.current = false;
      panelResizing.value = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persistPanelState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const onSplitDividerMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    splitDragging.current = true;
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    container.classList.add('dragging');
    const containerRect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      if (!splitDragging.current) return;
      const ratio = (ev.clientX - containerRect.left) / containerRect.width;
      setSplitRatio(ratio);
    };
    const onUp = () => {
      splitDragging.current = false;
      container.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
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

  const isFocused = focusedPanelId.value === 'global' || focusedPanelId.value === 'split-left' || focusedPanelId.value === 'split-right';
  const canSplit = tabs.length >= 2 && !isSplit;

  return (
    <div
      class={`global-terminal-panel${sidebarAnimating.value ? ' animating' : ''}${panelResizing.value ? ' dragging' : ''}${isFocused ? ' panel-focused' : ''}`}
      style={{ height: minimized ? (hasTabs ? '66px' : '32px') : `${height}px`, left: `${sidebarWidth.value}px` }}
    >
      <div class="terminal-resize-handle" onMouseDown={onResizeMouseDown} />
      {hasTabs && !isSplit && (
        <div class="terminal-tab-bar">
          <PaneTabBar
            tabs={tabs}
            activeId={activeId}
            source="main"
            exited={exited}
            sessionMap={sessionMap}
            tabsRef={tabsRef}
            onActivate={openSession}
          />
          <div class="terminal-tab-actions">
            {canSplit && (
              <button class="terminal-split-btn" onClick={() => enableSplit()} title="Split into two panes">
                {'\u2AFF'} Split
              </button>
            )}
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
              <button onClick={() => { statusMenuOpen.value = null; killSession(menuSid); }}>
                Kill <kbd>⌃⇧K</kbd>
              </button>
            )}
            {!menuExited && menuSess?.feedbackId && (
              <button onClick={() => { statusMenuOpen.value = null; resolveSession(menuSid, menuSess.feedbackId); }}>
                Resolve <kbd>⌃⇧R</kbd>
              </button>
            )}
            {!menuExited && (
              <button onClick={() => { statusMenuOpen.value = null; api.openSessionInTerminal(menuSid); }}>
                Open in Terminal
              </button>
            )}
            {menuExited && (
              <button onClick={() => { statusMenuOpen.value = null; resumeSession(menuSid); }}>Resume</button>
            )}
            <button onClick={() => { statusMenuOpen.value = null; closeTab(menuSid); }}>
              Close tab <kbd>⌃⇧W</kbd>
            </button>
          </div>
        );
      })()}
      {hotkeyMenuOpen.value && !statusMenuOpen.value && (() => {
        const hk = hotkeyMenuOpen.value!;
        const hkSess = sessionMap.get(hk.sessionId);
        const hkExited = exited.has(hk.sessionId);
        return (
          <div
            class="status-dot-menu"
            style={{ left: `${hk.x}px`, top: `${hk.y}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            {!hkExited && (
              <button onClick={() => killSession(hk.sessionId)}>
                Kill <kbd>K</kbd>
              </button>
            )}
            {!hkExited && hkSess?.feedbackId && (
              <button onClick={() => resolveSession(hk.sessionId, hkSess.feedbackId)}>
                Resolve <kbd>R</kbd>
              </button>
            )}
            {!hkExited && (
              <button onClick={() => api.openSessionInTerminal(hk.sessionId)}>
                Open in Terminal <kbd>T</kbd>
              </button>
            )}
            {hkExited && (
              <button onClick={() => resumeSession(hk.sessionId)}>Resume</button>
            )}
            <button onClick={() => closeTab(hk.sessionId)}>
              Close tab <kbd>W</kbd>
            </button>
          </div>
        );
      })()}
      {!isSplit && (
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
                  {activeSess?.feedbackTitle || 'View feedback'}
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
              {!isActiveExited && (
                <button
                  class="popout-btn"
                  onClick={() => api.openSessionInTerminal(activeId)}
                  title="Open tmux session in Terminal.app"
                >
                  {'\u2328'} Terminal
                </button>
              )}
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
      )}
      {!minimized && !isSplit && (
        <div class="terminal-body">
          {tabs.map((sid) => (
            <div key={sid} style={{ display: sid === activeId ? 'flex' : 'none', width: '100%', flex: 1, minHeight: 0 }}>
              <SessionViewToggle
                sessionId={sid}
                isActive={sid === activeId}
                onExit={() => markSessionExited(sid)}
                onWaitingChange={(w) => setSessionWaiting(sid, w)}
                permissionProfile={sessionMap.get(sid)?.permissionProfile}
                mode={getViewMode(sid)}
              />
            </div>
          ))}
        </div>
      )}
      {!minimized && isSplit && (
        <div class="terminal-split-container">
          <div
            class="terminal-split-pane"
            data-split-pane="split-left"
            style={{ flex: splitRatio.value }}
          >
            <div class="split-pane-tab-bar">
              <PaneTabBar
                tabs={leftTabs}
                activeId={activeId}
                source="split-left"
                exited={exited}
                sessionMap={sessionMap}
                tabsRef={tabsRef}
                onActivate={openSession}
              />
              <div class="terminal-tab-actions">
                <button class="terminal-new-btn" onClick={() => spawnTerminal(appId)} title="New terminal">+</button>
                {collapseBtn}
              </div>
            </div>
            <div class="terminal-body">
              {leftTabs.map((sid) => (
                <div key={sid} style={{ display: sid === activeId ? 'flex' : 'none', width: '100%', flex: 1, minHeight: 0 }}>
                  <SessionViewToggle
                    sessionId={sid}
                    isActive={sid === activeId}
                    onExit={() => markSessionExited(sid)}
                    onWaitingChange={(w) => setSessionWaiting(sid, w)}
                    permissionProfile={sessionMap.get(sid)?.permissionProfile}
                    mode={getViewMode(sid)}
                  />
                </div>
              ))}
            </div>
          </div>
          <div class="terminal-split-divider" onMouseDown={onSplitDividerMouseDown} />
          <div
            class="terminal-split-pane"
            data-split-pane="split-right"
            style={{ flex: 1 - splitRatio.value }}
          >
            <div class="split-pane-tab-bar">
              <PaneTabBar
                tabs={rightTabs}
                activeId={rightActive}
                source="split-right"
                exited={exited}
                sessionMap={sessionMap}
                onActivate={(sid) => { rightPaneActiveId.value = sid; }}
              />
              <div class="terminal-tab-actions">
                <button
                  class="split-pane-unsplit-btn"
                  onClick={() => disableSplit()}
                  title="Close split pane"
                >
                  &times;
                </button>
              </div>
            </div>
            <div class="terminal-body">
              {rightTabs.map((sid) => (
                <div key={sid} style={{ display: sid === rightActive ? 'flex' : 'none', width: '100%', flex: 1, minHeight: 0 }}>
                  <SessionViewToggle
                    sessionId={sid}
                    isActive={sid === rightActive}
                    onExit={() => markSessionExited(sid)}
                    onWaitingChange={(w) => setSessionWaiting(sid, w)}
                    permissionProfile={sessionMap.get(sid)?.permissionProfile}
                    mode={getViewMode(sid)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
