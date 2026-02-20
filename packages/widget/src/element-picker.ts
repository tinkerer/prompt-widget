export interface SelectedElementInfo {
  selector: string;
  tagName: string;
  id: string;
  classes: string[];
  textContent: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
}

const CAPTURE_ATTRS = [
  'src', 'href', 'alt', 'placeholder', 'type', 'role',
  'aria-label', 'name', 'data-testid', 'title',
];

function generateSelector(el: Element): string {
  const segments: string[] = [];
  let current: Element | null = el;

  for (let depth = 0; current && depth < 5; depth++) {
    if (current.id) {
      segments.unshift(`#${current.id}`);
      const candidate = segments.join(' > ');
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    }

    let seg = current.tagName.toLowerCase();
    const classList = Array.from(current.classList).filter(c => !c.startsWith('pw-'));
    if (classList.length > 0) {
      seg += '.' + classList.join('.');
    }

    const parent: Element | null = current.parentElement;
    if (parent) {
      const tag = current.tagName;
      const siblings = Array.from(parent.children).filter(
        (c: Element) => c.tagName === tag
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        seg += `:nth-of-type(${idx})`;
      }
    }

    segments.unshift(seg);
    const candidate = segments.join(' > ');
    if (document.querySelectorAll(candidate).length === 1) return candidate;

    current = parent;
  }

  return segments.join(' > ');
}

function captureElementInfo(el: Element): SelectedElementInfo {
  const rect = el.getBoundingClientRect();
  const attrs: Record<string, string> = {};
  for (const name of CAPTURE_ATTRS) {
    const val = el.getAttribute(name);
    if (val !== null) attrs[name] = val;
  }

  return {
    selector: generateSelector(el),
    tagName: el.tagName.toLowerCase(),
    id: el.id,
    classes: Array.from(el.classList),
    textContent: (el.textContent || '').trim().slice(0, 200),
    boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    attributes: attrs,
  };
}

export function startPicker(
  callback: (info: SelectedElementInfo | null) => void,
  excludeHost: Element,
): () => void {
  const highlight = document.createElement('div');
  Object.assign(highlight.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483646',
    border: '2px solid #6366f1',
    background: 'rgba(99, 102, 241, 0.08)',
    borderRadius: '3px',
    transition: 'top 0.05s, left 0.05s, width 0.05s, height 0.05s',
    display: 'none',
  });

  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483646',
    background: '#312e81',
    color: '#e0e7ff',
    fontSize: '11px',
    fontFamily: 'monospace',
    padding: '2px 6px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    maxWidth: '300px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'none',
  });

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed',
    bottom: '0',
    left: '0',
    right: '0',
    zIndex: '2147483646',
    background: '#1e1b4b',
    color: '#c7d2fe',
    fontSize: '13px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    textAlign: 'center',
    padding: '8px',
    pointerEvents: 'none',
  });
  bar.textContent = 'Click to select \u00b7 Esc to cancel';

  document.body.appendChild(highlight);
  document.body.appendChild(label);
  document.body.appendChild(bar);

  let lastTarget: Element | null = null;

  function isPickerOrWidget(el: Element | null): boolean {
    while (el) {
      if (el === highlight || el === label || el === bar || el === excludeHost) return true;
      el = el.parentElement;
    }
    return false;
  }

  function onMouseMove(e: MouseEvent) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isPickerOrWidget(el)) {
      highlight.style.display = 'none';
      label.style.display = 'none';
      lastTarget = null;
      return;
    }
    lastTarget = el;
    const rect = el.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.top = rect.top + 'px';
    highlight.style.left = rect.left + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';

    let labelText = el.tagName.toLowerCase();
    if (el.id) labelText += '#' + el.id;
    const cls = Array.from(el.classList).filter(c => !c.startsWith('pw-')).slice(0, 3);
    if (cls.length) labelText += '.' + cls.join('.');
    label.textContent = labelText;
    label.style.display = 'block';
    label.style.top = Math.max(0, rect.top - 22) + 'px';
    label.style.left = rect.left + 'px';
  }

  function onClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (lastTarget) {
      callback(captureElementInfo(lastTarget));
    } else {
      callback(null);
    }
    cleanup();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      callback(null);
      cleanup();
    }
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    highlight.remove();
    label.remove();
    bar.remove();
  }

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  return cleanup;
}
