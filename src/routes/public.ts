import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../types';
import { MOLTBOT_PORT } from '../config';
import { findExistingMoltbotProcess } from '../gateway';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  getAdminSessionToken,
  isAdminAuthConfigured,
  verifyAdminSessionToken,
} from '../auth';

/**
 * Public routes - NO Cloudflare Access authentication required
 * 
 * These routes are mounted BEFORE the auth middleware is applied.
 * Includes: health checks, static assets, and public API endpoints.
 */
const publicRoutes = new Hono<AppEnv>();

// GET /sandbox-health - Health check endpoint
publicRoutes.get('/sandbox-health', (c) => {
  return c.json({
    status: 'ok',
    service: 'moltbot-sandbox',
    gateway_port: MOLTBOT_PORT,
  });
});

// GET /logo.png - Serve logo from ASSETS binding
publicRoutes.get('/logo.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /logo-small.png - Serve small logo from ASSETS binding
publicRoutes.get('/logo-small.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /api/status - Public health check for gateway status (no auth required)
publicRoutes.get('/api/status', async (c) => {
  const sandbox = c.get('sandbox');
  
  try {
    const process = await findExistingMoltbotProcess(sandbox);
    if (!process) {
      return c.json({ ok: false, status: 'not_running' });
    }
    
    // Process exists, check if it's actually responding
    // Try to reach the gateway with a short timeout
    try {
      await process.waitForPort(18789, { mode: 'tcp', timeout: 5000 });
      return c.json({ ok: true, status: 'running', processId: process.id });
    } catch {
      return c.json({ ok: false, status: 'not_responding', processId: process.id });
    }
  } catch (err) {
    return c.json({ ok: false, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

publicRoutes.get('/api/auth/status', async (c) => {
  if (!isAdminAuthConfigured(c.env)) {
    return c.json({ enabled: false, authenticated: true });
  }
  const token = getAdminSessionToken(c);
  if (!token) {
    return c.json({ enabled: true, authenticated: false });
  }
  const authenticated = await verifyAdminSessionToken(c.env, token);
  return c.json({ enabled: true, authenticated });
});

publicRoutes.post('/api/auth/login', async (c) => {
  if (!isAdminAuthConfigured(c.env)) {
    return c.json({ error: 'Admin auth not configured' }, 500);
  }
  const body = await c.req.json().catch(() => ({}));
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (username !== c.env.ADMIN_USERNAME || password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  const token = await createAdminSessionToken(c.env, username);
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure,
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
  return c.json({ success: true });
});

publicRoutes.post('/api/auth/logout', async (c) => {
  const secure = new URL(c.req.url).protocol === 'https:';
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: '/', secure });
  return c.json({ success: true });
});

// GET /_admin/assets/* - Admin UI static assets (CSS, JS need to load for login redirect)
// Assets are built to dist/client with base "/_admin/"
publicRoutes.get('/_admin/assets/*', async (c) => {
  const url = new URL(c.req.url);
  // Rewrite /_admin/assets/* to /assets/* for the ASSETS binding
  const assetPath = url.pathname.replace('/_admin/assets/', '/assets/');
  const assetUrl = new URL(assetPath, url.origin);
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
});

export { publicRoutes };
