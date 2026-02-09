import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const feedbackItems = sqliteTable('feedback_items', {
  id: text('id').primaryKey(),
  type: text('type').notNull().default('manual'),
  status: text('status').notNull().default('new'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  data: text('data'),
  context: text('context'),
  sourceUrl: text('source_url'),
  userAgent: text('user_agent'),
  viewport: text('viewport'),
  sessionId: text('session_id'),
  userId: text('user_id'),
  dispatchedTo: text('dispatched_to'),
  dispatchedAt: text('dispatched_at'),
  dispatchStatus: text('dispatch_status'),
  dispatchResponse: text('dispatch_response'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const feedbackScreenshots = sqliteTable('feedback_screenshots', {
  id: text('id').primaryKey(),
  feedbackId: text('feedback_id')
    .notNull()
    .references(() => feedbackItems.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull(),
});

export const feedbackTags = sqliteTable('feedback_tags', {
  feedbackId: text('feedback_id')
    .notNull()
    .references(() => feedbackItems.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
});

export const agentEndpoints = sqliteTable('agent_endpoints', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  authHeader: text('auth_header'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
