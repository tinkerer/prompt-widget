import { useState } from 'preact/hooks';
import { theme, setTheme, shortcutsEnabled, tooltipsEnabled, showTabs, type Theme } from '../lib/settings.js';
import { getAllShortcuts } from '../lib/shortcuts.js';
import { Guide, GUIDES, resetGuide } from '../components/Guide.js';

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

      <div class="detail-card" style="margin-bottom:20px;max-width:700px">
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
        </div>

        <div class="settings-section">
          <h3>Tooltips</h3>
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
