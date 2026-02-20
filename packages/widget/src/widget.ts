import type {
  WidgetConfig,
  WidgetMode,
  WidgetPosition,
  Collector,
  SubmitOptions,
  UserIdentity,
} from '@prompt-widget/shared';
import {
  DEFAULT_POSITION,
  DEFAULT_MODE,
  DEFAULT_SHORTCUT,
} from '@prompt-widget/shared';
import { WIDGET_CSS } from './styles.js';
import { installCollectors, collectContext } from './collectors.js';
import { captureScreenshot } from './screenshot.js';
import { SessionBridge } from './session.js';

type EventHandler = (data: unknown) => void;

const HISTORY_KEY = 'pw-history';
const MAX_HISTORY = 50;

export class PromptWidgetElement {
  private shadow: ShadowRoot;
  private host: HTMLElement;
  private config: WidgetConfig;
  private isOpen = false;
  private identity: UserIdentity | null = null;
  private pendingScreenshots: Blob[] = [];
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private sessionBridge: SessionBridge;
  private history: string[] = [];
  private historyIndex = -1;
  private currentDraft = '';

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
      appKey: script?.dataset.appKey || undefined,
    };

    this.loadHistory();
    installCollectors(this.config.collectors);
    this.render();
    this.bindShortcut();

    this.sessionBridge = new SessionBridge(this.config.endpoint, this.getSessionId(), this.config.collectors, this.config.appKey);
    this.sessionBridge.connect();
  }

  private loadHistory() {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) this.history = JSON.parse(stored);
    } catch { /* ignore */ }
  }

  private saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history.slice(-MAX_HISTORY)));
    } catch { /* ignore */ }
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
    panel.style.position = 'fixed';
    panel.innerHTML = `
      <button class="pw-close">&times;</button>
      <div class="pw-screenshots pw-hidden" id="pw-screenshots"></div>
      <div class="pw-input-area">
        <textarea class="pw-textarea" id="pw-chat-input" placeholder="What's on your mind?" rows="3" autocomplete="off"></textarea>
        <div class="pw-context-options">
          <label class="pw-check"><input type="checkbox" value="console" checked /><span>Console</span></label>
          <label class="pw-check"><input type="checkbox" value="environment" checked /><span>Page info</span></label>
          <label class="pw-check"><input type="checkbox" value="network" checked /><span>Network</span></label>
          <label class="pw-check"><input type="checkbox" value="performance" checked /><span>Perf</span></label>
        </div>
        <div class="pw-toolbar">
          <button class="pw-camera-btn" id="pw-capture-btn" title="Capture screenshot">
            <svg viewBox="0 0 24 24"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/><path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>
          </button>
          <button class="pw-send-btn" id="pw-send-btn" title="Send feedback">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
      <div id="pw-error" class="pw-error pw-hidden"></div>
    `;

    this.shadow.appendChild(panel);

    const input = panel.querySelector('#pw-chat-input') as HTMLTextAreaElement;
    const closeBtn = panel.querySelector('.pw-close') as HTMLButtonElement;
    const captureBtn = panel.querySelector('#pw-capture-btn') as HTMLButtonElement;
    const sendBtn = panel.querySelector('#pw-send-btn') as HTMLButtonElement;

    closeBtn.addEventListener('click', () => this.close());
    captureBtn.addEventListener('click', () => this.captureScreen());
    sendBtn.addEventListener('click', () => this.handleSubmit());

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSubmit();
      } else if (e.key === 'ArrowUp' && input.value === '') {
        e.preventDefault();
        if (this.history.length === 0) return;
        if (this.historyIndex === -1) {
          this.currentDraft = input.value;
          this.historyIndex = this.history.length - 1;
        } else if (this.historyIndex > 0) {
          this.historyIndex--;
        }
        input.value = this.history[this.historyIndex];
      } else if (e.key === 'ArrowDown' && input.value === '') {
        e.preventDefault();
        if (this.historyIndex === -1) return;
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++;
          input.value = this.history[this.historyIndex];
        } else {
          this.historyIndex = -1;
          input.value = this.currentDraft;
        }
      }
    });

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

    setTimeout(() => input.focus(), 50);
  }

  private async captureScreen() {
    const btn = this.shadow.querySelector('#pw-capture-btn') as HTMLButtonElement;
    btn.disabled = true;

    const blob = await captureScreenshot();
    if (blob) {
      this.addScreenshot(blob);
    }

    btn.disabled = false;
  }

  private addScreenshot(blob: Blob) {
    this.pendingScreenshots.push(blob);
    this.renderScreenshotThumbs();
  }

  private renderScreenshotThumbs() {
    const container = this.shadow.querySelector('#pw-screenshots');
    if (!container) return;
    container.innerHTML = '';

    if (this.pendingScreenshots.length === 0) {
      container.classList.add('pw-hidden');
      return;
    }

    container.classList.remove('pw-hidden');
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

  private getCheckedCollectors(): Collector[] {
    const checkboxes = this.shadow.querySelectorAll('.pw-context-options input[type="checkbox"]:checked');
    return Array.from(checkboxes).map((cb) => (cb as HTMLInputElement).value as Collector);
  }

  private async handleSubmit() {
    const input = this.shadow.querySelector('#pw-chat-input') as HTMLTextAreaElement;
    const errorEl = this.shadow.querySelector('#pw-error') as HTMLElement;
    const description = input.value.trim();

    if (!description && this.pendingScreenshots.length === 0) {
      return;
    }

    errorEl.classList.add('pw-hidden');
    input.disabled = true;

    try {
      await this.submitFeedback({ type: 'manual', title: '', description }, this.getCheckedCollectors());

      if (description) {
        this.history.push(description);
        this.saveHistory();
      }
      this.historyIndex = -1;
      this.currentDraft = '';
      this.pendingScreenshots = [];

      this.emit('submit', { type: 'manual', title: '', description });
      this.showFlash();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Submission failed';
      errorEl.classList.remove('pw-hidden');
      input.disabled = false;
      input.focus();
    }
  }

  private showFlash() {
    const panel = this.shadow.querySelector('.pw-panel');
    if (!panel) return;

    const flash = document.createElement('div');
    flash.className = 'pw-flash';
    flash.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
    panel.appendChild(flash);

    setTimeout(() => this.close(), 1000);
  }

  private async submitFeedback(opts: { type: string; title: string; description: string }, collectors?: Collector[]) {
    const context = collectContext(collectors ?? this.config.collectors);

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
    this.historyIndex = -1;
    this.currentDraft = '';
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
      title: opts.title || '',
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
