import { Hono } from 'hono';
import { ulid } from 'ulidx';
import { eq } from 'drizzle-orm';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { feedbackSubmitSchema } from '@prompt-widget/shared';
import { db, schema } from '../db/index.js';
import { getSession } from '../sessions.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

export const feedbackRoutes = new Hono();

feedbackRoutes.post('/', async (c) => {
  const contentType = c.req.header('content-type') || '';

  let feedbackData: Record<string, unknown>;
  const imageFiles: { data: ArrayBuffer; name: string; type: string }[] = [];

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const jsonStr = formData.get('feedback');
    if (!jsonStr || typeof jsonStr !== 'string') {
      return c.json({ error: 'Missing feedback field in form data' }, 400);
    }
    feedbackData = JSON.parse(jsonStr);

    const files = formData.getAll('screenshots');
    for (const file of files) {
      if (file instanceof File) {
        imageFiles.push({
          data: await file.arrayBuffer(),
          name: file.name,
          type: file.type || 'image/png',
        });
      }
    }
  } else {
    feedbackData = await c.req.json();
  }

  const parsed = feedbackSubmitSchema.safeParse(feedbackData);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const now = new Date().toISOString();
  const id = ulid();
  const input = parsed.data;

  let appId: string | null = null;
  if (input.sessionId) {
    const session = getSession(input.sessionId);
    if (session?.appId) appId = session.appId;
  }

  await db.insert(schema.feedbackItems).values({
    id,
    type: input.type,
    status: 'new',
    title: input.title,
    description: input.description,
    data: input.data ? JSON.stringify(input.data) : null,
    context: input.context ? JSON.stringify(input.context) : null,
    sourceUrl: input.sourceUrl || null,
    userAgent: input.userAgent || null,
    viewport: input.viewport || null,
    sessionId: input.sessionId || null,
    userId: input.userId || null,
    appId,
    createdAt: now,
    updatedAt: now,
  });

  if (input.tags && input.tags.length > 0) {
    await db.insert(schema.feedbackTags).values(
      input.tags.map((tag) => ({ feedbackId: id, tag }))
    );
  }

  if (imageFiles.length > 0) {
    await mkdir(UPLOAD_DIR, { recursive: true });
    for (const file of imageFiles) {
      const screenshotId = ulid();
      const ext = file.type.split('/')[1] || 'png';
      const filename = `${screenshotId}.${ext}`;
      await writeFile(join(UPLOAD_DIR, filename), Buffer.from(file.data));
      await db.insert(schema.feedbackScreenshots).values({
        id: screenshotId,
        feedbackId: id,
        filename,
        mimeType: file.type,
        size: file.data.byteLength,
        createdAt: now,
      });
    }
  }

  return c.json({ id, status: 'new', createdAt: now }, 201);
});

feedbackRoutes.post('/programmatic', async (c) => {
  const body = await c.req.json();
  const parsed = feedbackSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const now = new Date().toISOString();
  const id = ulid();
  const input = parsed.data;

  let progAppId: string | null = null;
  if (input.sessionId) {
    const session = getSession(input.sessionId);
    if (session?.appId) progAppId = session.appId;
  }

  await db.insert(schema.feedbackItems).values({
    id,
    type: input.type,
    status: 'new',
    title: input.title,
    description: input.description,
    data: input.data ? JSON.stringify(input.data) : null,
    context: input.context ? JSON.stringify(input.context) : null,
    sourceUrl: input.sourceUrl || null,
    userAgent: input.userAgent || null,
    viewport: input.viewport || null,
    sessionId: input.sessionId || null,
    userId: input.userId || null,
    appId: progAppId,
    createdAt: now,
    updatedAt: now,
  });

  if (input.tags && input.tags.length > 0) {
    await db.insert(schema.feedbackTags).values(
      input.tags.map((tag) => ({ feedbackId: id, tag }))
    );
  }

  return c.json({ id, status: 'new', createdAt: now }, 201);
});
