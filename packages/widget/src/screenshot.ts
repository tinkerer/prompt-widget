import { toBlob } from 'html-to-image';

export async function captureScreenshot(): Promise<Blob | null> {
  try {
    const blob = await toBlob(document.body, {
      cacheBust: true,
      pixelRatio: 1,
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
