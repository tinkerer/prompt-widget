import { toBlob } from 'html-to-image';

export async function captureScreenshot(): Promise<Blob | null> {
  try {
    const blob = await toBlob(document.documentElement, {
      cacheBust: true,
      pixelRatio: 1,
      width: window.innerWidth,
      height: window.innerHeight,
      style: {
        transform: `translateY(-${window.scrollY}px)`,
      },
      filter: (node: HTMLElement) => {
        return !node.tagName?.toLowerCase()?.startsWith('prompt-widget');
      },
    });
    return blob;
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    return null;
  }
}
