import { Hono } from 'hono';
import { listSessions, getSession, sendCommand } from '../sessions.js';

export const agentRoutes = new Hono();

// List all active sessions
agentRoutes.get('/sessions', (c) => {
  return c.json(listSessions());
});

// Get session info
agentRoutes.get('/sessions/:id', (c) => {
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ error: 'Session not found' }, 404);
  const { ws, pendingRequests, ...info } = session;
  return c.json(info);
});

// Capture screenshot of the live page
agentRoutes.post('/sessions/:id/screenshot', async (c) => {
  try {
    const result = await sendCommand(c.req.param('id'), 'screenshot');
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, err.message.includes('not found') ? 404 : 504);
  }
});

// Execute JS in page context (scoped - agent provides expression, widget evals it)
agentRoutes.post('/sessions/:id/execute', async (c) => {
  const body = await c.req.json();
  const { expression } = body;
  if (!expression || typeof expression !== 'string') {
    return c.json({ error: 'expression is required' }, 400);
  }
  if (expression.length > 10_000) {
    return c.json({ error: 'expression too long (max 10000 chars)' }, 400);
  }
  try {
    const result = await sendCommand(c.req.param('id'), 'execute', { expression });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// Get current console logs from the session
agentRoutes.get('/sessions/:id/console', async (c) => {
  try {
    const result = await sendCommand(c.req.param('id'), 'getConsole');
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// Get network errors from the session
agentRoutes.get('/sessions/:id/network', async (c) => {
  try {
    const result = await sendCommand(c.req.param('id'), 'getNetwork');
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// Get environment info from the session
agentRoutes.get('/sessions/:id/environment', async (c) => {
  try {
    const result = await sendCommand(c.req.param('id'), 'getEnvironment');
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// Get DOM snapshot (accessibility-tree-like)
agentRoutes.get('/sessions/:id/dom', async (c) => {
  const selector = c.req.query('selector') || 'body';
  try {
    const result = await sendCommand(c.req.param('id'), 'getDom', { selector });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// Navigate to a URL
agentRoutes.post('/sessions/:id/navigate', async (c) => {
  const body = await c.req.json();
  const { url } = body;
  if (!url || typeof url !== 'string') {
    return c.json({ error: 'url is required' }, 400);
  }
  try {
    const result = await sendCommand(c.req.param('id'), 'navigate', { url });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// Click an element by CSS selector
agentRoutes.post('/sessions/:id/click', async (c) => {
  const body = await c.req.json();
  const { selector } = body;
  if (!selector || typeof selector !== 'string') {
    return c.json({ error: 'selector is required' }, 400);
  }
  try {
    const result = await sendCommand(c.req.param('id'), 'click', { selector });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// Type text into a focused or selected element
agentRoutes.post('/sessions/:id/type', async (c) => {
  const body = await c.req.json();
  const { selector, text } = body;
  if (!text || typeof text !== 'string') {
    return c.json({ error: 'text is required' }, 400);
  }
  try {
    const result = await sendCommand(c.req.param('id'), 'type', { selector, text });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// Get page performance timing
agentRoutes.get('/sessions/:id/performance', async (c) => {
  try {
    const result = await sendCommand(c.req.param('id'), 'getPerformance');
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// --- Mouse commands ---

agentRoutes.post('/sessions/:id/mouse/move', async (c) => {
  const { x, y } = await c.req.json();
  if (typeof x !== 'number' || typeof y !== 'number') {
    return c.json({ error: 'x and y are required numbers' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'moveMouse', { x, y }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

agentRoutes.post('/sessions/:id/mouse/click', async (c) => {
  const { x, y, button } = await c.req.json();
  if (typeof x !== 'number' || typeof y !== 'number') {
    return c.json({ error: 'x and y are required numbers' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'clickAt', { x, y, button }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

agentRoutes.post('/sessions/:id/mouse/hover', async (c) => {
  const { selector, x, y } = await c.req.json();
  if (!selector && typeof x !== 'number') {
    return c.json({ error: 'selector or x/y coordinates required' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'hover', { selector, x, y }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

agentRoutes.post('/sessions/:id/mouse/drag', async (c) => {
  const { from, to, steps, stepDelayMs } = await c.req.json();
  if (from?.x == null || from?.y == null || to?.x == null || to?.y == null) {
    return c.json({ error: 'from {x,y} and to {x,y} are required' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'drag', { from, to, steps, stepDelayMs }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

agentRoutes.post('/sessions/:id/mouse/down', async (c) => {
  const { x, y, button } = await c.req.json();
  if (typeof x !== 'number' || typeof y !== 'number') {
    return c.json({ error: 'x and y are required numbers' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'mouseDown', { x, y, button }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

agentRoutes.post('/sessions/:id/mouse/up', async (c) => {
  const { x, y, button } = await c.req.json();
  if (typeof x !== 'number' || typeof y !== 'number') {
    return c.json({ error: 'x and y are required numbers' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'mouseUp', { x, y, button }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

// --- Keyboard commands ---

agentRoutes.post('/sessions/:id/keyboard/press', async (c) => {
  const { key, modifiers } = await c.req.json();
  if (!key || typeof key !== 'string') {
    return c.json({ error: 'key is required' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'pressKey', { key, modifiers }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

agentRoutes.post('/sessions/:id/keyboard/down', async (c) => {
  const { key, modifiers } = await c.req.json();
  if (!key || typeof key !== 'string') {
    return c.json({ error: 'key is required' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'keyDown', { key, modifiers }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

agentRoutes.post('/sessions/:id/keyboard/up', async (c) => {
  const { key, modifiers } = await c.req.json();
  if (!key || typeof key !== 'string') {
    return c.json({ error: 'key is required' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'keyUp', { key, modifiers }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});

agentRoutes.post('/sessions/:id/keyboard/type', async (c) => {
  const { text, selector, charDelayMs } = await c.req.json();
  if (!text || typeof text !== 'string') {
    return c.json({ error: 'text is required' }, 400);
  }
  try {
    return c.json(await sendCommand(c.req.param('id'), 'typeText', { text, selector, charDelayMs }));
  } catch (err: any) {
    return c.json({ error: err.message }, 504);
  }
});
