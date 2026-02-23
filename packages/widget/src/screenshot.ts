export async function captureScreenshot(opts?: { excludeWidget?: boolean }): Promise<Blob | null> {
  const host = opts?.excludeWidget ? document.querySelector('prompt-widget-host') as HTMLElement | null : null;
  if (host) host.style.display = 'none';

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

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    track.stop();
    if (host) host.style.display = '';

    return new Promise(r => canvas.toBlob(b => r(b), 'image/png'));
  } catch (err) {
    if (host) host.style.display = '';
    console.error('[pw] screenshot: getDisplayMedia failed:', err);
    return null;
  }
}
