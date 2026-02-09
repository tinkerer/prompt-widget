import type {
  FEEDBACK_TYPES,
  FEEDBACK_STATUSES,
  WIDGET_MODES,
  WIDGET_POSITIONS,
  COLLECTORS,
} from './constants.js';

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type WidgetMode = (typeof WIDGET_MODES)[number];
export type WidgetPosition = (typeof WIDGET_POSITIONS)[number];
export type Collector = (typeof COLLECTORS)[number];

export interface FeedbackContext {
  consoleLogs?: ConsoleEntry[];
  networkErrors?: NetworkError[];
  performanceTiming?: PerformanceTiming;
  environment?: EnvironmentInfo;
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  timestamp: number;
}

export interface NetworkError {
  url: string;
  method: string;
  status: number;
  statusText: string;
  timestamp: number;
}

export interface PerformanceTiming {
  loadTime?: number;
  domContentLoaded?: number;
  firstContentfulPaint?: number;
  largestContentfulPaint?: number;
}

export interface EnvironmentInfo {
  userAgent: string;
  language: string;
  platform: string;
  screenResolution: string;
  viewport: string;
  url: string;
  referrer: string;
  timestamp: number;
}

export interface FeedbackItem {
  id: string;
  type: FeedbackType;
  status: FeedbackStatus;
  title: string;
  description: string;
  data: Record<string, unknown> | null;
  context: FeedbackContext | null;
  sourceUrl: string | null;
  userAgent: string | null;
  viewport: string | null;
  sessionId: string | null;
  userId: string | null;
  tags: string[];
  screenshots: FeedbackScreenshot[];
  dispatchedTo: string | null;
  dispatchedAt: string | null;
  dispatchStatus: string | null;
  dispatchResponse: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackScreenshot {
  id: string;
  feedbackId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface AgentEndpoint {
  id: string;
  name: string;
  url: string;
  authHeader: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetConfig {
  endpoint: string;
  mode: WidgetMode;
  position: WidgetPosition;
  shortcut: string;
  collectors: Collector[];
}

export interface SubmitOptions {
  type?: FeedbackType;
  title?: string;
  description?: string;
  data?: Record<string, unknown>;
  screenshot?: boolean;
  tags?: string[];
}

export interface UserIdentity {
  id: string;
  email?: string;
  name?: string;
}

export interface FeedbackListParams {
  page?: number;
  limit?: number;
  type?: FeedbackType;
  status?: FeedbackStatus;
  tag?: string;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DispatchPayload {
  feedbackId: string;
  agentEndpointId: string;
  payload: {
    feedback: FeedbackItem;
    instructions?: string;
  };
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
}
