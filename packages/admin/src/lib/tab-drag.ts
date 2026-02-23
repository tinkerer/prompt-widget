import {
  openTabs,
  popOutTab,
  popBackIn,
  moveSessionToPanel,
  splitFromPanel,
  findPanelForSession,
  reorderTabInPanel,
  reorderGlobalTab,
  splitEnabled,
  rightPaneTabs,
  leftPaneTabs,
  moveToRightPane,
  moveToLeftPane,
  reorderRightPaneTab,
} from './sessions.js';

export type TabDragSource = 'main' | 'split-left' | 'split-right' | { panelId: string };

export interface TabDragConfig {
  sessionId: string;
  source: TabDragSource;
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
  let dropTarget: { type: 'panel'; panelId: string } | { type: 'main' } | { type: 'split-left' } | { type: 'split-right' } | null = null;
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

  function sourceIsPanelId(): string | null {
    if (typeof config.source === 'object' && 'panelId' in config.source) return config.source.panelId;
    return null;
  }

  function detectDropTarget(x: number, y: number): typeof dropTarget {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (el === ghost || el === reorderIndicator) continue;

      // Check split panes
      const splitPane = (el as HTMLElement).closest?.('[data-split-pane]') as HTMLElement | null;
      if (splitPane) {
        const paneId = splitPane.dataset.splitPane as 'split-left' | 'split-right';
        if (config.source === paneId) continue;
        return { type: paneId };
      }

      const panelEl = (el as HTMLElement).closest?.('[data-panel-id]') as HTMLElement | null;
      if (panelEl) {
        const panelId = panelEl.dataset.panelId!;
        const srcPanelId = sourceIsPanelId();
        if (srcPanelId && srcPanelId === panelId) continue;
        return { type: 'panel', panelId };
      }
      if ((el as HTMLElement).closest?.('.terminal-tab-bar')) {
        if (config.source === 'main') continue;
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
    } else if (target.type === 'split-left' || target.type === 'split-right') {
      const el = document.querySelector(`[data-split-pane="${target.type}"]`);
      if (el) { el.classList.add('drop-target'); lastHighlighted = el; }
    } else {
      const el = document.querySelector('.terminal-tab-bar');
      if (el) { el.classList.add('drop-target'); lastHighlighted = el; }
    }
  }

  function updateReorderIndicator(x: number, y: number) {
    const els = document.elementsFromPoint(x, y);
    let tabBar: HTMLElement | null = null;
    let isSamePanel = false;

    for (const el of els) {
      if (el === ghost || el === reorderIndicator) continue;

      // Check split pane tab bars
      if (config.source === 'split-left' || config.source === 'split-right') {
        const splitPane = (el as HTMLElement).closest?.(`[data-split-pane="${config.source}"]`) as HTMLElement | null;
        if (splitPane) {
          const tb = splitPane.querySelector('.split-pane-tab-bar .terminal-tabs') as HTMLElement | null;
          if (tb) { tabBar = tb; isSamePanel = true; break; }
        }
      }

      // Check popout panel tab bars
      const srcPanelId = sourceIsPanelId();
      if (srcPanelId) {
        const panelEl = (el as HTMLElement).closest?.('[data-panel-id]') as HTMLElement | null;
        if (panelEl && panelEl.dataset.panelId === srcPanelId) {
          const tb = panelEl.querySelector('.popout-tab-bar') as HTMLElement | null;
          if (tb) { tabBar = tb; isSamePanel = true; break; }
        }
      }
      // Check global tab bar
      if (config.source === 'main') {
        const tb = (el as HTMLElement).closest?.('.terminal-tabs') as HTMLElement | null;
        if (tb && !tb.closest('[data-split-pane]')) { tabBar = tb; isSamePanel = true; break; }
      }
    }

    if (!isSamePanel || !tabBar) {
      removeReorderIndicator();
      reorderInsertBefore = null;
      return;
    }

    const tabSelector = config.source === 'main' || config.source === 'split-left' || config.source === 'split-right'
      ? '.terminal-tab' : '.popout-tab';
    const tabs = Array.from(tabBar.querySelectorAll(tabSelector)) as HTMLElement[];
    let insertBefore: string | null = null;
    let indicatorX = 0;
    let found = false;

    for (const tab of tabs) {
      const rect = tab.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (x < mid) {
        const tabIdx = tabs.indexOf(tab);
        if (config.source === 'main') {
          const tabIds = splitEnabled.value ? leftPaneTabs() : openTabs.value;
          insertBefore = tabIds[tabIdx] || null;
        } else if (config.source === 'split-left') {
          insertBefore = leftPaneTabs()[tabIdx] || null;
        } else if (config.source === 'split-right') {
          insertBefore = rightPaneTabs.value[tabIdx] || null;
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

    // Same-pane reorder
    if (hadReorderIndicator && reorderInsertBefore !== config.sessionId) {
      if (config.source === 'main') {
        reorderGlobalTab(config.sessionId, reorderInsertBefore);
      } else if (config.source === 'split-left') {
        reorderGlobalTab(config.sessionId, reorderInsertBefore);
      } else if (config.source === 'split-right') {
        reorderRightPaneTab(config.sessionId, reorderInsertBefore);
      } else {
        reorderTabInPanel((config.source as { panelId: string }).panelId, config.sessionId, reorderInsertBefore);
      }
      return;
    }

    const srcPanelId = sourceIsPanelId();

    if (config.source === 'main' || config.source === 'split-left') {
      if (dropTarget?.type === 'split-right') {
        moveToRightPane(config.sessionId);
      } else if (dropTarget?.type === 'panel') {
        moveSessionToPanel(config.sessionId, dropTarget.panelId);
      } else if (!dropTarget && !hadReorderIndicator) {
        popOutTab(config.sessionId);
      }
    } else if (config.source === 'split-right') {
      if (dropTarget?.type === 'main' || dropTarget?.type === 'split-left') {
        moveToLeftPane(config.sessionId);
      } else if (dropTarget?.type === 'panel') {
        moveSessionToPanel(config.sessionId, dropTarget.panelId);
      } else if (!dropTarget && !hadReorderIndicator) {
        popOutTab(config.sessionId);
      }
    } else if (srcPanelId) {
      if (dropTarget?.type === 'main' || dropTarget?.type === 'split-left') {
        popBackIn(config.sessionId);
      } else if (dropTarget?.type === 'split-right') {
        popBackIn(config.sessionId);
        moveToRightPane(config.sessionId);
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
