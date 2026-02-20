import { Hono } from 'hono';
import {
  listLaunchers,
  getLauncher,
  unregisterLauncher,
  serializeLauncher,
} from '../launcher-registry.js';

const app = new Hono();

app.get('/', (c) => {
  const all = listLaunchers().map(serializeLauncher);
  return c.json({ launchers: all });
});

app.get('/:id', (c) => {
  const launcher = getLauncher(c.req.param('id'));
  if (!launcher) return c.json({ error: 'Launcher not found' }, 404);
  return c.json(serializeLauncher(launcher));
});

app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const launcher = getLauncher(id);
  if (!launcher) return c.json({ error: 'Launcher not found' }, 404);
  try { launcher.ws.close(4012, 'Force disconnected by admin'); } catch {}
  unregisterLauncher(id);
  return c.json({ ok: true, id });
});

export default app;
