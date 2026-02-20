import { toBlob } from 'html-to-image';

export async function captureScreenshot(opts?: { includeWidget?: boolean }): Promise<Blob | null> {
  // html-to-image clones the DOM, which resets scroll positions to 0.
  // Compensate by applying CSS transforms to scrolled inner containers.
  // An overlay masks the visual shift from the user during capture.
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
        if (!opts?.includeWidget && node.tagName?.toLowerCase()?.startsWith('prompt-widget')) return false;
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
  }
}
