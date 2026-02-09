import type {
  WidgetConfig,
  WidgetMode,
  WidgetPosition,
  Collector,
  SubmitOptions,
  UserIdentity,
  FeedbackType,
} from '@prompt-widget/shared';
import {
  DEFAULT_POSITION,
  DEFAULT_MODE,
  DEFAULT_SHORTCUT,
  FEEDBACK_TYPES,
} from '@prompt-widget/shared';
import { WIDGET_CSS } from './styles.js';
import { installCollectors, collectContext } from './collectors.js';
import { captureScreenshot } from './screenshot.js';
import { SessionBridge } from './session.js';

type EventHandler = (data: unknown) => void;

export class PromptWidgetElement {
  private shadow: ShadowRoot;
  private host: HTMLElement;
  private config: WidgetConfig;
  private isOpen = false;
  private identity: UserIdentity | null = null;
  private pendingScreenshots: Blob[] = [];
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private sessionBridge: SessionBridge;

  constructor() {
    this.host = document.createElement('prompt-widget-host');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    document.body.appendChild(this.host);

    const script = document.querySelector('script[data-endpoint]') as HTMLScriptElement | null;
    this.config = {
      endpoint: script?.dataset.endpoint || '/api/v1/feedback',
      mode: (script?.dataset.mode as WidgetMode) || DEFAULT_MODE,
      position: (script?.dataset.position as WidgetPosition) || DEFAULT_POSITION,
      shortcut: script?.dataset.shortcut || DEFAULT_SHORTCUT,
      collectors: (script?.dataset.collectors?.split(',').filter(Boolean) as Collector[]) || [
        'console',
        'network',
        'performance',
        'environment',
      ],
    };

    installCollectors(this.config.collectors);
    this.render();
    this.bindShortcut();

    // Connect WebSocket session bridge for agent interaction
    this.sessionBridge = new SessionBridge(this.config.endpoint, this.getSessionId(), this.config.collectors);
    this.sessionBridge.connect();
  }

  private render() {
    const style = document.createElement('style');
    style.textContent = WIDGET_CSS;
    this.shadow.appendChild(style);

    if (this.config.mode !== 'hidden') {
      this.renderTrigger();
    }
  }

  private renderTrigger() {
    const btn = document.createElement('button');
    btn.className = `pw-trigger ${this.config.position}`;
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>`;
    btn.addEventListener('click', () => this.toggle());
    this.shadow.appendChild(btn);
  }

  private renderPanel() {
    const existing = this.shadow.querySelector('.pw-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = `pw-panel ${this.config.position}`;
    panel.innerHTML = `
      <div class="pw-header">
        <h3>Send Feedback</h3>
        <button class="pw-close">&times;</button>
      </div>
      <div class="pw-body">
        <div class="pw-field">
          <label>Type</label>
          <select id="pw-type">
            ${FEEDBACK_TYPES.map((t) => `<option value="${t}">${t.replace(/_/g, ' ')}</option>`).join('')}
          </select>
        </div>
        <div class="pw-field">
          <label>Title</label>
          <input type="text" id="pw-title" placeholder="Brief summary..." />
        </div>
        <div class="pw-field">
          <label>Description</label>
          <textarea id="pw-description" placeholder="Details, steps to reproduce, etc..."></textarea>
        </div>
        <div class="pw-field">
          <label>Screenshots</label>
          <div class="pw-actions">
            <button class="pw-btn" id="pw-capture-btn">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
              Capture
            </button>
            <button class="pw-btn" id="pw-paste-btn">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z"/></svg>
              Paste
            </button>
          </div>
          <div class="pw-screenshots" id="pw-screenshots"></div>
        </div>
        <div id="pw-error" class="pw-error pw-hidden"></div>
      </div>
      <div class="pw-footer">
        <button class="pw-submit" id="pw-submit-btn">Submit Feedback</button>
      </div>
    `;

    this.shadow.appendChild(panel);

    panel.querySelector('.pw-close')!.addEventListener('click', () => this.close());
    panel.querySelector('#pw-capture-btn')!.addEventListener('click', () => this.captureScreen());
    panel.querySelector('#pw-paste-btn')!.addEventListener('click', () => this.pasteFromClipboard());
    panel.querySelector('#pw-submit-btn')!.addEventListener('click', () => this.handleSubmit());

    // Paste via keyboard into panel
    panel.addEventListener('paste', (e: Event) => {
      const ce = e as ClipboardEvent;
      const items = ce.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) this.addScreenshot(blob);
        }
      }
    });
  }

  private renderSuccess() {
    const existing = this.shadow.querySelector('.pw-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = `pw-panel ${this.config.position}`;
    panel.innerHTML = `
      <div class="pw-header">
        <h3>Send Feedback</h3>
        <button class="pw-close">&times;</button>
      </div>
      <div class="pw-success">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        <p>Feedback submitted!</p>
      </div>
    `;
    this.shadow.appendChild(panel);
    panel.querySelector('.pw-close')!.addEventListener('click', () => this.close());

    setTimeout(() => this.close(), 2000);
  }

  private async captureScreen() {
    const btn = this.shadow.querySelector('#pw-capture-btn') as HTMLButtonElement;
    btn.textContent = 'Capturing...';
    btn.disabled = true;

    const blob = await captureScreenshot();
    if (blob) {
      this.addScreenshot(blob);
    }

    btn.innerHTML = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg> Capture`;
    btn.disabled = false;
  }

