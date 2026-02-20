import { useRef, useCallback } from 'preact/hooks';
import { SessionViewToggle, type ViewMode } from './SessionViewToggle.js';
import {
  poppedOutTabIds,
  activePopoutTabId,
  popoutVisible,
  popoutFloatingRect,
  popoutDocked,
  popoutDockedRect,
  allSessions,
  exitedSessions,
  popBackIn,
  setPopoutDocked,
  persistPopoutState,
  killSession,
  resumeSession,
  markSessionExited,
  getViewMode,
  setViewMode,
  closeTab,
} from '../lib/sessions.js';
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

function UnifiedPanel() {
  const ids = poppedOutTabIds.value;
  const activeId = activePopoutTabId.value || ids[0];
  const sessions = allSessions.value;
  const sessionMap = new Map(sessions.map((s: any) => [s.id, s]));
  const session = sessionMap.get(activeId);
  const isExited = activeId ? exitedSessions.value.has(activeId) : false;
  const viewMode = activeId ? getViewMode(activeId, session?.permissionProfile) : 'terminal';
  const docked = popoutDocked.value;
  const dockedRect = popoutDockedRect.value;
  const floatRect = popoutFloatingRect.value;
  const dragging = useRef(false);
  const resizing = useRef<string | null>(null);
  const startPos = useRef({ mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0, top: 0, width: 0, height: 0 });
  const grabStart = useRef({ mx: 0, my: 0, time: 0 });
  const grabMoved = useRef(false);

  const panelStyle = docked
    ? { position: 'fixed' as const, right: 0, top: dockedRect.top, width: dockedRect.width, height: dockedRect.height }
    : { position: 'fixed' as const, left: floatRect.x, top: floatRect.y, width: floatRect.w, height: floatRect.h };

  const onHeaderDragStart = useCallback((e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, select, a, .popout-tab-bar')) return;
    e.preventDefault();
    dragging.current = true;
    const dr = popoutDockedRect.value;
    const fr = popoutFloatingRect.value;
    startPos.current = { mx: e.clientX, my: e.clientY, x: fr.x, y: fr.y, w: fr.w, h: fr.h, top: dr.top, width: dr.width, height: dr.height };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - startPos.current.mx;
      const dy = ev.clientY - startPos.current.my;
      if (popoutDocked.value) {
        if (dx < -UNDOCK_THRESHOLD) {
          const dr = popoutDockedRect.value;
          popoutFloatingRect.value = { x: ev.clientX - dr.width / 2, y: ev.clientY - 16, w: dr.width, h: dr.height };
          popoutDocked.value = false;
          startPos.current = { ...startPos.current, mx: ev.clientX, my: ev.clientY, x: ev.clientX - dr.width / 2, y: ev.clientY - 16, w: dr.width, h: dr.height };
        } else {
          popoutDockedRect.value = { ...popoutDockedRect.value, top: Math.max(0, Math.min(startPos.current.top + dy, window.innerHeight - popoutDockedRect.value.height)) };
        }
      } else {
        const newX = Math.max(0, Math.min(startPos.current.x + dx, window.innerWidth - 100));
        const newY = Math.max(0, Math.min(startPos.current.y + dy, window.innerHeight - 50));
        popoutFloatingRect.value = { ...popoutFloatingRect.value, x: newX, y: newY };
        if (ev.clientX > window.innerWidth - SNAP_THRESHOLD) {
          const fr = popoutFloatingRect.value;
          popoutDockedRect.value = { top: fr.y, width: fr.w, height: fr.h };
          popoutDocked.value = true;
        }
      }
    };
    const onUp = () => { dragging.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); persistPopoutState(); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const onResizeStart = useCallback((edge: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = edge;
    const dr = popoutDockedRect.value;
    const fr = popoutFloatingRect.value;
    startPos.current = { mx: e.clientX, my: e.clientY, x: fr.x, y: fr.y, w: fr.w, h: fr.h, top: dr.top, width: dr.width, height: dr.height };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const dx = ev.clientX - startPos.current.mx;
      const dy = ev.clientY - startPos.current.my;
      const dir = resizing.current;
      if (popoutDocked.value) {
        let { top, width, height } = { top: startPos.current.top, width: startPos.current.width, height: startPos.current.height };
        if (dir.includes('n') || dir === 'top') { height = Math.max(MIN_H, height - dy); top = startPos.current.top + startPos.current.height - height; }
        if (dir.includes('s') || dir === 'bottom') { height = Math.max(MIN_H, height + dy); }
        if (dir.includes('w') || dir === 'left') { width = Math.max(MIN_W, width - dx); }
        popoutDockedRect.value = { top, width, height };
      } else {
        const s = startPos.current;
        let { x, y, w, h } = { x: s.x, y: s.y, w: s.w, h: s.h };
        if (dir.includes('e')) w = Math.max(MIN_W, s.w + dx);
        if (dir.includes('w')) { w = Math.max(MIN_W, s.w - dx); x = s.x + s.w - w; }
        if (dir.includes('s')) h = Math.max(MIN_H, s.h + dy);
        if (dir.includes('n')) { h = Math.max(MIN_H, s.h - dy); y = s.y + s.h - h; }
        popoutFloatingRect.value = { x, y, w, h };
      }
    };
    const onUp = () => { resizing.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); persistPopoutState(); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const onGrabMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    grabStart.current = { mx: e.clientX, my: e.clientY, time: Date.now() };
    grabMoved.current = false;
    const startW = popoutDockedRect.value.width;
    const startMx = e.clientX;
    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - grabStart.current.mx) > 3) {
        grabMoved.current = true;
        popoutDockedRect.value = { ...popoutDockedRect.value, width: Math.max(MIN_W, startW - (ev.clientX - startMx)) };
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!grabMoved.current && Date.now() - grabStart.current.time < 200) {
        popoutVisible.value = !popoutVisible.value;
      }
      persistPopoutState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const showZeroBadge = ctrlShiftHeld.value;
  const hasTabs = ids.length > 1;

  function tabLabel(sid: string) {
    const s = sessionMap.get(sid);
    const isPlain = s?.permissionProfile === 'plain';
    const raw = isPlain ? `Term ${sid.slice(-6)}` : (s?.feedbackTitle || s?.agentName || `Sess ${sid.slice(-6)}`);
    return raw.length > 20 ? raw.slice(0, 20) + '\u2026' : raw;
  }

  return (
    <>
      {docked && (
        <div
          class="popout-grab-tab"
          style={{ right: popoutDockedRect.value.width, top: popoutDockedRect.value.top + popoutDockedRect.value.height / 2 - 50 }}
          onMouseDown={onGrabMouseDown}
          title="Drag to resize, click to toggle"
        >
          {showZeroBadge
            ? <span class="popout-zero-badge">0</span>
            : <span class="grab-indicator">{'\u2503'}</span>
          }
        </div>
      )}
      <div class={docked ? 'popout-docked' : 'popout-floating'} style={panelStyle}>
        <div class="popout-header" onMouseDown={onHeaderDragStart}>
          {showZeroBadge && <span class="popout-zero-badge">0</span>}
          {hasTabs && (
            <div class="popout-tab-bar">
              {ids.map((sid) => (
                <button
                  key={sid}
                  class={`popout-tab ${sid === activeId ? 'active' : ''}`}
                  onClick={() => { activePopoutTabId.value = sid; persistPopoutState(); }}
                  title={sessionMap.get(sid)?.feedbackTitle || sid}
                >
                  <span>{tabLabel(sid)}</span>
                  <span class="popout-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(sid); }}>&times;</span>
                </button>
              ))}
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
            <button onClick={() => setPopoutDocked(!docked)} title={docked ? 'Undock to floating' : 'Dock to right edge'}>
              {docked ? '\u25A1 Float' : '\u25E8 Dock'}
            </button>
            {activeId && !isExited && session?.feedbackId && (
              <button onClick={() => resolveSession(activeId, session.feedbackId)} title="Resolve">Resolve</button>
            )}
            {activeId && (isExited ? (
              <button onClick={() => resumeSession(activeId)} title="Resume">Resume</button>
            ) : (
              <button onClick={() => killSession(activeId)} title="Kill">Kill</button>
            ))}
            <button onClick={() => popBackIn()} title="Pop back into tab bar">{'\u2199'} Pop in</button>
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

function CollapsedGrabTab() {
  const dockedRect = popoutDockedRect.value;
  const showZeroBadge = ctrlShiftHeld.value;
  return (
    <div
      class="popout-grab-tab"
      style={{ right: 0, top: dockedRect.top + dockedRect.height / 2 - 50 }}
      onClick={() => { popoutVisible.value = true; persistPopoutState(); }}
      title="Show panel"
    >
      {showZeroBadge
        ? <span class="popout-zero-badge">0</span>
        : <span class="grab-indicator">{'\u2503'}</span>
      }
    </div>
  );
}

export function PopoutPanel() {
  if (poppedOutTabIds.value.length === 0) return null;

  if (!popoutVisible.value) {
    if (popoutDocked.value) return <CollapsedGrabTab />;
    return null;
  }

  return <UnifiedPanel />;
}
