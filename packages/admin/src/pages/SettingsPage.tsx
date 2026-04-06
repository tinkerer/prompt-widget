import { useState, useEffect } from 'preact/hooks';
import { theme, setTheme, shortcutsEnabled, tooltipsEnabled, showTabs, arrowTabSwitching, multiDigitTabs, autoNavigateToFeedback, showHotkeyHints, autoJumpWaiting, autoJumpInterrupt, autoJumpDelay, popoutMode, type Theme, type PopoutMode } from '../lib/settings.js';
import { perfOverlayEnabled, perfServerEnabled } from '../lib/perf.js';
import { getAllShortcuts } from '../lib/shortcuts.js';
import { Guide, GUIDES, resetGuide } from '../components/Guide.js';
import { hintsEnabled, resetAllHints } from '../lib/hints.js';
import { autoFixEnabled, setAutoFixEnabled } from '../lib/autofix.js';
import { panelPresets, savePreset, restorePreset, deletePreset } from '../lib/sessions.js';
import { DeletedItemsPanel } from '../components/DeletedItemsPanel.js';

function formatKey(s: ReturnType<typeof getAllShortcuts>[0]): string {
  const parts: string[] = [];
  if (s.modifiers?.ctrl) parts.push('Ctrl');
  if (s.modifiers?.shift) parts.push('Shift');
  if (s.modifiers?.alt) parts.push('Alt');
  if (s.modifiers?.meta) parts.push('Cmd');
  if (s.sequence) return s.sequence;
  parts.push(s.key === ' ' ? 'Space' : s.key);
  return parts.join('+');
}

