import { signal, effect } from '@preact/signals';

export type Theme = 'light' | 'dark' | 'system';

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export const theme = signal<Theme>(loadSetting('pw-theme', 'system'));
export const shortcutsEnabled = signal<boolean>(loadSetting('pw-shortcuts-enabled', true));
export const tooltipsEnabled = signal<boolean>(loadSetting('pw-tooltips-enabled', true));
export const showTabs = signal<boolean>(loadSetting('pw-show-tabs', true));
export const arrowTabSwitching = signal<boolean>(loadSetting('pw-arrow-tab-switching', true));
export const multiDigitTabs = signal<boolean>(loadSetting('pw-multi-digit-tabs', true));
export const autoNavigateToFeedback = signal<boolean>(loadSetting('pw-auto-navigate-feedback', false));

export function getEffectiveTheme(): 'light' | 'dark' {
  if (theme.value !== 'system') return theme.value;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme() {
  const el = document.documentElement;
  if (theme.value === 'system') {
    el.removeAttribute('data-theme');
  } else {
    el.setAttribute('data-theme', theme.value);
  }
}

export function setTheme(t: Theme) {
  theme.value = t;
}

export function toggleTheme() {
  const effective = getEffectiveTheme();
  theme.value = effective === 'dark' ? 'light' : 'dark';
}

// Persist settings to localStorage
effect(() => {
  localStorage.setItem('pw-theme', JSON.stringify(theme.value));
  applyTheme();
});

effect(() => {
  localStorage.setItem('pw-shortcuts-enabled', JSON.stringify(shortcutsEnabled.value));
});

effect(() => {
  localStorage.setItem('pw-tooltips-enabled', JSON.stringify(tooltipsEnabled.value));
});

effect(() => {
  localStorage.setItem('pw-show-tabs', JSON.stringify(showTabs.value));
});

effect(() => {
  localStorage.setItem('pw-arrow-tab-switching', JSON.stringify(arrowTabSwitching.value));
});

effect(() => {
  localStorage.setItem('pw-multi-digit-tabs', JSON.stringify(multiDigitTabs.value));
});

effect(() => {
  localStorage.setItem('pw-auto-navigate-feedback', JSON.stringify(autoNavigateToFeedback.value));
});

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme.value === 'system') {
    applyTheme();
  }
});

// Apply theme immediately on load
applyTheme();
