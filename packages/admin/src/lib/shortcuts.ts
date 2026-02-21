import { signal } from '@preact/signals';
import { shortcutsEnabled } from './settings.js';

export interface Shortcut {
  key: string;
  code?: string; // e.g. 'Digit1' — matches e.code instead of e.key
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
  sequence?: string; // e.g. "g f" — first key already matched, this is the second
  label: string;
  category: 'Navigation' | 'Panels' | 'General';
  action: () => void;
}

export const ctrlShiftHeld = signal(false);

const registry: Shortcut[] = [];
let pendingSequence: string | null = null;
let sequenceTimer: ReturnType<typeof setTimeout> | null = null;

export function registerShortcut(shortcut: Shortcut): () => void {
  registry.push(shortcut);
  return () => {
    const idx = registry.indexOf(shortcut);
    if (idx >= 0) registry.splice(idx, 1);
  };
}

export function getAllShortcuts(): Shortcut[] {
  return [...registry];
}

function isInputFocused(): boolean {
  let el: Element | null = document.activeElement;
  if (!el) return false;
  // Traverse into shadow roots — when focus is inside a Shadow DOM,
  // document.activeElement returns the host element, not the inner target.
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable) {
    return true;
  }
  // xterm.js terminals live inside .xterm containers — treat them as input targets
  // so global shortcuts don't steal keystrokes from the PTY
  if (el.closest?.('.xterm')) return true;
  return false;
}

function matchesModifiers(e: KeyboardEvent, mods?: Shortcut['modifiers']): boolean {
  const ctrl = mods?.ctrl || false;
  const shift = mods?.shift || false;
  const alt = mods?.alt || false;
  const meta = mods?.meta || false;
  return e.ctrlKey === ctrl && e.shiftKey === shift && e.altKey === alt && e.metaKey === meta;
}

function normalizeCode(code: string): string {
  const m = code.match(/^Numpad(\d)$/);
  return m ? `Digit${m[1]}` : code;
}

function handleKeyDown(e: KeyboardEvent) {
  if (!shortcutsEnabled.value) return;
  const code = normalizeCode(e.code);
  const ctrlOrMeta = e.ctrlKey || e.metaKey;
  const inXterm = !!document.activeElement?.closest?.('.xterm');
  if (isInputFocused() && (e.key !== 'Escape' || inXterm)) {
    // Spotlight shortcut works from any context
    if (ctrlOrMeta && e.shiftKey && e.code === 'Space') { /* allow through */ }
    else if (ctrlOrMeta && e.key === 'k') { /* allow through */ }
    else {
      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
      const isDigit = /^Digit[0-9]$/.test(code);
      const isMinusEqual = code === 'Minus' || code === 'Equal';
      if (!(inXterm && ctrlOrMeta && e.shiftKey && (isArrow || isDigit || isMinusEqual))) return;
    }
  }

  // Handle second key in sequence
  if (pendingSequence) {
    const prefix = pendingSequence;
    clearSequence();
    const combo = `${prefix} ${e.key}`;
    for (const s of registry) {
      if (s.sequence === combo && matchesModifiers(e, s.modifiers)) {
        e.preventDefault();
        e.stopPropagation();
        s.action();
        return;
      }
    }
    return;
  }

  // Check for sequence starters (single char that begins a two-key combo)
  const sequenceStarters = new Set(
    registry
      .filter((s) => s.sequence)
      .map((s) => s.sequence!.split(' ')[0])
  );

  if (sequenceStarters.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const directMatch = registry.find(
      (s) => !s.sequence && s.key === e.key && matchesModifiers(e, s.modifiers)
    );
    if (!directMatch) {
      e.preventDefault();
      pendingSequence = e.key;
      sequenceTimer = setTimeout(clearSequence, 1000);
      return;
    }
  }

  // Direct single-key shortcuts (normalize numpad codes)
  for (const s of registry) {
    if (s.sequence) continue;
    const keyMatch = s.code ? s.code === code : s.key === e.key;
    if (keyMatch && matchesModifiers(e, s.modifiers)) {
      e.preventDefault();
      e.stopPropagation();
      s.action();
      return;
    }
  }
}

function clearSequence() {
  pendingSequence = null;
  if (sequenceTimer) {
    clearTimeout(sequenceTimer);
    sequenceTimer = null;
  }
}

// Track Ctrl+Shift held state for tab number overlay
function updateCtrlShift(e: KeyboardEvent) {
  ctrlShiftHeld.value = e.ctrlKey && e.shiftKey;
}

function clearCtrlShift() {
  ctrlShiftHeld.value = false;
}

// Install global handler
// Capture phase so we intercept before xterm.js processes the event
document.addEventListener('keydown', (e) => { updateCtrlShift(e); handleKeyDown(e); }, true);
document.addEventListener('keyup', updateCtrlShift, true);
window.addEventListener('blur', clearCtrlShift);
