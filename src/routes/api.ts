import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { createAccessMiddleware } from '../auth';
import { ensureMoltbotGateway, findExistingMoltbotProcess, mountR2Storage, syncToR2, waitForProcess } from '../gateway';
import { decryptProviderKeys, getAiConfigOrEmpty, readAiConfig, redactAiConfig, upsertAiConfig } from '../ai/config';
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
const AI_TEST_TIMEOUT_MS = 10000;

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

const normalizeText = (value: unknown) => String(value ?? '').trim();

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await fetch(input, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    return result;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
};

const testOpenAi = async (baseUrl: string, apiKey: string, model?: string | null) => {
  const urlBase = baseUrl.replace(/\/+$/, '');
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (model) {
    const response = await fetchWithTimeout(
      `${urlBase}/chat/completions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      },
      AI_TEST_TIMEOUT_MS
    );
    return response;
  }
  const response = await fetchWithTimeout(
    `${urlBase}/models`,
    {
      method: 'GET',
      headers,
    },
    AI_TEST_TIMEOUT_MS
  );
  return response;
};

const testAnthropic = async (baseUrl: string, apiKey: string, model?: string | null) => {
  if (!model) {
    throw new Error('Model is required for Anthropic test');
  }
  const urlBase = baseUrl.replace(/\/+$/, '');
  const response = await fetchWithTimeout(
    `${urlBase}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    },
    AI_TEST_TIMEOUT_MS
  );
  return response;
};

const performAiTest = async (payload: {
  type: string;
  baseUrl: string;
  apiKey: string;
  model?: string | null;
}) => {
  if (payload.type === 'anthropic') {
    return testAnthropic(payload.baseUrl, payload.apiKey, payload.model);
  }
  return testOpenAi(payload.baseUrl, payload.apiKey, payload.model);
};

const restartGatewayProcess = async (c: Context<AppEnv>) => {
  const sandbox = c.get('sandbox');
  const existingProcess = await findExistingMoltbotProcess(sandbox);
  if (existingProcess) {
    try {
      await existingProcess.kill();
    } catch (killErr) {
      console.error('Error killing process:', killErr);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  const bootPromise = ensureMoltbotGateway(sandbox, c.env).catch((err) => {
    console.error('Gateway restart failed:', err);
  });
  c.executionCtx.waitUntil(bootPromise);
  return {
    success: true,
    message: existingProcess
      ? 'Gateway process killed, new instance starting...'
      : 'No existing process found, starting new instance...',
    previousProcessId: existingProcess?.id,
  };
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

adminApi.get('/ai/config', async (c) => {
  const config = await getAiConfigOrEmpty(c.env);
  return c.json({
    config: redactAiConfig(config),
    hasMasterKey: !!c.env.AI_CONFIG_MASTER_KEY,
  });
});

adminApi.put('/ai/config', async (c) => {
  try {
    const body = await c.req.json();
    const config = await upsertAiConfig(c.env, body);
    return c.json({
      config: redactAiConfig(config),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 400);
  }
});

adminApi.post('/ai/test', async (c) => {
  try {
    const body = await c.req.json();
    const config = await getAiConfigOrEmpty(c.env);
    const providerId = normalizeText(body.providerId);
    const provider = providerId
      ? config.providers.find((item) => item.id === providerId)
      : null;
    const type = normalizeText(body.type || provider?.type);
    const baseUrl = normalizeText(body.baseUrl || provider?.baseUrl);
    const model = normalizeText(body.model || config.primaryModel || provider?.models?.[0]) || null;
    let apiKey = normalizeText(body.apiKey);
    if (!apiKey && provider) {
      const keys = await decryptProviderKeys(c.env, provider);
      apiKey = keys.find((value) => value.trim().length > 0) ?? '';
    }
    if (!type || !baseUrl || !apiKey) {
      return c.json({ error: 'type, baseUrl, apiKey are required' }, 400);
    }
    const response = await performAiTest({ type, baseUrl, apiKey, model });
    const ok = response.ok;
    let text: string | undefined;
    try {
      text = await response.text();
    } catch {
      text = undefined;
    }
    return c.json({
      ok,
      status: response.status,
      statusText: response.statusText,
      body: text?.slice(0, 2000),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

adminApi.post('/ai/activate', async (c) => {
  try {
    const body = await c.req.json();
    const config = await upsertAiConfig(c.env, {
      primaryProviderId: body.primaryProviderId,
      primaryModel: body.primaryModel,
      fallbackOrder: body.fallbackOrder,
    });
    const restart = await restartGatewayProcess(c);
    return c.json({
      config: redactAiConfig(config),
      restart,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 400);
  }
});

adminApi.post('/ai/fallback/verify', async (c) => {
  try {
    const config = await readAiConfig(c.env);
    if (!config) {
      return c.json({ results: [], error: 'No AI config found' }, 400);
    }
    const results = [];
    for (const provider of config.providers) {
      if (!provider.enabled) continue;
      try {
        const keys = await decryptProviderKeys(c.env, provider);
        const apiKey = keys.find((value) => value.trim().length > 0);
        if (!apiKey) {
          results.push({ id: provider.id, ok: false, error: 'No API key' });
          continue;
        }
        const model = provider.models?.[0] ?? null;
        const response = await performAiTest({
          type: provider.type,
          baseUrl: provider.baseUrl,
          apiKey,
          model,
        });
        results.push({
          id: provider.id,
          ok: response.ok,
          status: response.status,
        });
      } catch (err) {
        results.push({
          id: provider.id,
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    return c.json({ results });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
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

// POST /api/admin/gateway/restart - Kill the current gateway and start a new one
adminApi.post('/gateway/restart', async (c) => {
  try {
    const result = await restartGatewayProcess(c);
    return c.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// Mount admin API routes under /admin
api.route('/admin', adminApi);

export { api };
