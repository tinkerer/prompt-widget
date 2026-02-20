import { collectContext, getEnvironment, getPerformanceTiming } from './collectors.js';
import { captureScreenshot } from './screenshot.js';
import {
  dispatchMouseMove, dispatchClickAt, dispatchHover, dispatchDrag,
  dispatchMouseDown, dispatchMouseUp, dispatchPressKey, dispatchKeyDown,
  dispatchKeyUp, dispatchTypeText,
} from './input-events.js';
import type { Collector } from '@prompt-widget/shared';

interface CommandMessage {
  type: 'command';
  requestId: string;
  command: string;
  params: Record<string, unknown>;
}

export class SessionBridge {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private endpoint: string;
  private collectors: Collector[];
  private apiKey: string | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;

  constructor(endpoint: string, sessionId: string, collectors: Collector[], apiKey?: string) {
    this.endpoint = endpoint;
    this.sessionId = sessionId;
    this.collectors = collectors;
    this.apiKey = apiKey;
  }

  connect() {
    let wsUrl = this.endpoint
      .replace(/^http/, 'ws')
      .replace(/\/api\/v1\/feedback$/, `/ws?sessionId=${encodeURIComponent(this.sessionId)}`);
    if (this.apiKey) {
      wsUrl += `&apiKey=${encodeURIComponent(this.apiKey)}`;
    }

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.sendMeta();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: CommandMessage = JSON.parse(event.data);
        if (msg.type === 'command') {
          this.handleCommand(msg);
        }
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30_000);
      this.connect();
    }, this.reconnectDelay);
  }

  private sendMeta() {
    this.send({
      type: 'meta',
      url: location.href,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    });
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private respond(requestId: string, data: unknown) {
    this.send({ type: 'response', requestId, data });
  }

  private respondError(requestId: string, error: string) {
    this.send({ type: 'response', requestId, error });
  }

  private async handleCommand(msg: CommandMessage) {
    const { requestId, command, params } = msg;

    try {
      switch (command) {
        case 'screenshot': {
          const blob = await captureScreenshot();
          if (!blob) {
            this.respondError(requestId, 'Screenshot capture failed');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            this.respond(requestId, {
              dataUrl: reader.result,
              mimeType: blob.type,
              size: blob.size,
            });
          };
          reader.readAsDataURL(blob);
          break;
        }

        case 'execute': {
          const expression = params.expression as string;
          // Run in an async IIFE so await works
          const fn = new Function('return (async () => { ' + expression + ' })()');
          const result = await fn();
          this.respond(requestId, {
            result: result !== undefined ? JSON.parse(JSON.stringify(result)) : undefined,
          });
          break;
        }

        case 'getConsole': {
          const ctx = collectContext(['console'] as Collector[]);
          this.respond(requestId, { logs: ctx.consoleLogs || [] });
          break;
        }

        case 'getNetwork': {
          const ctx = collectContext(['network'] as Collector[]);
          this.respond(requestId, { errors: ctx.networkErrors || [] });
          break;
        }

        case 'getEnvironment': {
          this.respond(requestId, getEnvironment());
          break;
        }

        case 'getPerformance': {
          this.respond(requestId, getPerformanceTiming());
          break;
        }

        case 'getDom': {
          const selector = (params.selector as string) || 'body';
          const el = document.querySelector(selector);
          if (!el) {
            this.respondError(requestId, `Element not found: ${selector}`);
            return;
          }
          this.respond(requestId, {
            html: el.outerHTML.slice(0, 50_000),
            text: el.textContent?.slice(0, 10_000) || '',
            tagName: el.tagName,
            childCount: el.children.length,
            attributes: getAttributes(el),
            accessibilityTree: buildA11yTree(el, 3),
          });
          break;
        }

        case 'navigate': {
          const url = params.url as string;
          window.location.href = url;
          this.respond(requestId, { navigated: true, url });
          break;
        }

        case 'click': {
          const selector = params.selector as string;
          const el = document.querySelector(selector) as HTMLElement | null;
          if (!el) {
            this.respondError(requestId, `Element not found: ${selector}`);
            return;
          }
          el.click();
          this.respond(requestId, {
            clicked: true,
            selector,
            tagName: el.tagName,
            text: el.textContent?.slice(0, 200) || '',
          });
          break;
        }

        case 'type': {
          const selector = params.selector as string | undefined;
          const text = params.text as string;
          let el: HTMLElement | null;
          if (selector) {
            el = document.querySelector(selector);
          } else {
            el = document.activeElement as HTMLElement;
          }
          if (!el || !('value' in el)) {
            this.respondError(requestId, selector ? `Element not found or not typeable: ${selector}` : 'No active element');
            return;
          }
          (el as HTMLInputElement).value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          this.respond(requestId, { typed: true, selector, length: text.length });
          break;
        }

        case 'moveMouse': {
          const result = dispatchMouseMove(params.x as number, params.y as number);
          this.respond(requestId, result);
          break;
        }

        case 'clickAt': {
          const result = dispatchClickAt(params.x as number, params.y as number, params.button as number | undefined);
          this.respond(requestId, result);
          break;
        }

        case 'hover': {
          const result = dispatchHover({
            selector: params.selector as string | undefined,
            x: params.x as number | undefined,
            y: params.y as number | undefined,
          });
          this.respond(requestId, result);
          break;
        }

        case 'drag': {
          const from = params.from as { x: number; y: number };
          const to = params.to as { x: number; y: number };
          const result = await dispatchDrag(from, to, params.steps as number | undefined, params.stepDelayMs as number | undefined);
          this.respond(requestId, result);
          break;
        }

        case 'mouseDown': {
          const result = dispatchMouseDown(params.x as number, params.y as number, params.button as number | undefined);
          this.respond(requestId, result);
          break;
        }

        case 'mouseUp': {
          const result = dispatchMouseUp(params.x as number, params.y as number, params.button as number | undefined);
          this.respond(requestId, result);
          break;
        }

        case 'pressKey': {
          const result = dispatchPressKey(params.key as string, params.modifiers as any);
          this.respond(requestId, result);
          break;
        }

        case 'keyDown': {
          const result = dispatchKeyDown(params.key as string, params.modifiers as any);
          this.respond(requestId, result);
          break;
        }

        case 'keyUp': {
          const result = dispatchKeyUp(params.key as string, params.modifiers as any);
          this.respond(requestId, result);
          break;
        }

        case 'typeText': {
          const result = await dispatchTypeText(params.text as string, params.selector as string | undefined, params.charDelayMs as number | undefined);
          this.respond(requestId, result);
          break;
        }

        default:
          this.respondError(requestId, `Unknown command: ${command}`);
      }
    } catch (err) {
      this.respondError(requestId, err instanceof Error ? err.message : 'Command failed');
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000, 'destroyed');
    this.ws = null;
  }
}

function getAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of el.attributes) {
    attrs[attr.name] = attr.value;
  }
  return attrs;
}

interface A11yNode {
  role: string;
  name: string;
  tag: string;
  children?: A11yNode[];
}

function buildA11yTree(el: Element, maxDepth: number): A11yNode {
  const role = el.getAttribute('role') || inferRole(el);
  const name =
    el.getAttribute('aria-label') ||
    el.getAttribute('alt') ||
    el.getAttribute('title') ||
    (el.tagName === 'INPUT' ? (el as HTMLInputElement).placeholder : '') ||
    el.textContent?.trim().slice(0, 80) ||
    '';

  const node: A11yNode = { role, name, tag: el.tagName.toLowerCase() };

  if (maxDepth > 0 && el.children.length > 0) {
    node.children = [];
    for (const child of el.children) {
      node.children.push(buildA11yTree(child, maxDepth - 1));
    }
  }

  return node;
}

function inferRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const roleMap: Record<string, string> = {
    a: 'link',
    button: 'button',
    input: 'textbox',
    textarea: 'textbox',
    select: 'combobox',
    img: 'img',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    form: 'form',
    table: 'table',
    ul: 'list',
    ol: 'list',
    li: 'listitem',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
  };
  return roleMap[tag] || 'generic';
}
