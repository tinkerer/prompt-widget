import { toBlob } from 'html-to-image';

async function settleAnimations() {
  const allAnimations: Animation[] = [];
  allAnimations.push(...document.getAnimations());
  const host = document.querySelector('prompt-widget-host');
  if (host?.shadowRoot) {
    const sr = host.shadowRoot as unknown as { getAnimations?: () => Animation[] };
    if (typeof sr.getAnimations === 'function') {
      allAnimations.push(...sr.getAnimations());
    } else {
      // Fallback: walk shadow DOM children for animations
      for (const child of Array.from(host.shadowRoot.children)) {
        if (child instanceof HTMLElement) {
          const el = child as unknown as { getAnimations?: () => Animation[] };
          if (typeof el.getAnimations === 'function') {
            allAnimations.push(...el.getAnimations());
          }
        }
      }
    }
  }

  if (allAnimations.length > 0) {
    await Promise.allSettled(allAnimations.map((a) => a.finished));
  }

  // Double rAF to ensure paint
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

/**
 * Copy all computed style properties from source to target element's inline style.
 */
function inlineComputedStyles(source: Element, target: HTMLElement) {
  const cs = getComputedStyle(source);
  for (let i = 0; i < cs.length; i++) {
    const prop = cs[i];
    target.style.setProperty(prop, cs.getPropertyValue(prop));
  }
}

/**
 * Deep-clone a DOM subtree and bake every element's computed style into
 * inline styles so the clone renders identically without needing
 * the original stylesheet or shadow-DOM scoping.
 */
function cloneWithInlineStyles(original: HTMLElement): HTMLElement {
  const clone = original.cloneNode(true) as HTMLElement;

  const origEls = [original, ...Array.from(original.querySelectorAll('*'))];
  const cloneEls = [clone, ...Array.from(clone.querySelectorAll('*'))] as HTMLElement[];

  for (let i = 0; i < origEls.length; i++) {
    inlineComputedStyles(origEls[i], cloneEls[i]);
    // Freeze animations so html-to-image sees a static snapshot
    cloneEls[i].style.setProperty('transition', 'none', 'important');
    cloneEls[i].style.setProperty('animation', 'none', 'important');
    // Preserve textarea/input values that cloneNode doesn't copy
    if (origEls[i] instanceof HTMLTextAreaElement) {
      (cloneEls[i] as HTMLTextAreaElement).textContent = (origEls[i] as HTMLTextAreaElement).value;
    } else if (origEls[i] instanceof HTMLInputElement) {
      (cloneEls[i] as HTMLInputElement).setAttribute('value', (origEls[i] as HTMLInputElement).value);
    }
  }

  return clone;
}

export async function captureScreenshot(opts?: { includeWidget?: boolean }): Promise<Blob | null> {
  const restores: (() => void)[] = [];
  const prevFocus = document.activeElement as HTMLElement | null;
  console.log('[pw] screenshot: starting capture');

  const overlay = document.createElement('div');
  overlay.style.cssText =
    `position:fixed;inset:0;z-index:2147483646;background:${getComputedStyle(document.documentElement).backgroundColor || '#fff'};pointer-events:none;`;
  document.body.appendChild(overlay);

  // Note: html-to-image ignores scrollLeft/scrollTop and renders at
  // scroll position 0. Previous attempts to compensate (transforms,
  // overflow changes, negative margins) all caused worse issues.
  // A future getDisplayMedia-based capture would fix this properly.

  // Clone each visible shadow-DOM child into the light DOM with all
  // computed styles inlined, so html-to-image can capture them.
  let widgetClone: HTMLElement | null = null;
  if (opts?.includeWidget) {
    const host = document.querySelector('prompt-widget-host');
    if (host?.shadowRoot) {
      await settleAnimations();

      widgetClone = document.createElement('div');
      widgetClone.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647;';

      for (const child of Array.from(host.shadowRoot.children)) {
        if (child.tagName === 'STYLE') continue;
        const el = child as HTMLElement;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;

        const rect = el.getBoundingClientRect();
        let w = rect.width;
        let h = rect.height;
        if (w === 0 || h === 0) {
          w = parseFloat(cs.width) || 0;
          h = parseFloat(cs.height) || 0;
          if (w === 0 && h === 0) continue;
        }

        const styled = cloneWithInlineStyles(el);
        styled.style.position = 'absolute';
        styled.style.left = rect.left + 'px';
        styled.style.top = rect.top + 'px';
        styled.style.width = w + 'px';
        styled.style.height = h + 'px';
        styled.style.bottom = 'auto';
        styled.style.right = 'auto';
        styled.style.margin = '0';
        widgetClone.appendChild(styled);
      }

      document.body.appendChild(widgetClone);
    }
  }

  try {
    console.log('[pw] screenshot: calling toBlob');
    const blob = await toBlob(document.documentElement, {
      cacheBust: true,
      pixelRatio: 1,
      width: window.innerWidth,
      height: window.innerHeight,
      style: {
        transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
      },
      filter: (node: HTMLElement) => {
        if (node === overlay) return false;
        if (node.tagName?.toLowerCase()?.startsWith('prompt-widget')) return false;
        return true;
      },
    });
    console.log('[pw] screenshot: toBlob returned', blob ? `${blob.size} bytes` : 'null');
    return blob;
  } catch (err) {
    console.error('[pw] screenshot: toBlob failed:', err);
    return null;
  } finally {
    for (const restore of restores) restore();
    overlay.remove();
    if (widgetClone) widgetClone.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch (_) {}
    }
    console.log('[pw] screenshot: cleanup done');
  }
}
