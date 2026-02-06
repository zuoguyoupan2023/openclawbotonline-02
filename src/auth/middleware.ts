import type { Context, Next } from 'hono';
import type { AppEnv, MoltbotEnv } from '../types';
import { verifyAccessJWT } from './jwt';

/**
 * Options for creating an access middleware
 */
export interface AccessMiddlewareOptions {
  /** Response type: 'json' for API routes, 'html' for UI routes */
  type: 'json' | 'html';
  /** Whether to redirect to login when JWT is missing (only for 'html' type) */
  redirectOnMissing?: boolean;
}

/**
 * Check if running in development mode (skips CF Access auth + device pairing)
 */
export function isDevMode(env: MoltbotEnv): boolean {
  return env.DEV_MODE === 'true';
}

/**
 * Check if running in E2E test mode (skips CF Access auth but keeps device pairing)
 */
export function isE2ETestMode(env: MoltbotEnv): boolean {
  return env.E2E_TEST_MODE === 'true';
}

/**
 * Extract JWT from request headers or cookies
 */
export function extractJWT(c: Context<AppEnv>): string | null {
  const jwtHeader = c.req.header('CF-Access-JWT-Assertion');
  const jwtCookie = c.req.raw.headers.get('Cookie')
    ?.split(';')
    .find(cookie => cookie.trim().startsWith('CF_Authorization='))
    ?.split('=')[1];

  return jwtHeader || jwtCookie || null;
}

export const ADMIN_SESSION_COOKIE = 'admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

export function isAdminAuthConfigured(env: MoltbotEnv): boolean {
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD);
}

const encodeBase64Url = (data: Uint8Array) =>
  btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const decodeBase64Url = (input: string) => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padding);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const encodeText = (value: string) => new TextEncoder().encode(value);

const signSession = async (value: string, secret: string) => {
  const data = encodeText(value);
  const key = await crypto.subtle.importKey(
    'raw',
    encodeText(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return encodeBase64Url(new Uint8Array(signature));
};

const constantTimeEqual = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
};

export async function createAdminSessionToken(env: MoltbotEnv, username: string) {
  const exp = Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000;
  const payload = encodeBase64Url(encodeText(JSON.stringify({ u: username, exp })));
  const signature = await signSession(payload, env.ADMIN_PASSWORD ?? '');
  return `${payload}.${signature}`;
}

export async function verifyAdminSessionToken(env: MoltbotEnv, token: string) {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !env.ADMIN_PASSWORD) return false;
  const expected = await signSession(payload, env.ADMIN_PASSWORD);
  if (!constantTimeEqual(decodeBase64Url(signature), decodeBase64Url(expected))) return false;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as { u?: string; exp?: number };
    if (!decoded || typeof decoded.exp !== 'number' || decoded.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export function getAdminSessionToken(c: Context<AppEnv>): string | null {
  const cookieHeader = c.req.raw.headers.get('Cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  if (!match) return null;
  return match.split('=')[1] ?? null;
}

/**
 * Create a Cloudflare Access authentication middleware
 * 
 * @param options - Middleware options
 * @returns Hono middleware function
 */
export function createAccessMiddleware(options: AccessMiddlewareOptions) {
  const { type, redirectOnMissing = false } = options;

  return async (c: Context<AppEnv>, next: Next) => {
    // Skip auth in dev mode or E2E test mode
    if (isDevMode(c.env) || isE2ETestMode(c.env)) {
      c.set('accessUser', { email: 'dev@localhost', name: 'Dev User' });
      return next();
    }

    const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
    const expectedAud = c.env.CF_ACCESS_AUD;

    if (!teamDomain || !expectedAud) {
      return next();
    }

    // Get JWT
    const jwt = extractJWT(c);

    if (!jwt) {
      if (type === 'html' && redirectOnMissing) {
        return c.redirect(`https://${teamDomain}`, 302);
      }
      
      if (type === 'json') {
        return c.json({
          error: 'Unauthorized',
          hint: 'Missing Cloudflare Access JWT. Ensure this route is protected by Cloudflare Access.',
        }, 401);
      } else {
        return c.html(`
          <html>
            <body>
              <h1>Unauthorized</h1>
              <p>Missing Cloudflare Access token.</p>
              <a href="https://${teamDomain}">Login</a>
            </body>
          </html>
        `, 401);
      }
    }

    // Verify JWT
    try {
      const payload = await verifyAccessJWT(jwt, teamDomain, expectedAud);
      c.set('accessUser', { email: payload.email, name: payload.name });
      await next();
    } catch (err) {
      console.error('Access JWT verification failed:', err);
      
      if (type === 'json') {
        return c.json({
          error: 'Unauthorized',
          details: err instanceof Error ? err.message : 'JWT verification failed',
        }, 401);
      } else {
        return c.html(`
          <html>
            <body>
              <h1>Unauthorized</h1>
              <p>Your Cloudflare Access session is invalid or expired.</p>
              <a href="https://${teamDomain}">Login again</a>
            </body>
          </html>
        `, 401);
      }
    }
  };
}
