import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { selectedAppId, applications, navigate, addAppModalOpen } from '../lib/state.js';
import { api } from '../lib/api.js';
import {
  focusOrDockSession,
  spawnTerminal,
  controlBarMinimized,
  toggleControlBarMinimized,
  popoutPanels,
  panelZOrders,
  bringToFront,
  activePanelId,
  allSessions,
  getSessionLabel,
} from '../lib/sessions.js';

function getMruLabel(panel: { id: string; sessionIds: string[]; activeSessionId: string; label?: string }, sessionMap: Map<string, any>): string {
  if (panel.label) return panel.label;
  const sid = panel.activeSessionId || panel.sessionIds[0];
  if (!sid) return panel.id.slice(-6);
  const custom = getSessionLabel(sid);
  if (custom) return custom;
  const sess = sessionMap.get(sid);
  if (sess?.feedbackTitle) return sess.feedbackTitle;
  if (sess?.agentName) return sess.agentName;
  return `Session ${sid.slice(-6)}`;
}

export function ControlBar() {
  const appId = selectedAppId.value;
  const apps = applications.value;
  const app = appId ? apps.find((a: any) => a.id === appId) : null;
  const actions: { id: string; label: string; command: string; icon?: string }[] =
    app?.controlActions || [];
  const minimized = controlBarMinimized.value;

  const [running, setRunning] = useState<string | null>(null);
  const [appDropdown, setAppDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!appDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAppDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [appDropdown]);

  const panels = popoutPanels.value;
  const zOrders = panelZOrders.value;
  const sessions = allSessions.value;
  const sessionMap = useMemo(() => new Map(sessions.map((s: any) => [s.id, s])), [sessions]);

  const mruPanels = useMemo(() => {
    const visible = panels.filter((p: any) => p.visible);
    return visible
      .sort((a: any, b: any) => (zOrders.get(b.id) || 0) - (zOrders.get(a.id) || 0))
      .slice(0, 5);
  }, [panels, zOrders]);

  async function run(actionId: string) {
    if (!appId || running) return;
    setRunning(actionId);
    try {
      const res = await api.runControlAction(appId, actionId);
      if (res.sessionId) {
        focusOrDockSession(res.sessionId);
      }
    } catch (err) {
      console.error('Control action failed:', err);
    }
    setRunning(null);
  }

  function selectApp(id: string) {
    setAppDropdown(false);
    navigate(`/app/${id}/feedback`);
  }

  if (minimized) {
    return (
      <div class="control-bar control-bar-minimized">
        <button
          class="control-bar-btn control-bar-app-btn"
          onClick={toggleControlBarMinimized}
          title="Expand control bar"
        >
          <span class="control-bar-icon">{'\u{1F4BB}'}</span>
          {app?.name || 'Select App'}
          <span class="control-bar-caret">{'\u25B8'}</span>
        </button>
      </div>
    );
  }

  return (
    <div class="control-bar">
      {/* App selector */}
      <div class="control-bar-dropdown" ref={dropdownRef}>
        <button
          class="control-bar-btn control-bar-app-btn"
          onClick={() => setAppDropdown(!appDropdown)}
        >
          <span class="control-bar-icon">{'\u{1F4BB}'}</span>
          {app?.name || 'Select App'}
          <span class="control-bar-caret">{'\u25BE'}</span>
        </button>
        {appDropdown && (
          <div class="control-bar-menu">
            {apps.map((a: any) => (
              <button
                key={a.id}
                class={`control-bar-menu-item ${a.id === appId ? 'active' : ''}`}
                onClick={() => selectApp(a.id)}
              >
                {a.name}
              </button>
            ))}
            <div class="control-bar-menu-divider" />
            <button
              class="control-bar-menu-item"
              onClick={() => { setAppDropdown(false); addAppModalOpen.value = true; }}
            >
              + New App
            </button>
          </div>
        )}
      </div>

      <div class="control-bar-sep" />

      {/* Control actions */}
      {actions.map((a) => (
        <button
          key={a.id}
          class="control-bar-btn"
          onClick={() => run(a.id)}
          disabled={running === a.id}
          title={a.command}
        >
          {a.icon && <span class="control-bar-icon">{a.icon}</span>}
          {running === a.id ? 'Running\u2026' : a.label}
        </button>
      ))}

      {actions.length > 0 && <div class="control-bar-sep" />}

      {/* Utility buttons */}
      <button
        class="control-bar-btn"
        onClick={() => spawnTerminal(appId)}
        title="New terminal"
      >
        <span class="control-bar-icon">{'\u{1F4DF}'}</span>
        Terminal
      </button>

      {/* MRU panel list */}
      {mruPanels.length > 0 && (
        <>
          <div class="control-bar-sep" />
          {mruPanels.map((p: any) => (
            <button
              key={p.id}
              class={`control-bar-btn control-bar-mru-btn ${activePanelId.value === p.id ? 'control-bar-mru-active' : ''}`}
              onClick={() => { bringToFront(p.id); activePanelId.value = p.id; }}
              title={getMruLabel(p, sessionMap)}
            >
              {getMruLabel(p, sessionMap)}
            </button>
          ))}
        </>
      )}

      <div style="flex:1" />
      <button
        class="control-bar-btn control-bar-minimize-btn"
        onClick={toggleControlBarMinimized}
        title="Minimize control bar"
      >
        {'\u2212'}
      </button>
    </div>
  );
}
