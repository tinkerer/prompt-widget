export const FEEDBACK_TYPES = [
  'manual',
  'ab_test',
  'analytics',
  'error_report',
  'programmatic',
] as const;

export const FEEDBACK_STATUSES = [
  'new',
  'reviewed',
  'dispatched',
  'resolved',
  'archived',
] as const;

export const WIDGET_MODES = ['always', 'admin', 'hidden'] as const;

export const WIDGET_POSITIONS = [
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
] as const;

export const COLLECTORS = [
  'console',
  'network',
  'performance',
  'environment',
] as const;

export const DEFAULT_POSITION = 'bottom-right' as const;
export const DEFAULT_MODE = 'always' as const;
export const DEFAULT_SHORTCUT = 'ctrl+shift+f';
export const API_VERSION = 'v1';
