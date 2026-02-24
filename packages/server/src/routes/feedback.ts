import { Hono } from 'hono';
import { ulid } from 'ulidx';
import { eq } from 'drizzle-orm';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { feedbackSubmitSchema } from '@prompt-widget/shared';
import { db, schema } from '../db/index.js';
import { getSession } from '../sessions.js';
import { feedbackEvents } from '../events.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

function resolveAppId(apiKey: string | undefined, sessionId: string | undefined): string | null {
  if (sessionId) {
    const session = getSession(sessionId);
    if (session?.appId) return session.appId;
  }
  if (apiKey) {
    const app = db
      .select({ id: schema.applications.id })
      .from(schema.applications)
      .where(eq(schema.applications.apiKey, apiKey))
      .get();
    if (app) return app.id;
  }
  return null;
}

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
  const title = input.title || input.description.slice(0, 80) || 'Untitled';

  const apiKey = c.req.header('x-api-key');
  const appId = resolveAppId(apiKey, input.sessionId);
  if (!appId) {
    return c.json({ error: 'Could not resolve application. Provide a valid X-API-Key header or sessionId.' }, 400);
  }

  await db.insert(schema.feedbackItems).values({
    id,
    type: input.type,
    status: 'new',
    title,
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

  feedbackEvents.emit('new', { id, appId, autoDispatch: !!input.autoDispatch });
  return c.json({ id, appId, status: 'new', createdAt: now }, 201);
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
  const progTitle = input.title || input.description.slice(0, 80) || 'Untitled';

  const progApiKey = c.req.header('x-api-key');
  const progAppId = resolveAppId(progApiKey, input.sessionId);
  if (!progAppId) {
    return c.json({ error: 'Could not resolve application. Provide a valid X-API-Key header or sessionId.' }, 400);
  }

  await db.insert(schema.feedbackItems).values({
    id,
    type: input.type,
    status: 'new',
    title: progTitle,
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

  feedbackEvents.emit('new', { id, appId: progAppId, autoDispatch: !!input.autoDispatch });
  return c.json({ id, appId: progAppId, status: 'new', createdAt: now }, 201);
});