function PanelPresetManager() {
  const [newName, setNewName] = useState('');
  const presets = panelPresets.value;

  return (
    <div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <input
          type="text"
          placeholder="Preset name..."
          value={newName}
          onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
          style="flex:1;padding:6px 10px;font-size:13px"
        />
        <button
          class="btn btn-sm btn-primary"
          disabled={!newName.trim()}
          onClick={() => {
            if (newName.trim()) {
              savePreset(newName.trim());
              setNewName('');
            }
          }}
        >
          Save Current
        </button>
      </div>
      {presets.length === 0 && (
        <div style="font-size:12px;color:var(--pw-text-muted)">No saved presets yet.</div>
      )}
      {presets.map((p) => (
        <div key={p.name} class="preset-row">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600">{p.name}</div>
            <div style="font-size:11px;color:var(--pw-text-faint)">
              {p.openTabs.length} tabs, {p.panels.length} panels &middot; {new Date(p.savedAt).toLocaleDateString()}
            </div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm" onClick={() => restorePreset(p.name)}>Restore</button>
            <button class="btn btn-sm btn-danger" onClick={() => deletePreset(p.name)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}


export function SettingsPage() {
  const [activeGuide, setActiveGuide] = useState<typeof GUIDES[0] | null>(null);
  const shortcuts = getAllShortcuts();
  const categories = ['Navigation', 'Panels', 'General'] as const;

  const themes: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];

  return (
    <div>
      <div class="page-header">
        <h2>Preferences</h2>
      </div>

      <div class="detail-card" style="margin-bottom:20px;max-width:1000px">
        <div class="settings-section">
          <h3>Appearance</h3>
          <div class="theme-toggle-group">
            {themes.map((t) => (
              <button
                key={t.value}
                class={`theme-toggle-btn ${theme.value === t.value ? 'active' : ''}`}
                onClick={() => setTheme(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div class="settings-section">
          <h3>Keyboard Shortcuts</h3>
          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Enable keyboard shortcuts</div>
              <div class="settings-toggle-desc">Navigate and control the UI with hotkeys</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={shortcutsEnabled.value}
                onChange={(e) => (shortcutsEnabled.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Arrow key tab switching</div>
              <div class="settings-toggle-desc">Ctrl+Shift+Arrow to cycle pages and session tabs</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={arrowTabSwitching.value}
                onChange={(e) => (arrowTabSwitching.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Show hotkey hints</div>
              <div class="settings-toggle-desc">Show action menu (Kill, Resolve, Close) on active tab when holding Ctrl+Shift</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={showHotkeyHints.value}
                onChange={(e) => (showHotkeyHints.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Multi-digit tab numbers</div>
              <div class="settings-toggle-desc">Ctrl+Shift+1 jumps to tab 1, then 2 within 500ms refines to tab 12</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={multiDigitTabs.value}
                onChange={(e) => (multiDigitTabs.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          {shortcuts.length > 0 && (
            <div style="margin-top:16px">
              {categories.map((cat) => {
                const items = shortcuts.filter((s) => s.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} class="shortcut-section">
                    <h4>{cat}</h4>
                    {items.map((s) => {
                      const keyStr = formatKey(s);
                      const parts = keyStr.split(' ');
                      return (
                        <div key={keyStr + s.label} class="shortcut-row">
                          <span class="shortcut-label">{s.label}</span>
                          <span class="shortcut-keys">
                            {parts.map((p, i) => (
                              <>
                                {i > 0 && <span class="then">then</span>}
                                <kbd>{p}</kbd>
                              </>
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div class="settings-section">
          <h3>Terminal</h3>
          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Show session tabs</div>
              <div class="settings-toggle-desc">Display tab bar with session titles in the terminal panel</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={showTabs.value}
                onChange={(e) => (showTabs.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Auto-jump to next waiting session</div>
              <div class="settings-toggle-desc">After providing input to a waiting session, automatically jump to the next one waiting</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={autoJumpWaiting.value}
                onChange={(e) => (autoJumpWaiting.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row" style={{ paddingLeft: 24 }}>
            <div>
              <div class="settings-toggle-label">Interrupt typing</div>
              <div class="settings-toggle-desc">Jump immediately even if you're in the middle of typing</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={autoJumpInterrupt.value}
                onChange={(e) => (autoJumpInterrupt.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row" style={{ paddingLeft: 24 }}>
            <div>
              <div class="settings-toggle-label">3 second delay</div>
              <div class="settings-toggle-desc">Wait 3 seconds before jumping (cancel with Ctrl+Shift+X)</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={autoJumpDelay.value}
                onChange={(e) => (autoJumpDelay.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Auto-navigate to feedback</div>
              <div class="settings-toggle-desc">When switching sessions, navigate to the associated feedback item</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={autoNavigateToFeedback.value}
                onChange={(e) => (autoNavigateToFeedback.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Default popout action</div>
              <div class="settings-toggle-desc">Where sessions open when you click the popout button</div>
            </div>
            <select
              class="view-mode-select"
              value={popoutMode.value}
              onChange={(e) => { popoutMode.value = (e.target as HTMLSelectElement).value as PopoutMode; }}
            >
              <option value="panel">Panel</option>
              <option value="window">Window</option>
              <option value="tab">Tab</option>
              <option value="terminal">Terminal.app</option>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <h3>Panel Presets</h3>
          <div class="settings-toggle-desc" style="margin-bottom:10px">
            Save and restore panel arrangements (tab layout, docked panels, sizes).
          </div>
          <PanelPresetManager />
        </div>

        <div class="settings-section">
          <h3>Tooltips & Hints</h3>
          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Show tooltips on hover</div>
              <div class="settings-toggle-desc">Display hints and keyboard shortcut reminders</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={tooltipsEnabled.value}
                onChange={(e) => (tooltipsEnabled.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Show contextual hints</div>
              <div class="settings-toggle-desc">Display hint toasts when navigating to new pages</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={hintsEnabled.value}
                onChange={(e) => (hintsEnabled.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>

          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Reset dismissed hints</div>
              <div class="settings-toggle-desc">Show all contextual hints again</div>
            </div>
            <button
              class="btn btn-sm"
              onClick={() => {
                resetAllHints();
                hintsEnabled.value = true;
              }}
            >
              Reset
            </button>
          </div>

          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Auto-fix failed sessions</div>
              <div class="settings-toggle-desc">Automatically launch a diagnostic session when a remote session fails immediately</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={autoFixEnabled.value}
                onChange={(e) => setAutoFixEnabled((e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h3>Guides</h3>
          {GUIDES.map((guide) => (
            <div key={guide.id} class="settings-toggle-row">
              <div>
                <div class="settings-toggle-label">{guide.name}</div>
                <div class="settings-toggle-desc">{guide.steps.length} steps</div>
              </div>
              <button
                class="btn btn-sm"
                onClick={() => {
                  resetGuide(guide.id);
                  setActiveGuide(guide);
                }}
              >
                Start Tour
              </button>
            </div>
          ))}
        </div>

        <div class="settings-section">
          <h3>Developer</h3>
          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Performance overlay</div>
              <div class="settings-toggle-desc">Show a timing badge for API calls on each page load</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={perfOverlayEnabled.value}
                onChange={(e) => (perfOverlayEnabled.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>
          <div class="settings-toggle-row">
            <div>
              <div class="settings-toggle-label">Persist performance data</div>
              <div class="settings-toggle-desc">Send timing data to the server on route changes</div>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                checked={perfServerEnabled.value}
                onChange={(e) => (perfServerEnabled.value = (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider" />
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h3>About</h3>
          <div style="font-size:13px;color:var(--pw-text-muted)">
            Prompt Widget Admin v1.0
          </div>
        </div>
      </div>

      {activeGuide && (
        <Guide guide={activeGuide} onClose={() => setActiveGuide(null)} />
      )}
    </div>
  );
}
