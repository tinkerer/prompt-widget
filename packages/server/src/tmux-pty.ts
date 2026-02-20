import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as pty from 'node-pty';

const TMUX_PREFIX = 'pw-';
const PW_TMUX_CONF = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tmux-pw.conf');

let tmuxAvailable: boolean | null = null;

export function isTmuxAvailable(): boolean {
  if (tmuxAvailable !== null) return tmuxAvailable;
  try {
    execSync('tmux -V', { stdio: 'pipe' });
    tmuxAvailable = true;
  } catch {
    tmuxAvailable = false;
  }
  return tmuxAvailable;
}

function tmuxName(sessionId: string): string {
  return `${TMUX_PREFIX}${sessionId}`;
}

const TMUX_SOCKET = ['-L', 'prompt-widget'];

export function tmuxSessionExists(sessionId: string): boolean {
  const name = tmuxName(sessionId);
  const r = spawnSync('tmux', [...TMUX_SOCKET, 'has-session', '-t', name], { stdio: 'pipe' });
  return r.status === 0;
}

export function spawnInTmux(params: {
  sessionId: string;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}): { ptyProcess: pty.IPty; tmuxSessionName: string } {
  const { sessionId, command, args, cwd, cols, rows, env } = params;
  const name = tmuxName(sessionId);

  const shellCmd = [command, ...args].map(a => {
    if (a.includes("'") || a.includes(' ') || a.includes('"') || a.includes('\\') || a.includes('$')) {
      return `'${a.replace(/'/g, "'\\''")}'`;
    }
    return a;
  }).join(' ');

  execFileSync('tmux', [
    ...TMUX_SOCKET,
    '-f', PW_TMUX_CONF,
    'new-session', '-d',
    '-s', name,
    '-x', String(cols),
    '-y', String(rows),
    '-c', cwd,
    shellCmd,
  ], {
    stdio: 'pipe',
    env: { ...process.env, ...env, TERM: 'xterm-256color' },
  });

  const ptyProcess = pty.spawn('tmux', [...TMUX_SOCKET, 'attach-session', '-t', name], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, ...env, TERM: 'xterm-256color' } as Record<string, string>,
  });

  return { ptyProcess, tmuxSessionName: name };
}

export function reattachTmux(params: {
  sessionId: string;
  cols: number;
  rows: number;
}): pty.IPty {
  const { sessionId, cols, rows } = params;
  const name = tmuxName(sessionId);

  if (!tmuxSessionExists(sessionId)) {
    throw new Error(`tmux session ${name} does not exist`);
  }

  return pty.spawn('tmux', [...TMUX_SOCKET, 'attach-session', '-t', name], {
    name: 'xterm-256color',
    cols,
    rows,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });
}

export function killTmuxSession(sessionId: string): boolean {
  const name = tmuxName(sessionId);
  const r = spawnSync('tmux', [...TMUX_SOCKET, 'kill-session', '-t', name], { stdio: 'pipe' });
  return r.status === 0;
}

export function captureTmuxPane(sessionId: string): string {
  const name = tmuxName(sessionId);
  try {
    const output = execFileSync('tmux', [
      ...TMUX_SOCKET, 'capture-pane', '-t', name, '-p', '-S', '-',
    ], { stdio: 'pipe', encoding: 'utf-8' });
    return output;
  } catch {
    return '';
  }
}

export function listPwTmuxSessions(): string[] {
  try {
    const output = execFileSync('tmux', [
      ...TMUX_SOCKET, 'list-sessions', '-F', '#{session_name}',
    ], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output
      .split('\n')
      .filter(s => s.startsWith(TMUX_PREFIX))
      .map(s => s.slice(TMUX_PREFIX.length));
  } catch {
    return [];
  }
}

export function detachTmuxClients(sessionId: string): void {
  const name = tmuxName(sessionId);
  spawnSync('tmux', [...TMUX_SOCKET, 'detach-client', '-s', name], { stdio: 'pipe' });
}
