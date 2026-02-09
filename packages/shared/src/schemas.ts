import { z } from 'zod';
import { FEEDBACK_TYPES, FEEDBACK_STATUSES } from './constants.js';

export const feedbackSubmitSchema = z.object({
  type: z.enum(FEEDBACK_TYPES).default('manual'),
  title: z.string().min(1).max(500),
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
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(FEEDBACK_TYPES).optional(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const batchOperationSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  operation: z.enum(['updateStatus', 'addTag', 'removeTag', 'delete']),
  value: z.string().optional(),
});

export const agentEndpointSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  authHeader: z.string().optional(),
  isDefault: z.boolean().default(false),
});

export const dispatchSchema = z.object({
  feedbackId: z.string(),
  agentEndpointId: z.string(),
  instructions: z.string().max(5000).optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
