import { shortcutsEnabled } from './settings.js';

export interface Shortcut {
  key: string;
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
  sequence?: string; // e.g. "g f" — first key already matched, this is the second
  label: string;
  category: 'Navigation' | 'Panels' | 'General';
  action: () => void;
}

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
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
}

function matchesModifiers(e: KeyboardEvent, mods?: Shortcut['modifiers']): boolean {
  const ctrl = mods?.ctrl || false;
  const shift = mods?.shift || false;
  const alt = mods?.alt || false;
  const meta = mods?.meta || false;
  return e.ctrlKey === ctrl && e.shiftKey === shift && e.altKey === alt && e.metaKey === meta;
}

function handleKeyDown(e: KeyboardEvent) {
  if (!shortcutsEnabled.value) return;
  if (isInputFocused() && e.key !== 'Escape') return;

  // Handle second key in sequence
  if (pendingSequence) {
    const prefix = pendingSequence;
    clearSequence();
    const combo = `${prefix} ${e.key}`;
    for (const s of registry) {
      if (s.sequence === combo && matchesModifiers(e, s.modifiers)) {
        e.preventDefault();
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
    // Check if there's also a non-sequence shortcut for this key
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

  // Direct single-key shortcuts
  for (const s of registry) {
    if (s.sequence) continue;
    if (s.key === e.key && matchesModifiers(e, s.modifiers)) {
      e.preventDefault();
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

// Install global handler
document.addEventListener('keydown', handleKeyDown);
