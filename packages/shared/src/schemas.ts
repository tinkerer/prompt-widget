import { z } from 'zod';
import { FEEDBACK_TYPES, FEEDBACK_STATUSES, DISPATCH_MODES, PERMISSION_PROFILES } from './constants.js';

export const feedbackSubmitSchema = z.object({
  type: z.enum(FEEDBACK_TYPES).default('manual'),
  title: z.string().max(500).default(''),
  description: z.string().max(10000).default(''),
  data: z.record(z.unknown()).optional(),
  context: z
    .object({
      consoleLogs: z
        .array(
          z.object({
            level: z.enum(['log', 'warn', 'error', 'info', 'debug']),
            message: z.string(),
            timestamp: z.number(),
          })
        )
        .optional(),
      networkErrors: z
        .array(
          z.object({
            url: z.string(),
            method: z.string(),
            status: z.number(),
            statusText: z.string(),
            timestamp: z.number(),
          })
        )
        .optional(),
      performanceTiming: z
        .object({
          loadTime: z.number().optional(),
          domContentLoaded: z.number().optional(),
          firstContentfulPaint: z.number().optional(),
          largestContentfulPaint: z.number().optional(),
        })
        .optional(),
      environment: z
        .object({
          userAgent: z.string(),
          language: z.string(),
          platform: z.string(),
          screenResolution: z.string(),
          viewport: z.string(),
          url: z.string(),
          referrer: z.string(),
          timestamp: z.number(),
        })
        .optional(),
    })
    .optional(),
  sourceUrl: z.string().url().optional(),
  userAgent: z.string().optional(),
  viewport: z.string().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export type FeedbackSubmitInput = z.infer<typeof feedbackSubmitSchema>;

export const feedbackUpdateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export type FeedbackUpdateInput = z.infer<typeof feedbackUpdateSchema>;

export const feedbackListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  type: z.enum(FEEDBACK_TYPES).optional(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  appId: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const batchOperationSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  operation: z.enum(['updateStatus', 'addTag', 'removeTag', 'delete']),
  value: z.string().optional(),
});

export const applicationSchema = z.object({
  name: z.string().min(1).max(100),
  projectDir: z.string().min(1).max(500),
  serverUrl: z.string().url().optional(),
  hooks: z.array(z.string().max(100)).max(50).default([]),
  description: z.string().max(5000).default(''),
});

export const agentEndpointSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().default(''),
  authHeader: z.string().optional(),
  isDefault: z.boolean().default(false),
  appId: z.string().optional(),
  promptTemplate: z.string().max(10000).optional(),
  mode: z.enum(DISPATCH_MODES).default('webhook'),
  permissionProfile: z.enum(PERMISSION_PROFILES).default('interactive'),
  allowedTools: z.string().max(5000).optional(),
  autoPlan: z.boolean().default(false),
});

export const dispatchSchema = z.object({
  feedbackId: z.string(),
  agentEndpointId: z.string(),
  instructions: z.string().max(5000).optional(),
});

export const PLAN_STATUSES = ['draft', 'active', 'completed'] as const;

export const aggregateQuerySchema = z.object({
  appId: z.string().optional(),
  type: z.enum(FEEDBACK_TYPES).optional(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  includeClosed: z.coerce.boolean().default(false),
  minCount: z.coerce.number().int().min(1).default(1),
});

export const planCreateSchema = z.object({
  groupKey: z.string().min(1),
  title: z.string().min(1).max(500),
  body: z.string().max(50000).default(''),
  status: z.enum(PLAN_STATUSES).default('draft'),
  linkedFeedbackIds: z.array(z.string()).default([]),
  appId: z.string().optional(),
});

export const planUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  body: z.string().max(50000).optional(),
  status: z.enum(PLAN_STATUSES).optional(),
  linkedFeedbackIds: z.array(z.string()).optional(),
});

export const analyzeSchema = z.object({
  appId: z.string(),
  agentEndpointId: z.string(),
});

export const analyzeClusterSchema = z.object({
  appId: z.string(),
  agentEndpointId: z.string(),
  feedbackIds: z.array(z.string()).min(1),
  clusterTitle: z.string(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
