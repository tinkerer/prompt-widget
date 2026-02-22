import { toBlob } from 'html-to-image';

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

  const overlay = document.createElement('div');
  overlay.style.cssText =
    `position:fixed;inset:0;z-index:2147483646;background:${getComputedStyle(document.documentElement).backgroundColor || '#fff'};`;
  document.body.appendChild(overlay);

  document.body.querySelectorAll('*').forEach((el) => {
    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      const htmlEl = el as HTMLElement;
      const prev = htmlEl.style.transform;
      const offset = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
      htmlEl.style.transform = prev ? `${prev} ${offset}` : offset;
      restores.push(() => { htmlEl.style.transform = prev; });
    }
  });

  // Clone each visible shadow-DOM child into the light DOM with all
  // computed styles inlined, so html-to-image can capture them.
  let widgetClone: HTMLElement | null = null;
  if (opts?.includeWidget) {
    const host = document.querySelector('prompt-widget-host');
    if (host?.shadowRoot) {
      widgetClone = document.createElement('div');
      widgetClone.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647;';

      for (const child of Array.from(host.shadowRoot.children)) {
        if (child.tagName === 'STYLE') continue;
        const el = child as HTMLElement;
        if (getComputedStyle(el).display === 'none') continue;

        const rect = el.getBoundingClientRect();
        const styled = cloneWithInlineStyles(el);
        styled.style.position = 'absolute';
        styled.style.left = rect.left + 'px';
        styled.style.top = rect.top + 'px';
        styled.style.width = rect.width + 'px';
        styled.style.height = rect.height + 'px';
        styled.style.bottom = 'auto';
        styled.style.right = 'auto';
        styled.style.margin = '0';
        widgetClone.appendChild(styled);
      }

      document.body.appendChild(widgetClone);
    }
  }

  try {
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
    return blob;
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    return null;
  } finally {
    for (const restore of restores) restore();
    overlay.remove();
    if (widgetClone) widgetClone.remove();
  }
}
