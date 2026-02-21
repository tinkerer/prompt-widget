import { useRef, useCallback } from 'preact/hooks';
import { SessionViewToggle, type ViewMode } from './SessionViewToggle.js';
import {
  type PopoutPanelState,
  popoutPanels,
  allSessions,
  exitedSessions,
  popBackIn,
  updatePanel,
  persistPopoutState,
  killSession,
  resumeSession,
  markSessionExited,
  getViewMode,
  setViewMode,
  closeTab,
  getDockedPanelTop,
  allNumberedSessions,
  pendingFirstDigit,
} from '../lib/sessions.js';
import { startTabDrag } from '../lib/tab-drag.js';
import { ctrlShiftHeld } from '../lib/shortcuts.js';
import { navigate, selectedAppId } from '../lib/state.js';
import { api } from '../lib/api.js';

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

const SNAP_THRESHOLD = 20;
const UNDOCK_THRESHOLD = 40;
const MIN_W = 300;
const MIN_H = 200;

function PanelTabBadge({ tabNum }: { tabNum: number }) {
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

function PanelView({ panel }: { panel: PopoutPanelState }) {
  const ids = panel.sessionIds;
  const activeId = panel.activeSessionId || ids[0];
  const sessions = allSessions.value;
  const sessionMap = new Map(sessions.map((s: any) => [s.id, s]));
  const session = sessionMap.get(activeId);
  const isExited = activeId ? exitedSessions.value.has(activeId) : false;
  const viewMode = activeId ? getViewMode(activeId, session?.permissionProfile) : 'terminal';
  const docked = panel.docked;
  const dragging = useRef(false);
  const resizing = useRef<string | null>(null);
  const startPos = useRef({ mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0, dockedHeight: 0 });

  const panelTop = docked ? getDockedPanelTop(panel.id) : undefined;
  const panelStyle = docked
    ? { position: 'fixed' as const, right: 0, top: panelTop, width: panel.dockedWidth, height: panel.dockedHeight }
    : { position: 'fixed' as const, left: panel.floatingRect.x, top: panel.floatingRect.y, width: panel.floatingRect.w, height: panel.floatingRect.h };

  const onHeaderDragStart = useCallback((e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, select, a, .popout-tab-bar')) return;
    e.preventDefault();
    dragging.current = true;
    const fr = panel.floatingRect;
    startPos.current = { mx: e.clientX, my: e.clientY, x: fr.x, y: fr.y, w: fr.w, h: fr.h, dockedHeight: panel.dockedHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - startPos.current.mx;
      const dy = ev.clientY - startPos.current.my;
      const currentPanel = popoutPanels.value.find((p) => p.id === panel.id);
      if (!currentPanel) return;
      if (currentPanel.docked) {
        if (dx < -UNDOCK_THRESHOLD) {
          const w = currentPanel.dockedWidth;
          const h = currentPanel.dockedHeight;
          updatePanel(panel.id, {
            docked: false,
            floatingRect: { x: ev.clientX - w / 2, y: ev.clientY - 16, w, h },
          });
          startPos.current = { ...startPos.current, mx: ev.clientX, my: ev.clientY, x: ev.clientX - w / 2, y: ev.clientY - 16, w, h, dockedHeight: h };
        }
      } else {
        const newX = Math.max(0, Math.min(startPos.current.x + dx, window.innerWidth - 100));
        const newY = Math.max(0, Math.min(startPos.current.y + dy, window.innerHeight - 50));
        updatePanel(panel.id, {
          floatingRect: { ...currentPanel.floatingRect, x: newX, y: newY },
        });
        if (ev.clientX > window.innerWidth - SNAP_THRESHOLD) {
          updatePanel(panel.id, {
            docked: true,
            dockedHeight: currentPanel.floatingRect.h,
            dockedWidth: currentPanel.floatingRect.w,
          });
        }
      }
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persistPopoutState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panel.id]);

  const onResizeStart = useCallback((edge: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = edge;
    const currentPanel = popoutPanels.value.find((p) => p.id === panel.id);
    if (!currentPanel) return;
    const fr = currentPanel.floatingRect;
    startPos.current = { mx: e.clientX, my: e.clientY, x: fr.x, y: fr.y, w: fr.w, h: fr.h, dockedHeight: currentPanel.dockedHeight };
    const startDockedW = currentPanel.dockedWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const dx = ev.clientX - startPos.current.mx;
      const dy = ev.clientY - startPos.current.my;
      const dir = resizing.current;
      const cp = popoutPanels.value.find((p) => p.id === panel.id);
      if (!cp) return;
      if (cp.docked) {
        let h = startPos.current.dockedHeight;
        if (dir.includes('n') || dir === 'top') h = Math.max(MIN_H, h - dy);
        if (dir.includes('s') || dir === 'bottom') h = Math.max(MIN_H, h + dy);
        let w = startDockedW;
        if (dir.includes('w') || dir === 'left') {
          w = Math.max(MIN_W, startDockedW - dx);
        }
        updatePanel(panel.id, { dockedHeight: h, dockedWidth: w });
      } else {
        const s = startPos.current;
        let { x, y, w, h } = { x: s.x, y: s.y, w: s.w, h: s.h };
        if (dir.includes('e')) w = Math.max(MIN_W, s.w + dx);
        if (dir.includes('w')) { w = Math.max(MIN_W, s.w - dx); x = s.x + s.w - w; }
        if (dir.includes('s')) h = Math.max(MIN_H, s.h + dy);
        if (dir.includes('n')) { h = Math.max(MIN_H, s.h - dy); y = s.y + s.h - h; }
        updatePanel(panel.id, { floatingRect: { x, y, w, h } });
      }
    };
    const onUp = () => {
      resizing.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persistPopoutState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panel.id]);

  const showBadges = ctrlShiftHeld.value;
  const hasTabs = ids.length > 1;
  const globalSessions = allNumberedSessions();

  function tabLabel(sid: string) {
    const s = sessionMap.get(sid);
    const isPlain = s?.permissionProfile === 'plain';
    const raw = isPlain ? `Term ${sid.slice(-6)}` : (s?.feedbackTitle || s?.agentName || `Sess ${sid.slice(-6)}`);
    return raw.length > 20 ? raw.slice(0, 20) + '\u2026' : raw;
  }

  function globalNum(sid: string): number | null {
    const idx = globalSessions.indexOf(sid);
    return idx >= 0 ? idx + 1 : null;
  }

  const activeGlobalNum = activeId ? globalNum(activeId) : null;

  return (
    <>
      {showBadges && !docked && activeGlobalNum !== null && (
        <div
          class="popout-floating-badge"
          style={{ left: panel.floatingRect.x - 10, top: panel.floatingRect.y - 10 }}
        >
          <PanelTabBadge tabNum={activeGlobalNum} />
        </div>
      )}
      <div
        class={docked ? 'popout-docked' : 'popout-floating'}
        style={panelStyle}
        data-panel-id={panel.id}
      >
      <div class="popout-header" onMouseDown={onHeaderDragStart}>
        {hasTabs && (
          <div class="popout-tab-bar">
            {ids.map((sid) => {
              const gn = globalNum(sid);
              return (
                <button
                  key={sid}
                  class={`popout-tab ${sid === activeId ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    startTabDrag(e, {
                      sessionId: sid,
                      source: { panelId: panel.id },
                      label: tabLabel(sid),
                      onClickFallback: () => {
                        updatePanel(panel.id, { activeSessionId: sid });
                        persistPopoutState();
                      },
                    });
                  }}
                  title={sessionMap.get(sid)?.feedbackTitle || sid}
                >
                  {showBadges && !docked && gn !== null && <PanelTabBadge tabNum={gn} />}
                  <span>{tabLabel(sid)}</span>
                  <span class="popout-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(sid); }}>&times;</span>
                </button>
              );
            })}
          </div>
        )}
        {!hasTabs && activeId && (
          <>
            <span style="color:var(--pw-terminal-text-dim);font-size:12px;font-family:monospace;margin-right:8px">{activeId.slice(-8)}</span>
            {session?.feedbackId && (() => {
              const appId = selectedAppId.value;
              const feedbackPath = appId ? `/app/${appId}/feedback/${session.feedbackId}` : `/feedback/${session.feedbackId}`;
              return (
                <a
                  href={`#${feedbackPath}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(feedbackPath); }}
                  style="color:var(--pw-primary-text);font-size:12px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                  title={session?.feedbackTitle || 'View feedback'}
                >
                  {session?.feedbackTitle ? (session.feedbackTitle.length > 50 ? session.feedbackTitle.slice(0, 50) + '\u2026' : session.feedbackTitle) : 'View feedback'}
                </a>
              );
            })()}
          </>
        )}
        <span style="flex:1" />
        <div class="popout-header-actions">
          {activeId && (
            <select
              class="view-mode-select"
              value={viewMode}
              onChange={(e) => setViewMode(activeId, (e.target as HTMLSelectElement).value as ViewMode)}
            >
              <option value="terminal">Term</option>
              <option value="structured">Struct</option>
              <option value="split">Split</option>
            </select>
          )}
          <button
            onClick={() => {
              updatePanel(panel.id, { docked: !docked });
              persistPopoutState();
              window.dispatchEvent(new Event('resize'));
            }}
            title={docked ? 'Undock to floating' : 'Dock to right edge'}
          >
            {docked ? '\u25A1 Float' : '\u25E8 Dock'}
          </button>
          {activeId && !isExited && session?.feedbackId && (
            <button class="btn-resolve" onClick={() => resolveSession(activeId, session.feedbackId)} title="Resolve">Resolve</button>
          )}
          {activeId && (isExited ? (
            <button onClick={() => resumeSession(activeId)} title="Resume">Resume</button>
          ) : (
            <button class="btn-kill" onClick={() => killSession(activeId)} title="Kill">Kill</button>
          ))}
          <button onClick={() => popBackIn(activeId)} title="Pop back into tab bar">{'\u2199'} Pop in</button>
        </div>
      </div>
      <div class="popout-body">
        {activeId && (
          <SessionViewToggle
            key={activeId}
            sessionId={activeId}
            isActive={true}
            onExit={() => markSessionExited(activeId)}
            permissionProfile={session?.permissionProfile}
            mode={viewMode}
          />
        )}
      </div>
      {docked ? (
        <>
          <div class="popout-resize-n" onMouseDown={(e) => onResizeStart('n', e)} />
          <div class="popout-resize-s" onMouseDown={(e) => onResizeStart('s', e)} />
          <div class="popout-resize-w" onMouseDown={(e) => onResizeStart('w', e)} />
        </>
      ) : (
        <>
          <div class="popout-resize-n" onMouseDown={(e) => onResizeStart('n', e)} />
          <div class="popout-resize-s" onMouseDown={(e) => onResizeStart('s', e)} />
          <div class="popout-resize-e" onMouseDown={(e) => onResizeStart('e', e)} />
          <div class="popout-resize-w" onMouseDown={(e) => onResizeStart('w', e)} />
          <div class="popout-resize-ne" onMouseDown={(e) => onResizeStart('ne', e)} />
          <div class="popout-resize-nw" onMouseDown={(e) => onResizeStart('nw', e)} />
          <div class="popout-resize-se" onMouseDown={(e) => onResizeStart('se', e)} />
          <div class="popout-resize-sw" onMouseDown={(e) => onResizeStart('sw', e)} />
        </>
      )}
    </div>
    </>
  );
}

function DockedPanelGrabHandle({ panel }: { panel: PopoutPanelState }) {
  const grabStart = useRef({ mx: 0, time: 0 });
  const grabMoved = useRef(false);

  const onGrabMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    grabStart.current = { mx: e.clientX, time: Date.now() };
    grabMoved.current = false;
    const startW = panel.dockedWidth;
    const startMx = e.clientX;
    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - grabStart.current.mx) > 3) {
        grabMoved.current = true;
        updatePanel(panel.id, { dockedWidth: Math.max(MIN_W, startW - (ev.clientX - startMx)) });
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!grabMoved.current && Date.now() - grabStart.current.time < 200) {
        updatePanel(panel.id, { visible: !panel.visible });
      }
      persistPopoutState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panel.id, panel.visible, panel.dockedWidth]);

  const panelTop = getDockedPanelTop(panel.id);
  const showBadge = ctrlShiftHeld.value;
  const globalSessions = allNumberedSessions();
  const activeId = panel.activeSessionId || panel.sessionIds[0];
  const globalIdx = globalSessions.indexOf(activeId);
  const handleH = 48;
  const rightPos = panel.visible ? panel.dockedWidth : 0;

  return (
    <div
      class="popout-grab-tab"
      style={{
        right: rightPos,
        top: panelTop,
        height: handleH,
      }}
      onMouseDown={onGrabMouseDown}
      title="Drag to resize, click to toggle"
    >
      {showBadge && globalIdx >= 0
        ? <PanelTabBadge tabNum={globalIdx + 1} />
        : <span class="grab-indicator">{'\u2503'}</span>
      }
    </div>
  );
}

export function PopoutPanel() {
  const panels = popoutPanels.value;
  if (panels.length === 0) return null;

  return (
    <>
      {panels.map((p) => {
        if (p.docked) {
          return (
            <span key={`g-${p.id}`}>
              <DockedPanelGrabHandle panel={p} />
              {p.visible && <PanelView key={p.id} panel={p} />}
            </span>
          );
        }
        if (!p.visible) return null;
        return <PanelView key={p.id} panel={p} />;
      })}
    </>
  );
}
