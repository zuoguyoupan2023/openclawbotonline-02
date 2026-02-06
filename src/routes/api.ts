import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { createAccessMiddleware, getAdminSessionToken, isAdminAuthConfigured, verifyAdminSessionToken } from '../auth';
import { ensureMoltbotGateway, findExistingMoltbotProcess, mountR2Storage, syncToR2, waitForProcess } from '../gateway';
import { R2_MOUNT_PATH } from '../config';

// CLI commands can take 10-15 seconds to complete due to WebSocket connection overhead
const CLI_TIMEOUT_MS = 20000;
const buildCliCommand = (args: string) =>
  `if command -v openclaw >/dev/null 2>&1; then openclaw ${args}; else clawdbot ${args}; fi`;
const R2_ALLOWED_PREFIXES = [
  'clawdbot/',
  'skills/',
  'workspace-core/',
  'workspace-core/scripts/',
  'workspace-core/config/',
  'workspace-core/logs/',
  'workspace-core/memory/',
];
const R2_LIST_LIMIT_DEFAULT = 200;
const R2_LIST_LIMIT_MAX = 1000;
const R2_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const R2_OBJECT_PREVIEW_MAX_BYTES = 1024 * 1024;
const AI_ENV_CONFIG_KEY = 'workspace-core/config/ai-env.json';
const CLAWDBOT_CONFIG_KEY = 'clawdbot/clawdbot.json';
const WORKSPACE_CONFIG_KEY = 'workspace-core/config/clawdbot.json';
const AI_BASE_URL_KEYS = ['AI_GATEWAY_BASE_URL', 'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'DEEPSEEK_BASE_URL', 'KIMI_BASE_URL', 'CHATGLM_BASE_URL'] as const;
const AI_API_KEY_KEYS = ['AI_GATEWAY_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'KIMI_API_KEY', 'CHATGLM_API_KEY'] as const;

type AiEnvConfig = {
  baseUrls?: Partial<Record<(typeof AI_BASE_URL_KEYS)[number], string | null>>;
  apiKeys?: Partial<Record<(typeof AI_API_KEY_KEYS)[number], string | null>>;
  primaryProvider?: string | null;
};

const isValidR2Path = (value: string) => {
  if (!value) return false;
  if (value.includes('..')) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  return R2_ALLOWED_PREFIXES.some(prefix => value.startsWith(prefix));
};

const parseR2ListLimit = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return R2_LIST_LIMIT_DEFAULT;
  return Math.min(parsed, R2_LIST_LIMIT_MAX);
};

const readAiEnvConfig = async (bucket: R2Bucket): Promise<AiEnvConfig> => {
  try {
    const object = await bucket.get(AI_ENV_CONFIG_KEY);
    if (!object) return {};
    const text = await object.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as AiEnvConfig;
  } catch {
    return {};
  }
};

const writeAiEnvConfig = async (bucket: R2Bucket, config: AiEnvConfig) => {
  await bucket.put(AI_ENV_CONFIG_KEY, JSON.stringify(config, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
};

const buildAiEnvResponse = (config: AiEnvConfig, envVars: Record<string, string | undefined>) => {
  const baseUrls = Object.fromEntries(
    AI_BASE_URL_KEYS.map((key) => {
      const override = config.baseUrls?.[key];
      if (override === null) return [key, null];
      if (typeof override === 'string' && override.trim().length > 0) return [key, override.trim()];
      const envValue = envVars[key];
      return [key, envValue && envValue.trim().length > 0 ? envValue : null];
    })
  );
  const apiKeys = Object.fromEntries(
    AI_API_KEY_KEYS.map((key) => {
      const override = config.apiKeys?.[key];
      if (override === null) return [key, { isSet: false, source: 'cleared' }];
      if (typeof override === 'string' && override.trim().length > 0) {
        return [key, { isSet: true, source: 'saved' }];
      }
      const envValue = envVars[key];
      if (envValue && envValue.trim().length > 0) {
        return [key, { isSet: true, source: 'env' }];
      }
      return [key, { isSet: false, source: null }];
    })
  );
  return { baseUrls, apiKeys, primaryProvider: config.primaryProvider ?? null };
};

/**
 * API routes
 * - /api/admin/* - Protected admin API routes (Cloudflare Access required)
 * 
 * Note: /api/status is now handled by publicRoutes (no auth required)
 */
const api = new Hono<AppEnv>();

/**
 * Admin API routes - all protected by Cloudflare Access
 */
const adminApi = new Hono<AppEnv>();

// Middleware: Verify Cloudflare Access JWT for all admin routes
adminApi.use('*', createAccessMiddleware({ type: 'json' }));
adminApi.use('*', async (c, next) => {
  if (!isAdminAuthConfigured(c.env)) {
    return next();
  }
  const token = getAdminSessionToken(c);
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const valid = await verifyAdminSessionToken(c.env, token);
  if (!valid) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

// GET /api/admin/devices - List pending and paired devices
adminApi.get('/devices', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Ensure moltbot is running first
    await ensureMoltbotGateway(sandbox, c.env);

    // Run moltbot CLI to list devices (CLI is still named clawdbot until upstream renames)
    // Must specify --url to connect to the gateway running in the same container
    const proc = await sandbox.startProcess(buildCliCommand('devices list --json --url ws://localhost:18789'));
    await waitForProcess(proc, CLI_TIMEOUT_MS);

    const logs = await proc.getLogs();
    const stdout = logs.stdout || '';
    const stderr = logs.stderr || '';

    // Try to parse JSON output
    try {
      // Find JSON in output (may have other log lines)
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return c.json(data);
      }

      // If no JSON found, return raw output for debugging
      return c.json({
        pending: [],
        paired: [],
        raw: stdout,
        stderr,
      });
    } catch {
      return c.json({
        pending: [],
        paired: [],
        raw: stdout,
        stderr,
        parseError: 'Failed to parse CLI output',
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/devices/:requestId/approve - Approve a pending device
adminApi.post('/devices/:requestId/approve', async (c) => {
  const sandbox = c.get('sandbox');
  const requestId = c.req.param('requestId');

  if (!requestId) {
    return c.json({ error: 'requestId is required' }, 400);
  }

  try {
    // Ensure moltbot is running first
    await ensureMoltbotGateway(sandbox, c.env);

    // Run moltbot CLI to approve the device (CLI is still named clawdbot)
    const proc = await sandbox.startProcess(buildCliCommand(`devices approve ${requestId} --url ws://localhost:18789`));
    await waitForProcess(proc, CLI_TIMEOUT_MS);

    const logs = await proc.getLogs();
    const stdout = logs.stdout || '';
    const stderr = logs.stderr || '';

    // Check for success indicators (case-insensitive, CLI outputs "Approved ...")
    const success = stdout.toLowerCase().includes('approved') || proc.exitCode === 0;

    return c.json({
      success,
      requestId,
      message: success ? 'Device approved' : 'Approval may have failed',
      stdout,
      stderr,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/devices/approve-all - Approve all pending devices
adminApi.post('/devices/approve-all', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Ensure moltbot is running first
    await ensureMoltbotGateway(sandbox, c.env);

    // First, get the list of pending devices (CLI is still named clawdbot)
    const listProc = await sandbox.startProcess(buildCliCommand('devices list --json --url ws://localhost:18789'));
    await waitForProcess(listProc, CLI_TIMEOUT_MS);

    const listLogs = await listProc.getLogs();
    const stdout = listLogs.stdout || '';

    // Parse pending devices
    let pending: Array<{ requestId: string }> = [];
    try {
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        pending = data.pending || [];
      }
    } catch {
      return c.json({ error: 'Failed to parse device list', raw: stdout }, 500);
    }

    if (pending.length === 0) {
      return c.json({ approved: [], message: 'No pending devices to approve' });
    }

    // Approve each pending device
    const results: Array<{ requestId: string; success: boolean; error?: string }> = [];

    for (const device of pending) {
      try {
        const approveProc = await sandbox.startProcess(
          buildCliCommand(`devices approve ${device.requestId} --url ws://localhost:18789`)
        );
        await waitForProcess(approveProc, CLI_TIMEOUT_MS);

        const approveLogs = await approveProc.getLogs();
        const success = approveLogs.stdout?.toLowerCase().includes('approved') || approveProc.exitCode === 0;

        results.push({ requestId: device.requestId, success });
      } catch (err) {
        results.push({
          requestId: device.requestId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const approvedCount = results.filter(r => r.success).length;
    return c.json({
      approved: results.filter(r => r.success).map(r => r.requestId),
      failed: results.filter(r => !r.success),
      message: `Approved ${approvedCount} of ${pending.length} device(s)`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// GET /api/admin/storage - Get R2 storage status and last sync time
adminApi.get('/storage', async (c) => {
  const sandbox = c.get('sandbox');
  const hasCredentials = !!(
    c.env.R2_ACCESS_KEY_ID && 
    c.env.R2_SECRET_ACCESS_KEY && 
    c.env.CF_ACCOUNT_ID
  );

  // Check which credentials are missing
  const missing: string[] = [];
  if (!c.env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!c.env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!c.env.CF_ACCOUNT_ID) missing.push('CF_ACCOUNT_ID');

  let lastSync: string | null = null;

  // If R2 is configured, check for last sync timestamp
  if (hasCredentials) {
    try {
      // Mount R2 if not already mounted
      await mountR2Storage(sandbox, c.env);
      
      // Check for sync marker file
      const proc = await sandbox.startProcess(`cat ${R2_MOUNT_PATH}/.last-sync 2>/dev/null || echo ""`);
      await waitForProcess(proc, 5000);
      const logs = await proc.getLogs();
      const timestamp = logs.stdout?.trim();
      if (timestamp && timestamp !== '') {
        lastSync = timestamp;
      }
    } catch {
      // Ignore errors checking sync status
    }
  }

  return c.json({
    configured: hasCredentials,
    missing: missing.length > 0 ? missing : undefined,
    lastSync,
    message: hasCredentials 
      ? 'R2 storage is configured. Your data will persist across container restarts.'
      : 'R2 storage is not configured. Paired devices and conversations will be lost when the container restarts.',
  });
});

// POST /api/admin/storage/sync - Trigger a manual sync to R2
adminApi.post('/storage/sync', async (c) => {
  const sandbox = c.get('sandbox');
  
  const result = await syncToR2(sandbox, c.env);
  
  if (result.success) {
    return c.json({
      success: true,
      message: 'Sync completed successfully',
      lastSync: result.lastSync,
    });
  } else {
    const status = result.error?.includes('not configured') ? 400 : 500;
    return c.json({
      success: false,
      error: result.error,
      details: result.details,
    }, status);
  }
});

adminApi.get('/r2/list', async (c) => {
  const prefix = c.req.query('prefix')?.trim() ?? '';
  if (!isValidR2Path(prefix)) {
    return c.json({ error: 'Invalid prefix' }, 400);
  }
  const cursor = c.req.query('cursor') ?? undefined;
  const limit = parseR2ListLimit(c.req.query('limit'));
  try {
    const list = await c.env.MOLTBOT_BUCKET.list({ prefix, cursor, limit });
    const nextCursor = list.truncated ? (list as { cursor?: string }).cursor ?? null : null;
    return c.json({
      prefix,
      cursor: cursor ?? null,
      nextCursor,
      truncated: list.truncated,
      objects: list.objects.map(obj => ({
        key: obj.key,
        size: obj.size,
        etag: obj.etag,
        uploaded: obj.uploaded.toISOString(),
      })),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

adminApi.get('/r2/object', async (c) => {
  const key = c.req.query('key')?.trim() ?? '';
  if (!isValidR2Path(key)) {
    return c.json({ error: 'Invalid key' }, 400);
  }
  try {
    const object = await c.env.MOLTBOT_BUCKET.get(key);
    if (!object) {
      return c.json({ error: 'Object not found' }, 404);
    }
    if (object.size > R2_OBJECT_PREVIEW_MAX_BYTES) {
      return c.json({ error: 'Object too large' }, 413);
    }
    const text = await object.text();
    return c.json({
      key,
      contentType: object.httpMetadata?.contentType ?? null,
      content: text,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

adminApi.delete('/r2/object', async (c) => {
  const key = c.req.query('key')?.trim() ?? '';
  if (!isValidR2Path(key)) {
    return c.json({ error: 'Invalid key' }, 400);
  }
  try {
    await c.env.MOLTBOT_BUCKET.delete(key);
    return c.json({ success: true, key });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

adminApi.delete('/r2/prefix', async (c) => {
  const prefix = c.req.query('prefix')?.trim() ?? '';
  if (!isValidR2Path(prefix)) {
    return c.json({ error: 'Invalid prefix' }, 400);
  }
  let cursor: string | undefined;
  let deletedCount = 0;
  try {
    do {
      const list = await c.env.MOLTBOT_BUCKET.list({ prefix, cursor, limit: R2_LIST_LIMIT_MAX });
      const keys = list.objects.map(obj => obj.key);
      if (keys.length > 0) {
        await c.env.MOLTBOT_BUCKET.delete(keys);
        deletedCount += keys.length;
      }
      cursor = list.truncated ? (list as { cursor?: string }).cursor : undefined;
    } while (cursor);
    return c.json({ success: true, prefix, deletedCount });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

adminApi.post('/r2/upload', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: 'Invalid content type' }, 400);
  }
  try {
    const body = await c.req.parseBody();
    const prefix = typeof body.prefix === 'string' ? body.prefix.trim() : '';
    if (!isValidR2Path(prefix)) {
      return c.json({ error: 'Invalid prefix' }, 400);
    }
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ error: 'File is required' }, 400);
    }
    if (file.size > R2_UPLOAD_MAX_BYTES) {
      return c.json({ error: 'File too large' }, 413);
    }
    const rawName = file.name.split('/').pop() ?? 'upload.bin';
    const safeName = rawName.replaceAll('\\', '_');
    const key = `${prefix}${safeName}`;
    if (!isValidR2Path(key)) {
      return c.json({ error: 'Invalid key' }, 400);
    }
    await c.env.MOLTBOT_BUCKET.put(key, file, {
      httpMetadata: {
        contentType: file.type || undefined,
      },
    });
    return c.json({ success: true, key });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

adminApi.get('/ai/env', async (c) => {
  const envVars = c.env as unknown as Record<string, string | undefined>;
  const config = await readAiEnvConfig(c.env.MOLTBOT_BUCKET);
  const summary = buildAiEnvResponse(config, envVars);
  const baseUrls = Object.entries(summary.baseUrls)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key]) => key);
  const apiKeys = Object.entries(summary.apiKeys as Record<string, { isSet: boolean }>)
    .filter(([, value]) => value.isSet)
    .map(([key]) => key);

  return c.json({
    baseUrls,
    apiKeys,
  });
});

adminApi.get('/ai/config', async (c) => {
  const envVars = c.env as unknown as Record<string, string | undefined>;
  const config = await readAiEnvConfig(c.env.MOLTBOT_BUCKET);
  return c.json(buildAiEnvResponse(config, envVars));
});

adminApi.post('/ai/config', async (c) => {
  const envVars = c.env as unknown as Record<string, string | undefined>;
  const payload = await c.req.json();
  const config = await readAiEnvConfig(c.env.MOLTBOT_BUCKET);

  if (payload && typeof payload === 'object') {
    if (payload.baseUrls && typeof payload.baseUrls === 'object') {
      config.baseUrls = config.baseUrls ?? {};
      AI_BASE_URL_KEYS.forEach((key) => {
        if (!(key in payload.baseUrls)) return;
        const rawValue = payload.baseUrls[key];
        if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
          config.baseUrls![key] = null;
        } else if (typeof rawValue === 'string') {
          config.baseUrls![key] = rawValue.trim();
        }
      });
    }
    if (payload.apiKeys && typeof payload.apiKeys === 'object') {
      config.apiKeys = config.apiKeys ?? {};
      AI_API_KEY_KEYS.forEach((key) => {
        if (!(key in payload.apiKeys)) return;
        const rawValue = payload.apiKeys[key];
        if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
          config.apiKeys![key] = null;
        } else if (typeof rawValue === 'string') {
          config.apiKeys![key] = rawValue.trim();
        }
      });
    }
    if ('primaryProvider' in payload) {
      const rawValue = payload.primaryProvider;
      if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
        config.primaryProvider = null;
      } else if (typeof rawValue === 'string') {
        config.primaryProvider = rawValue.trim();
      }
    }
  }

  await writeAiEnvConfig(c.env.MOLTBOT_BUCKET, config);
  return c.json(buildAiEnvResponse(config, envVars));
});

adminApi.get('/gateway/logs', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    const process = await findExistingMoltbotProcess(sandbox);
    if (!process) {
      return c.json({ ok: false, error: 'Gateway process not found' }, 404);
    }
    const logs = await process.getLogs();
    return c.json({
      ok: true,
      processId: process.id,
      status: process.status,
      stdout: logs.stdout || '',
      stderr: logs.stderr || '',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// POST /api/admin/gateway/restart - Kill the current gateway and start a new one
adminApi.post('/gateway/restart', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Find and kill the existing gateway process
    const existingProcess = await findExistingMoltbotProcess(sandbox);
    
    if (existingProcess) {
      console.log('Killing existing gateway process:', existingProcess.id);
      try {
        await existingProcess.kill();
      } catch (killErr) {
        console.error('Error killing process:', killErr);
      }
      // Wait a moment for the process to die
      await new Promise(r => setTimeout(r, 2000));
    }

    // Start a new gateway in the background
    const bootPromise = ensureMoltbotGateway(sandbox, c.env).catch((err) => {
      console.error('Gateway restart failed:', err);
    });
    c.executionCtx.waitUntil(bootPromise);

    return c.json({
      success: true,
      message: existingProcess 
        ? 'Gateway process killed, new instance starting...'
        : 'No existing process found, starting new instance...',
      previousProcessId: existingProcess?.id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

adminApi.post('/gateway/reset-config', async (c) => {
  const sandbox = c.get('sandbox');
  let clearR2 = false;
  let scopes: string[] = [];
  let applyToR2 = true;
  try {
    const payload = await c.req.json().catch(() => ({}));
    clearR2 = !!payload?.clearR2;
    if (Array.isArray(payload?.scopes)) {
      scopes = payload.scopes.filter((value: unknown) => typeof value === 'string');
    }
    if (typeof payload?.applyToR2 === 'boolean') {
      applyToR2 = payload.applyToR2;
    }
  } catch {
    clearR2 = false;
    scopes = [];
    applyToR2 = true;
  }

  try {
    const existingProcess = await findExistingMoltbotProcess(sandbox);
    if (existingProcess) {
      console.log('Killing existing gateway process:', existingProcess.id);
      try {
        await existingProcess.kill();
      } catch (killErr) {
        console.error('Error killing process:', killErr);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (scopes.length === 0) {
      if (clearR2) {
        await mountR2Storage(sandbox, c.env);
      }

      const resetLocalCmd = 'rm -f /root/.clawdbot/clawdbot.json /root/.clawdbot/.last-sync /root/.openclaw/openclaw.json';
      const resetR2Cmd = 'rm -f /data/moltbot/.last-sync /data/moltbot/clawdbot/clawdbot.json /data/moltbot/clawdbot.json';
      const resetCmd = clearR2 ? `${resetLocalCmd} && ${resetR2Cmd}` : resetLocalCmd;
      const proc = await sandbox.startProcess(resetCmd);
      await waitForProcess(proc, 5000);
      const logs = await proc.getLogs();
      if (proc.exitCode && proc.exitCode !== 0) {
        return c.json({ success: false, error: logs.stderr || 'Reset failed' }, 500);
      }
    } else {
      let configText: string | null = null;
      try {
        const readProc = await sandbox.startProcess('cat /root/.clawdbot/clawdbot.json');
        await waitForProcess(readProc, 5000);
        const readLogs = await readProc.getLogs();
        if (!readProc.exitCode && readLogs.stdout?.trim()) {
          configText = readLogs.stdout;
        }
      } catch {
        configText = null;
      }

      if (!configText && c.env.MOLTBOT_BUCKET) {
        const object = await c.env.MOLTBOT_BUCKET.get(CLAWDBOT_CONFIG_KEY);
        if (object) {
          configText = await object.text();
        } else {
          const fallback = await c.env.MOLTBOT_BUCKET.get(WORKSPACE_CONFIG_KEY);
          if (fallback) {
            configText = await fallback.text();
          }
        }
      }

      if (!configText) {
        return c.json({ success: false, error: 'Gateway config not found' }, 404);
      }

      let config: Record<string, unknown>;
      try {
        config = JSON.parse(configText) as Record<string, unknown>;
      } catch {
        return c.json({ success: false, error: 'Gateway config is invalid' }, 400);
      }

      const nextConfig = JSON.parse(JSON.stringify(config)) as Record<string, any>;
      const isEmptyObject = (value: unknown) =>
        !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0;

      const cleanup = () => {
        if (isEmptyObject(nextConfig.models)) delete nextConfig.models;
        if (nextConfig.agents && isEmptyObject(nextConfig.agents.defaults)) {
          delete nextConfig.agents.defaults;
        }
        if (nextConfig.agents && isEmptyObject(nextConfig.agents)) delete nextConfig.agents;
        if (nextConfig.gateway && isEmptyObject(nextConfig.gateway)) delete nextConfig.gateway;
        if (nextConfig.browser && isEmptyObject(nextConfig.browser)) delete nextConfig.browser;
      };

      const applyScope = (scope: string) => {
        switch (scope) {
          case 'models.providers':
            if (nextConfig.models) delete nextConfig.models.providers;
            break;
          case 'agents.defaults.models':
            if (nextConfig.agents?.defaults) delete nextConfig.agents.defaults.models;
            break;
          case 'agents.defaults.model.primary':
            if (nextConfig.agents?.defaults?.model) {
              delete nextConfig.agents.defaults.model.primary;
              if (isEmptyObject(nextConfig.agents.defaults.model)) {
                delete nextConfig.agents.defaults.model;
              }
            }
            break;
          case 'gateway.auth':
            if (nextConfig.gateway?.auth) {
              delete nextConfig.gateway.auth;
            }
            break;
          case 'gateway.trustedProxies':
            if (nextConfig.gateway) {
              delete nextConfig.gateway.trustedProxies;
            }
            break;
          case 'messages':
            delete nextConfig.messages;
            break;
          case 'commands':
            delete nextConfig.commands;
            break;
          case 'channels':
            delete nextConfig.channels;
            break;
          case 'browser.profiles':
            if (nextConfig.browser) delete nextConfig.browser.profiles;
            break;
          case 'browser':
            delete nextConfig.browser;
            break;
          case 'meta':
            delete nextConfig.meta;
            break;
          default:
            break;
        }
      };

      scopes.forEach(applyScope);
      cleanup();

      const nextText = JSON.stringify(nextConfig, null, 2);
      const writeCmd = `set -e; mkdir -p /root/.clawdbot; cat <<'__MOLTBOT_JSON__' > /root/.clawdbot/clawdbot.json
${nextText}
__MOLTBOT_JSON__`;
      const writeProc = await sandbox.startProcess(writeCmd);
      await waitForProcess(writeProc, 5000);
      const writeLogs = await writeProc.getLogs();
      if (writeProc.exitCode && writeProc.exitCode !== 0) {
        return c.json({ success: false, error: writeLogs.stderr || 'Reset failed' }, 500);
      }

      if (applyToR2 && c.env.MOLTBOT_BUCKET) {
        await c.env.MOLTBOT_BUCKET.put(CLAWDBOT_CONFIG_KEY, nextText, {
          httpMetadata: { contentType: 'application/json' },
        });
      }
    }

    const bootPromise = ensureMoltbotGateway(sandbox, c.env).catch((err) => {
      console.error('Gateway reset failed:', err);
    });
    c.executionCtx.waitUntil(bootPromise);

    return c.json({
      success: true,
      message: scopes.length > 0
        ? 'Gateway config updated, new instance starting...'
        : clearR2
          ? 'Gateway config reset, R2 backup cleared, new instance starting...'
          : 'Gateway config reset, new instance starting...',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

// Mount admin API routes under /admin
api.route('/admin', adminApi);

export { api };
