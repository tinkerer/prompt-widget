import { useEffect, useRef } from 'preact/hooks';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BACKOFF_CAP_MS = 30_000;

interface AgentTerminalProps {
  sessionId: string;
  isActive?: boolean;
  onExit?: (exitCode: number) => void;
}

export function AgentTerminal({ sessionId, isActive, onExit }: AgentTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cleanedUp = useRef(false);
  const hasExited = useRef(false);
  const safeFitAndResizeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!containerRef.current) return;
    cleanedUp.current = false;
    hasExited.current = false;

    const term = new Terminal({
      cursorBlink: true,
      rightClickSelectsWord: false,
      fontSize: 13,
      fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
      theme: {
        background: '#1e293b',
        foreground: '#e2e8f0',
        cursor: '#a5b4fc',
        selectionBackground: '#334155',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#64748b',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    // Only fit if container is visible (non-zero size); hidden tabs fit on activation
    if (containerRef.current.offsetWidth > 0) {
      fit.fit();
    }
    term.write('\x1b[90mConnecting...\x1b[0m');

    termRef.current = term;
    fitRef.current = fit;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    let reconnectAttempts = 0;
    let gotFirstOutput = false;
    let waitingDots: ReturnType<typeof setInterval> | null = null;

    // Sequenced protocol state
    let lastOutputSeq = 0;
    let inputSeq = 0;
    const pendingInputs = new Map<number, string>();

    // --- Mouse mode tracking & manual mousemove injection ---
    // xterm.js doesn't reliably send mousemove in DECSET 1003 (any-event mode)
    // when no button is held. We track the mode from terminal output and inject
    // SGR mouse sequences ourselves so tmux popup menus get hover highlights.
    let mouseMode = 0;   // 0=off, 9/1000/1002/1003
    let sgrEncoding = false; // DECSET 1006

    function trackMouseModes(data: string) {
      const re = /\x1b\[\?(\d+)([hl])/g;
      let m;
      while ((m = re.exec(data)) !== null) {
        const mode = parseInt(m[1], 10);
        const enable = m[2] === 'h';
        switch (mode) {
          case 9: case 1000: case 1002: case 1003:
            mouseMode = enable ? mode : 0;
            break;
          case 1006:
            sgrEncoding = enable;
            break;
        }
      }
    }

    function sendRawInput(data: string) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        inputSeq++;
        const msg = JSON.stringify({
          type: 'sequenced_input',
          sessionId,
          seq: inputSeq,
          content: { kind: 'input', data },
          timestamp: new Date().toISOString(),
        });
        pendingInputs.set(inputSeq, msg);
        ws.send(msg);
      }
    }

    function injectMouseEvent(e: MouseEvent, cb: number, press: boolean) {
      const screen = containerRef.current?.querySelector('.xterm-screen');
      if (!screen) return;
      const rect = screen.getBoundingClientRect();
      const col = Math.min(term.cols, Math.max(1, Math.floor((e.clientX - rect.left) / (rect.width / term.cols)) + 1));
      const row = Math.min(term.rows, Math.max(1, Math.floor((e.clientY - rect.top) / (rect.height / term.rows)) + 1));
      if (sgrEncoding) {
        sendRawInput(`\x1b[<${cb};${col};${row}${press ? 'M' : 'm'}`);
      } else {
        sendRawInput(`\x1b[M${String.fromCharCode(cb + 32, col + 32, row + 32)}`);
      }
    }

    let lastMoveCol = -1;
    let lastMoveRow = -1;

    function onMouseMove(e: MouseEvent) {
      if (mouseMode !== 1003) return;
      // Only inject no-button moves; xterm.js handles button-held moves via onData
      if (e.buttons !== 0) return;
      const screen = containerRef.current?.querySelector('.xterm-screen');
      if (!screen) return;
      const rect = screen.getBoundingClientRect();
      const col = Math.min(term.cols, Math.max(1, Math.floor((e.clientX - rect.left) / (rect.width / term.cols)) + 1));
      const row = Math.min(term.rows, Math.max(1, Math.floor((e.clientY - rect.top) / (rect.height / term.rows)) + 1));
      if (col === lastMoveCol && row === lastMoveRow) return;
      lastMoveCol = col;
      lastMoveRow = row;
      // cb=35: motion (32) + no button (3)
      injectMouseEvent(e, 35, true);
    }

    function onContextMenu(e: Event) {
      e.preventDefault();
    }

    const xtermScreen = containerRef.current.querySelector('.xterm-screen');
    if (xtermScreen) {
      xtermScreen.addEventListener('contextmenu', onContextMenu);
      xtermScreen.addEventListener('mousemove', onMouseMove as EventListener);
    }

    function sendOutputAck(seq: number) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output_ack', sessionId, ackSeq: seq }));
      }
    }

    function sendReplayRequest() {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && lastOutputSeq > 0) {
        ws.send(JSON.stringify({ type: 'replay_request', sessionId, fromSeq: lastOutputSeq }));
      }
    }

    function resendPendingInputs() {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      for (const [seq, serialized] of pendingInputs) {
        try { ws.send(serialized); } catch { break; }
      }
    }

    function handleOutput(data: string) {
      trackMouseModes(data);
      if (!gotFirstOutput) {
        gotFirstOutput = true;
        if (waitingDots) { clearInterval(waitingDots); waitingDots = null; }
        term.clear();
      }
      term.write(data);
    }

    function connect() {
      if (cleanedUp.current) return;

      const token = localStorage.getItem('pw-admin-token');
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/agent-session?sessionId=${sessionId}&token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay = 1000;
        reconnectAttempts = 0;
        sendReplayRequest();
        resendPendingInputs();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            // Sequenced protocol
            case 'sequenced_output': {
              const seq: number = msg.seq;
              if (seq <= lastOutputSeq) break; // dedup
              lastOutputSeq = seq;
              const content = msg.content;
              if (content.kind === 'output' && content.data) {
                handleOutput(content.data);
              } else if (content.kind === 'exit') {
                term.write(`\r\n\x1b[33m--- Session exited (code: ${content.exitCode ?? 'unknown'}) ---\x1b[0m\r\n`);
                hasExited.current = true;
                onExit?.(content.exitCode ?? -1);
              } else if (content.kind === 'error' && content.data) {
                term.write(`\r\n\x1b[31m${content.data}\x1b[0m\r\n`);
              }
              sendOutputAck(seq);
              break;
            }

            case 'input_ack': {
              pendingInputs.delete(msg.ackSeq);
              break;
            }

            // Legacy messages
            case 'history':
              // Resume input seq from server's last acknowledged seq
              if (typeof msg.lastInputAckSeq === 'number' && msg.lastInputAckSeq > inputSeq) {
                inputSeq = msg.lastInputAckSeq;
              }
              if (msg.data) {
                if (waitingDots) { clearInterval(waitingDots); waitingDots = null; }
                gotFirstOutput = true;
                term.clear();
                term.write(msg.data);
              } else if (!gotFirstOutput) {
                term.write('\r\x1b[2K\x1b[90mWaiting for agent to start (this can take 1-2 min)...\x1b[0m');
                let dots = 0;
                waitingDots = setInterval(() => {
                  if (gotFirstOutput || cleanedUp.current) { clearInterval(waitingDots!); waitingDots = null; return; }
                  dots = (dots + 1) % 4;
                  term.write('\r\x1b[2K\x1b[90mWaiting for agent to start' + '.'.repeat(dots + 1) + '\x1b[0m');
                }, 2000);
              }
              break;
            case 'output':
              handleOutput(msg.data);
              break;
            case 'exit':
              term.write(`\r\n\x1b[33m--- Session exited (code: ${msg.exitCode ?? 'unknown'}) ---\x1b[0m\r\n`);
              hasExited.current = true;
              onExit?.(msg.exitCode ?? -1);
              break;
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        wsRef.current = null;
        if (cleanedUp.current) return;

        if (event.code === 4003) {
          localStorage.removeItem('pw-admin-token');
          window.location.hash = '#/login';
          return;
        }

        if (hasExited.current || event.code === 4004 || event.code === 4001) {
          term.write(`\r\n\x1b[90m--- Disconnected (${event.reason || event.code}) ---\x1b[0m\r\n`);
          if (event.code === 4004) onExit?.(-1);
          return;
        }

        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          term.write('\r\n\x1b[31m--- Connection lost. Click terminal or press any key to retry. ---\x1b[0m\r\n');
          const retryHandler = term.onData(() => {
            retryHandler.dispose();
            reconnectAttempts = 0;
            reconnectDelay = 1000;
            term.write('\x1b[90mReconnecting...\x1b[0m\r\n');
            connect();
          });
          return;
        }

        term.write('\r\n\x1b[90m--- Disconnected, reconnecting... ---\x1b[0m\r\n');
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_BACKOFF_CAP_MS);
          connect();
        }, reconnectDelay);
      };
    }

    connect();

    // Terminal auto-response sequences (DA1, DA2, DSR cursor position report).
    // xterm.js generates these in response to queries from tmux/shell. On reconnect
    // they arrive after tmux has timed out, causing visible junk in the PTY input.
    // tmux infers capabilities from TERM=xterm-256color so these are unnecessary.
    const TERMINAL_RESPONSE_RE = /\x1b\[\?[\d;]*c|\x1b\[>[\d;]*c|\x1b\[\d+;\d+R/g;

    term.onData((data: string) => {
      const filtered = data.replace(TERMINAL_RESPONSE_RE, '');
      if (!filtered) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        inputSeq++;
        const msg = JSON.stringify({
          type: 'sequenced_input',
          sessionId,
          seq: inputSeq,
          content: { kind: 'input', data: filtered },
          timestamp: new Date().toISOString(),
        });
        pendingInputs.set(inputSeq, msg);
        ws.send(msg);
      }
    });

    function safeFitAndResize() {
      const el = containerRef.current;
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
      fit.fit();
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && term.cols > 0 && term.rows > 0) {
        inputSeq++;
        const msg = JSON.stringify({
          type: 'sequenced_input',
          sessionId,
          seq: inputSeq,
          content: { kind: 'resize', cols: term.cols, rows: term.rows },
          timestamp: new Date().toISOString(),
        });
        pendingInputs.set(inputSeq, msg);
        ws.send(msg);
      }
    }

    const observer = new ResizeObserver(() => safeFitAndResize());
    observer.observe(containerRef.current);

    return () => {
      cleanedUp.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (waitingDots) clearInterval(waitingDots);
      if (xtermScreen) {
        xtermScreen.removeEventListener('contextmenu', onContextMenu);
        xtermScreen.removeEventListener('mousemove', onMouseMove as EventListener);
      }
      observer.disconnect();
      wsRef.current?.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!isActive || !fitRef.current || !termRef.current || !containerRef.current) return;
    // Stagger fit attempts — layout may not settle immediately after tab switch
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const delay of [0, 50, 150, 300]) {
      timers.push(setTimeout(() => {
        if (!fitRef.current || !termRef.current || !containerRef.current) return;
        if (containerRef.current.offsetWidth === 0) return;
        fitRef.current.fit();
      }, delay));
    }
    // Focus after first paint
    timers.push(setTimeout(() => {
      termRef.current?.focus();
    }, 50));
    return () => timers.forEach(clearTimeout);
  }, [isActive]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} onClick={() => termRef.current?.focus()} />;
}
