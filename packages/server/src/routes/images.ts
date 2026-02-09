import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

export const imageRoutes = new Hono();

imageRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const screenshot = await db.query.feedbackScreenshots.findFirst({
    where: eq(schema.feedbackScreenshots.id, id),
  });

  if (!screenshot) {
    return c.json({ error: 'Image not found' }, 404);
  }

  try {
    const filePath = join(UPLOAD_DIR, screenshot.filename);
    const data = await readFile(filePath);
    c.header('Content-Type', screenshot.mimeType);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(data);
  } catch {
    return c.json({ error: 'Image file not found' }, 404);
  }
});
