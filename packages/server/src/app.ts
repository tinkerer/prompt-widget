import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import { feedbackRoutes } from './routes/feedback.js';
import { adminRoutes } from './routes/admin.js';
import { imageRoutes } from './routes/images.js';
import { authRoutes } from './routes/auth.js';
import { agentRoutes } from './routes/agent.js';

export const app = new Hono();

app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

app.get('/api/v1/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() })
);

app.route('/api/v1/feedback', feedbackRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/images', imageRoutes);
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/agent', agentRoutes);

// Serve widget JS from the widget package build output
app.use('/widget/*', serveStatic({ root: '../widget/dist/', rewriteRequestPath: (path) => path.replace('/widget', '') }));

// Serve admin SPA from the admin package build output
app.use('/admin/*', serveStatic({ root: '../admin/dist/', rewriteRequestPath: (path) => path.replace('/admin', '') }));
// SPA fallback for admin routes
app.get('/admin/*', serveStatic({ root: '../admin/dist/', path: 'index.html' }));

// Serve test page and other static files
app.use('/*', serveStatic({ root: './public/' }));
