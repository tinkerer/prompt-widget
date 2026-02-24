let persistentStream: MediaStream | null = null;
let persistentVideo: HTMLVideoElement | null = null;

const CHROME_INDICATOR_DELAY_SEC = 3;

function isStreamAlive(): boolean {
  if (!persistentStream) return false;
  const track = persistentStream.getVideoTracks()[0];
  return !!track && track.readyState === 'live';
}

function countdownDelay(seconds: number, onTick?: (remaining: number) => void): Promise<void> {
  return new Promise(resolve => {
    let remaining = seconds;
    onTick?.(remaining);
    const iv = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(iv);
        resolve();
      } else {
        onTick?.(remaining);
      }
    }, 1000);
  });
}

async function ensureStream(onStatus?: (msg: string) => void): Promise<{ stream: MediaStream; video: HTMLVideoElement }> {
  if (isStreamAlive() && persistentVideo) {
    return { stream: persistentStream!, video: persistentVideo };
  }

  persistentStream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    preferCurrentTab: true,
  } as any);

  persistentStream.getVideoTracks()[0].addEventListener('ended', () => {
    persistentStream = null;
    persistentVideo = null;
  });

  const video = document.createElement('video');
  video.srcObject = persistentStream;
  video.autoplay = true;
  await new Promise<void>(r => { video.onloadeddata = () => r(); });

  await countdownDelay(CHROME_INDICATOR_DELAY_SEC, n => onStatus?.(`${n}…`));
  persistentVideo = video;

  return { stream: persistentStream, video };
}

export interface CaptureOptions {
  excludeWidget?: boolean;
  excludeCursor?: boolean;
  keepStream?: boolean;
  onStatus?: (msg: string) => void;
}

async function captureOneShot(opts?: CaptureOptions): Promise<Blob | null> {
  const host = opts?.excludeWidget ? document.querySelector('prompt-widget-host') as HTMLElement | null : null;
  if (host) host.style.display = 'none';

  const cursor = opts?.excludeCursor ? document.getElementById('__pw-virtual-cursor') : null;
  const prevCursorDisplay = cursor?.style.display;
  if (cursor) cursor.style.display = 'none';

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      preferCurrentTab: true,
    } as any);

    const track = stream.getVideoTracks()[0];
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    await new Promise<void>(r => { video.onloadeddata = () => r(); });

    await countdownDelay(CHROME_INDICATOR_DELAY_SEC, n => opts?.onStatus?.(`${n}…`));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    track.stop();
    if (host) host.style.display = '';
    if (cursor) cursor.style.display = prevCursorDisplay ?? '';

    return new Promise(r => canvas.toBlob(b => r(b), 'image/png'));
  } catch (err) {
    if (host) host.style.display = '';
    if (cursor) cursor.style.display = prevCursorDisplay ?? '';
    console.error('[pw] screenshot: getDisplayMedia failed:', err);
    return null;
  }
}

export async function captureScreenshot(opts?: CaptureOptions): Promise<Blob | null> {
  if (!opts?.keepStream) {
    return captureOneShot(opts);
  }

  const host = opts?.excludeWidget ? document.querySelector('prompt-widget-host') as HTMLElement | null : null;
  if (host) host.style.display = 'none';

  const cursor = opts?.excludeCursor ? document.getElementById('__pw-virtual-cursor') : null;
  const prevCursorDisplay = cursor?.style.display;
  if (cursor) cursor.style.display = 'none';

  try {
    const { video } = await ensureStream(opts?.onStatus);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    if (host) host.style.display = '';
    if (cursor) cursor.style.display = prevCursorDisplay ?? '';

    return new Promise(r => canvas.toBlob(b => r(b), 'image/png'));
  } catch (err) {
    if (host) host.style.display = '';
    if (cursor) cursor.style.display = prevCursorDisplay ?? '';
    console.error('[pw] screenshot: getDisplayMedia failed:', err);
    return null;
  }
}

export function stopScreencastStream() {
  if (persistentStream) {
    persistentStream.getTracks().forEach(t => t.stop());
    persistentStream = null;
    persistentVideo = null;
  }
}
