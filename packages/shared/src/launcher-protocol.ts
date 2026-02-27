import type { SequencedOutput, SequencedInput, SessionInputData } from './protocol.js';
import type { PermissionProfile } from './types.js';

// --- Harness metadata ---

export interface HarnessMetadata {
  targetAppUrl: string;
  browserMcpUrl: string;
  composeProject?: string;
  appImage?: string;
  appPort?: number;
  serverPort?: number;
}

// --- Launcher → Server messages ---

export interface LauncherRegister {
  type: 'launcher_register';
  id: string;
  name: string;
  hostname: string;
  authToken: string;
  capabilities: LauncherCapabilities;
  harness?: HarnessMetadata;
}

export interface LauncherCapabilities {
  maxSessions: number;
  hasTmux: boolean;
  hasClaudeCli: boolean;
}

export interface LauncherHeartbeat {
  type: 'launcher_heartbeat';
  activeSessions: string[];
  systemLoad?: number;
  timestamp: string;
}

export interface LauncherSessionStarted {
  type: 'launcher_session_started';
  sessionId: string;
  pid: number;
  tmuxSessionName?: string;
}

export interface LauncherSessionOutput {
  type: 'launcher_session_output';
  sessionId: string;
  output: SequencedOutput;
}

export interface LauncherSessionEnded {
  type: 'launcher_session_ended';
  sessionId: string;
  exitCode: number;
  status: string;
  outputLog: string;
}

export type LauncherToServerMessage =
  | LauncherRegister
  | LauncherHeartbeat
  | LauncherSessionStarted
  | LauncherSessionOutput
  | LauncherSessionEnded;

// --- Server → Launcher messages ---

export interface LauncherRegistered {
  type: 'launcher_registered';
  ok: boolean;
  error?: string;
}

export interface LaunchSession {
  type: 'launch_session';
  sessionId: string;
  prompt: string;
  cwd: string;
  permissionProfile: PermissionProfile;
  allowedTools?: string | null;
  claudeSessionId?: string;
  resumeSessionId?: string;
  cols: number;
  rows: number;
}

export interface KillSessionRequest {
  type: 'kill_session';
  sessionId: string;
}

export interface ResizeSessionRequest {
  type: 'resize_session';
  sessionId: string;
  cols: number;
  rows: number;
}

export interface InputToSession {
  type: 'input_to_session';
  sessionId: string;
  input: SequencedInput | { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };
}

export type ServerToLauncherMessage =
  | LauncherRegistered
  | LaunchSession
  | KillSessionRequest
  | ResizeSessionRequest
  | InputToSession;

// --- Combined ---

export type LauncherMessage = LauncherToServerMessage | ServerToLauncherMessage;

// --- Constants ---

export const LAUNCHER_HEARTBEAT_INTERVAL_MS = 30_000;
export const LAUNCHER_STALE_TIMEOUT_MS = 90_000;