  private async pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          this.addScreenshot(blob);
        }
      }
    } catch {
      // Clipboard API not available or denied
    }
  }

  private addScreenshot(blob: Blob) {
    this.pendingScreenshots.push(blob);
    this.renderScreenshotThumbs();
  }

  private renderScreenshotThumbs() {
    const container = this.shadow.querySelector('#pw-screenshots');
    if (!container) return;
    container.innerHTML = '';
    this.pendingScreenshots.forEach((blob, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'pw-screenshot-wrap';

      const img = document.createElement('img');
      img.className = 'pw-screenshot-thumb';
      img.src = URL.createObjectURL(blob);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'pw-screenshot-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove screenshot';
      removeBtn.addEventListener('click', () => {
        this.pendingScreenshots.splice(i, 1);
        this.renderScreenshotThumbs();
      });

      wrap.appendChild(img);
      wrap.appendChild(removeBtn);
      container.appendChild(wrap);
    });
  }

  private async handleSubmit() {
    const title = (this.shadow.querySelector('#pw-title') as HTMLInputElement)?.value.trim();
    const description = (this.shadow.querySelector('#pw-description') as HTMLTextAreaElement)?.value.trim();
    const type = (this.shadow.querySelector('#pw-type') as HTMLSelectElement)?.value as FeedbackType;
    const errorEl = this.shadow.querySelector('#pw-error') as HTMLElement;
    const submitBtn = this.shadow.querySelector('#pw-submit-btn') as HTMLButtonElement;

    if (!title) {
      errorEl.textContent = 'Title is required';
      errorEl.classList.remove('pw-hidden');
      return;
    }

    errorEl.classList.add('pw-hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      await this.submitFeedback({ type, title, description });
      this.pendingScreenshots = [];
      this.emit('submit', { type, title, description });
      this.renderSuccess();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Submission failed';
      errorEl.classList.remove('pw-hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Feedback';
    }
  }

  private async submitFeedback(opts: { type: FeedbackType; title: string; description: string }) {
    const context = collectContext(this.config.collectors);

    const feedbackPayload = {
      type: opts.type,
      title: opts.title,
      description: opts.description,
      context,
      sourceUrl: location.href,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      sessionId: this.getSessionId(),
      userId: this.identity?.id,
    };

    if (this.pendingScreenshots.length > 0) {
      const formData = new FormData();
      formData.append('feedback', JSON.stringify(feedbackPayload));
      for (const blob of this.pendingScreenshots) {
        formData.append('screenshots', blob, `screenshot-${Date.now()}.png`);
      }

      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    } else {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedbackPayload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    }
  }

  private getSessionId(): string {
    let sid = sessionStorage.getItem('pw-session-id');
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('pw-session-id', sid);
    }
    return sid;
  }

  private bindShortcut() {
    const parts = this.config.shortcut.toLowerCase().split('+');
    document.addEventListener('keydown', (e) => {
      const ctrl = parts.includes('ctrl') ? e.ctrlKey || e.metaKey : true;
      const shift = parts.includes('shift') ? e.shiftKey : true;
      const alt = parts.includes('alt') ? e.altKey : true;
      const key = parts.find((p) => !['ctrl', 'shift', 'alt', 'meta'].includes(p));
      if (ctrl && shift && alt && key && e.key.toLowerCase() === key) {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  private emit(event: string, data: unknown) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) handler(data);
    }
  }

  // Public API
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.pendingScreenshots = [];
    this.renderPanel();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    const panel = this.shadow.querySelector('.pw-panel');
    if (panel) panel.remove();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  async submit(opts: SubmitOptions) {
    const context = collectContext(this.config.collectors);
    const screenshots: Blob[] = [];

    if (opts.screenshot) {
      const blob = await captureScreenshot();
      if (blob) screenshots.push(blob);
    }

    const payload = {
      type: opts.type || 'programmatic',
      title: opts.title || 'Programmatic submission',
      description: opts.description || '',
      data: opts.data,
      context,
      sourceUrl: location.href,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      sessionId: this.getSessionId(),
      userId: this.identity?.id,
      tags: opts.tags,
    };

    if (screenshots.length > 0) {
      const formData = new FormData();
      formData.append('feedback', JSON.stringify(payload));
      for (const blob of screenshots) {
        formData.append('screenshots', blob, `screenshot-${Date.now()}.png`);
      }
      const res = await fetch(this.config.endpoint, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      this.emit('submit', { ...opts, id: result.id });
      return result;
    } else {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      this.emit('submit', { ...opts, id: result.id });
      return result;
    }
  }

  identify(user: UserIdentity) {
    this.identity = user;
  }

  configure(opts: Partial<WidgetConfig>) {
    Object.assign(this.config, opts);
    if (opts.collectors) installCollectors(opts.collectors);
  }

  on(event: string, handler: EventHandler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  destroy() {
    this.close();
    this.sessionBridge.disconnect();
    this.host.remove();
  }
}
