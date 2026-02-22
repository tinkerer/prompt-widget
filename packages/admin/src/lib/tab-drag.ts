import {
  openTabs,
  popOutTab,
  popBackIn,
  moveSessionToPanel,
  splitFromPanel,
  findPanelForSession,
  reorderTabInPanel,
  reorderGlobalTab,
} from './sessions.js';

export interface TabDragConfig {
  sessionId: string;
  source: 'main' | { panelId: string };
  label: string;
  onClickFallback: () => void;
}

const DRAG_THRESHOLD = 6;

export function startTabDrag(e: MouseEvent, config: TabDragConfig): void {
  const target = e.target as HTMLElement;
  if (target.closest('.tab-close, .popout-tab-close, .status-dot')) return;

  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let sourceTab: HTMLElement | null = (e.currentTarget as HTMLElement);
  let dropTarget: { type: 'panel'; panelId: string } | { type: 'main' } | null = null;
  let lastHighlighted: Element | null = null;
  let reorderIndicator: HTMLElement | null = null;
  let reorderInsertBefore: string | null = null;

  function createGhost() {
    ghost = document.createElement('div');
    ghost.className = 'tab-drag-ghost';
    ghost.textContent = config.label;
    document.body.appendChild(ghost);
    sourceTab?.classList.add('tab-dragging');
  }

  function updateGhost(x: number, y: number) {
    if (!ghost) return;
    ghost.style.left = `${x + 12}px`;
    ghost.style.top = `${y - 12}px`;
  }

  function detectDropTarget(x: number, y: number): typeof dropTarget {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (el === ghost || el === reorderIndicator) continue;
      const panelEl = (el as HTMLElement).closest?.('[data-panel-id]') as HTMLElement | null;
      if (panelEl) {
        const panelId = panelEl.dataset.panelId!;
        if (config.source !== 'main' && config.source.panelId === panelId) {
          continue;
        }
        return { type: 'panel', panelId };
      }
      if ((el as HTMLElement).closest?.('.terminal-tab-bar')) {
        return { type: 'main' };
      }
    }
    return null;
  }

  function highlightTarget(target: typeof dropTarget) {
    if (lastHighlighted) {
      lastHighlighted.classList.remove('drop-target');
      lastHighlighted = null;
    }
    if (!target) {
      ghost?.classList.remove('will-drop');
      return;
    }
    ghost?.classList.add('will-drop');
    if (target.type === 'panel') {
      const el = document.querySelector(`[data-panel-id="${target.panelId}"]`);
      if (el) { el.classList.add('drop-target'); lastHighlighted = el; }
    } else {
      const el = document.querySelector('.terminal-tab-bar');
      if (el) { el.classList.add('drop-target'); lastHighlighted = el; }
    }
  }

  function updateReorderIndicator(x: number, y: number) {
    // Find if hovering over the same panel's tab bar
    const els = document.elementsFromPoint(x, y);
    let tabBar: HTMLElement | null = null;
    let isSamePanel = false;

    for (const el of els) {
      if (el === ghost || el === reorderIndicator) continue;
      // Check popout panel tab bars
      if (config.source !== 'main') {
        const panelEl = (el as HTMLElement).closest?.('[data-panel-id]') as HTMLElement | null;
        if (panelEl && panelEl.dataset.panelId === (config.source as { panelId: string }).panelId) {
          const tb = panelEl.querySelector('.popout-tab-bar') as HTMLElement | null;
          if (tb) { tabBar = tb; isSamePanel = true; break; }
        }
      }
      // Check global tab bar
      if (config.source === 'main') {
        const tb = (el as HTMLElement).closest?.('.terminal-tabs') as HTMLElement | null;
        if (tb) { tabBar = tb; isSamePanel = true; break; }
      }
    }

    if (!isSamePanel || !tabBar) {
      removeReorderIndicator();
      reorderInsertBefore = null;
      return;
    }

    // Find insertion point by comparing x against tab midpoints
    const tabs = Array.from(tabBar.querySelectorAll(config.source === 'main' ? '.terminal-tab' : '.popout-tab')) as HTMLElement[];
    let insertBefore: string | null = null;
    let indicatorX = 0;
    let found = false;

    for (const tab of tabs) {
      const rect = tab.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (x < mid) {
        // Get session id from the tab — use the tab's index to look up
        const tabIdx = tabs.indexOf(tab);
        if (config.source === 'main') {
          const tabIds = openTabs.value;
          insertBefore = tabIds[tabIdx] || null;
        } else {
          const panel = findPanelForSession(config.sessionId);
          if (panel) insertBefore = panel.sessionIds[tabIdx] || null;
        }
        indicatorX = rect.left;
        found = true;
        break;
      }
    }

    if (!found && tabs.length > 0) {
      const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
      indicatorX = lastRect.right;
      insertBefore = null;
    }

    reorderInsertBefore = insertBefore;

    if (!reorderIndicator) {
      reorderIndicator = document.createElement('div');
      reorderIndicator.className = 'tab-reorder-indicator';
      document.body.appendChild(reorderIndicator);
    }

    const barRect = tabBar.getBoundingClientRect();
    reorderIndicator.style.left = `${indicatorX}px`;
    reorderIndicator.style.top = `${barRect.top}px`;
    reorderIndicator.style.height = `${barRect.height}px`;
  }

  function removeReorderIndicator() {
    if (reorderIndicator) {
      reorderIndicator.remove();
      reorderIndicator = null;
    }
  }

  function onMove(ev: MouseEvent) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
      dragging = true;
      createGhost();
    }
    if (!dragging) return;
    updateGhost(ev.clientX, ev.clientY);
    dropTarget = detectDropTarget(ev.clientX, ev.clientY);
    highlightTarget(dropTarget);
    updateReorderIndicator(ev.clientX, ev.clientY);
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    if (lastHighlighted) lastHighlighted.classList.remove('drop-target');
    sourceTab?.classList.remove('tab-dragging');
    if (ghost) { ghost.remove(); ghost = null; }
    const hadReorderIndicator = !!reorderIndicator;
    removeReorderIndicator();

    if (!dragging) {
      config.onClickFallback();
      return;
    }

    // Same-panel reorder
    if (hadReorderIndicator && reorderInsertBefore !== config.sessionId) {
      if (config.source === 'main') {
        reorderGlobalTab(config.sessionId, reorderInsertBefore);
      } else {
        reorderTabInPanel((config.source as { panelId: string }).panelId, config.sessionId, reorderInsertBefore);
      }
      return;
    }

    if (config.source === 'main') {
      if (dropTarget?.type === 'panel') {
        moveSessionToPanel(config.sessionId, dropTarget.panelId);
      } else if (!dropTarget) {
        popOutTab(config.sessionId);
      }
    } else {
      const srcPanelId = (config.source as { panelId: string }).panelId;
      if (dropTarget?.type === 'main') {
        popBackIn(config.sessionId);
      } else if (dropTarget?.type === 'panel' && dropTarget.panelId !== srcPanelId) {
        moveSessionToPanel(config.sessionId, dropTarget.panelId);
      } else if (!dropTarget && !hadReorderIndicator) {
        splitFromPanel(config.sessionId);
      }
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
