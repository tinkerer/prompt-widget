import { signal } from '@preact/signals';
import { useRef, useEffect, useCallback } from 'preact/hooks';
import { api } from '../lib/api.js';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode = 'none' | 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se';

const HANDLE_SIZE = 8;
const MIN_CROP = 10;

function hitTest(mx: number, my: number, r: CropRect): DragMode {
  const hs = HANDLE_SIZE;
  if (Math.abs(mx - r.x) < hs && Math.abs(my - r.y) < hs) return 'nw';
  if (Math.abs(mx - (r.x + r.w)) < hs && Math.abs(my - r.y) < hs) return 'ne';
  if (Math.abs(mx - r.x) < hs && Math.abs(my - (r.y + r.h)) < hs) return 'sw';
  if (Math.abs(mx - (r.x + r.w)) < hs && Math.abs(my - (r.y + r.h)) < hs) return 'se';
  if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return 'move';
  return 'none';
}

function getCursor(mode: DragMode): string {
  switch (mode) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'move': return 'move';
    default: return 'crosshair';
  }
}

interface Props {
  src: string;
  imageId: string;
  feedbackId: string;
  onClose: () => void;
  onSaved: (mode: 'replace' | 'new', newScreenshot?: { id: string; filename: string }) => void;
}

export function CropEditor({ src, imageId, feedbackId, onClose, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayImgRef = useRef<HTMLImageElement>(null);
  const naturalImg = useRef<HTMLImageElement | null>(null);
  const cropRef = useRef<CropRect | null>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; origRect: CropRect }>({ mode: 'none', startX: 0, startY: 0, origRect: { x: 0, y: 0, w: 0, h: 0 } });
  const saving = signal(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const r = cropRef.current;
    if (r && r.w > 0 && r.h > 0) {
      ctx.clearRect(r.x, r.y, r.w, r.h);

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      ctx.fillStyle = '#fff';
      const hs = HANDLE_SIZE;
      const corners = [
        [r.x, r.y], [r.x + r.w, r.y],
        [r.x, r.y + r.h], [r.x + r.w, r.y + r.h],
      ];
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      }
    }
  }, []);

  // Load a separate Image for natural dimensions (used during crop execution)
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    naturalImg.current = img;
  }, [src]);

  // Sync canvas pixel dimensions to the displayed <img> element size
  function syncCanvasSize() {
    const el = displayImgRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    canvas.width = el.clientWidth;
    canvas.height = el.clientHeight;
    draw();
  }

  function getPos(e: MouseEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function clampRect(r: CropRect): CropRect {
    const canvas = canvasRef.current!;
    let { x, y, w, h } = r;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > canvas.width) w = canvas.width - x;
    if (y + h > canvas.height) h = canvas.height - y;
    return { x, y, w, h };
  }

  function onMouseDown(e: MouseEvent) {
    const pos = getPos(e);
    const cr = cropRef.current;
    if (cr) {
      const mode = hitTest(pos.x, pos.y, cr);
      if (mode !== 'none') {
        dragRef.current = { mode, startX: pos.x, startY: pos.y, origRect: { ...cr } };
        return;
      }
    }
    cropRef.current = { x: pos.x, y: pos.y, w: 0, h: 0 };
    dragRef.current = { mode: 'draw', startX: pos.x, startY: pos.y, origRect: { x: pos.x, y: pos.y, w: 0, h: 0 } };
  }

  function onMouseMove(e: MouseEvent) {
    const pos = getPos(e);
    const d = dragRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (d.mode === 'none') {
      const cr = cropRef.current;
      canvas.style.cursor = cr ? getCursor(hitTest(pos.x, pos.y, cr)) : 'crosshair';
      return;
    }

    const dx = pos.x - d.startX;
    const dy = pos.y - d.startY;
    const o = d.origRect;

    if (d.mode === 'draw') {
      const x = Math.min(d.startX, pos.x);
      const y = Math.min(d.startY, pos.y);
      const w = Math.abs(pos.x - d.startX);
      const h = Math.abs(pos.y - d.startY);
      cropRef.current = clampRect({ x, y, w, h });
    } else if (d.mode === 'move') {
      let nx = o.x + dx;
      let ny = o.y + dy;
      if (nx < 0) nx = 0;
      if (ny < 0) ny = 0;
      if (nx + o.w > canvas.width) nx = canvas.width - o.w;
      if (ny + o.h > canvas.height) ny = canvas.height - o.h;
      cropRef.current = { x: nx, y: ny, w: o.w, h: o.h };
    } else {
      let { x, y, w, h } = o;
      if (d.mode === 'se') { w += dx; h += dy; }
      else if (d.mode === 'nw') { x += dx; y += dy; w -= dx; h -= dy; }
      else if (d.mode === 'ne') { w += dx; y += dy; h -= dy; }
      else if (d.mode === 'sw') { x += dx; w -= dx; h += dy; }
      if (w < MIN_CROP) w = MIN_CROP;
      if (h < MIN_CROP) h = MIN_CROP;
      cropRef.current = clampRect({ x, y, w, h });
    }
    draw();
  }

  function onMouseUp() {
    dragRef.current = { mode: 'none', startX: 0, startY: 0, origRect: { x: 0, y: 0, w: 0, h: 0 } };
  }

  async function executeCrop(mode: 'replace' | 'new') {
    const r = cropRef.current;
    const img = naturalImg.current;
    const canvas = canvasRef.current;
    if (!r || !img || !canvas || r.w < MIN_CROP || r.h < MIN_CROP) return;
    if (!img.naturalWidth) return;

    saving.value = true;
    try {
      const sx = img.naturalWidth / canvas.width;
      const sy = img.naturalHeight / canvas.height;
      const nx = Math.round(r.x * sx);
      const ny = Math.round(r.y * sy);
      const nw = Math.round(r.w * sx);
      const nh = Math.round(r.h * sy);

      const offscreen = document.createElement('canvas');
      offscreen.width = nw;
      offscreen.height = nh;
      const octx = offscreen.getContext('2d')!;
      octx.drawImage(img, nx, ny, nw, nh, 0, 0, nw, nh);

      const blob = await new Promise<Blob>((resolve, reject) => {
        offscreen.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
      });

      if (mode === 'replace') {
        await api.replaceImage(imageId, blob);
        onSaved('replace');
      } else {
        const result = await api.saveImageAsNew(feedbackId, blob);
        onSaved('new', { id: result.id, filename: result.filename });
      }
    } catch (err: any) {
      alert('Crop failed: ' + err.message);
    } finally {
      saving.value = false;
    }
  }

  return (
    <div class="crop-editor">
      <div class="crop-canvas-wrap">
        <img
          ref={displayImgRef}
          src={src}
          alt="Crop source"
          crossOrigin="anonymous"
          onLoad={syncCanvasSize}
          style="display:block;max-width:90vw;max-height:calc(100vh - 120px);object-fit:contain"
        />
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown as any}
          onMouseMove={onMouseMove as any}
          onMouseUp={onMouseUp}
        />
      </div>
      <div class="crop-toolbar">
        <button class="btn" onClick={onClose} disabled={saving.value}>Cancel</button>
        <button class="btn btn-primary" onClick={() => executeCrop('replace')} disabled={saving.value || !cropRef.current}>
          {saving.value ? 'Saving...' : 'Apply (Overwrite)'}
        </button>
        <button class="btn" onClick={() => executeCrop('new')} disabled={saving.value || !cropRef.current}>
          {saving.value ? 'Saving...' : 'Save as New'}
        </button>
      </div>
    </div>
  );
}
