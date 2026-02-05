import type { Sandbox, Process } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { MOLTBOT_PORT, STARTUP_TIMEOUT_MS } from '../config';
import { buildEnvVars } from './env';
import { mountR2Storage } from './r2';

const AI_ENV_CONFIG_KEY = 'workspace-core/config/ai-env.json';
const AI_BASE_URL_KEYS = ['AI_GATEWAY_BASE_URL', 'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'DEEPSEEK_BASE_URL'] as const;
const AI_API_KEY_KEYS = ['AI_GATEWAY_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY'] as const;
const AI_PRIMARY_PROVIDERS = ['anthropic', 'deepseek'] as const;
const AI_DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const;

type AiEnvConfig = {
  baseUrls?: Partial<Record<(typeof AI_BASE_URL_KEYS)[number], string | null>>;
  apiKeys?: Partial<Record<(typeof AI_API_KEY_KEYS)[number], string | null>>;
  primaryProvider?: (typeof AI_PRIMARY_PROVIDERS)[number] | null;
  primaryModel?: (typeof AI_DEEPSEEK_MODELS)[number] | null;
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

const applyAiOverrides = (env: MoltbotEnv, config: AiEnvConfig): MoltbotEnv => {
  const nextEnv = { ...env } as MoltbotEnv;
  const envRecord = nextEnv as unknown as Record<string, string | undefined>;
  if (typeof config.primaryProvider === 'string' && AI_PRIMARY_PROVIDERS.includes(config.primaryProvider)) {
    envRecord.AI_PRIMARY_PROVIDER = config.primaryProvider;
  } else if (config.primaryProvider === null) {
    delete envRecord.AI_PRIMARY_PROVIDER;
  }
  if (typeof config.primaryModel === 'string' && AI_DEEPSEEK_MODELS.includes(config.primaryModel)) {
    envRecord.AI_PRIMARY_MODEL = config.primaryModel;
  } else if (config.primaryModel === null) {
    delete envRecord.AI_PRIMARY_MODEL;
  }
  AI_BASE_URL_KEYS.forEach((key) => {
    if (!config.baseUrls || !(key in config.baseUrls)) return;
    const value = config.baseUrls[key];
    if (value === null) {
      delete envRecord[key];
    } else if (typeof value === 'string' && value.trim().length > 0) {
      envRecord[key] = value.trim();
    }
  });
  AI_API_KEY_KEYS.forEach((key) => {
    if (!config.apiKeys || !(key in config.apiKeys)) return;
    const value = config.apiKeys[key];
    if (value === null) {
      delete envRecord[key];
    } else if (typeof value === 'string' && value.trim().length > 0) {
      envRecord[key] = value.trim();
    }
  });
  return nextEnv;
};

/**
 * Find an existing Moltbot gateway process
 * 
 * @param sandbox - The sandbox instance
 * @returns The process if found and running/starting, null otherwise
 */
export async function findExistingMoltbotProcess(sandbox: Sandbox): Promise<Process | null> {
  try {
    const processes = await sandbox.listProcesses();
    for (const proc of processes) {
      // Only match the gateway process, not CLI commands like "clawdbot devices list"
      // Note: CLI is still named "clawdbot" until upstream renames it
      const isGatewayProcess = 
        proc.command.includes('start-moltbot.sh') ||
        proc.command.includes('openclaw gateway') ||
        proc.command.includes('clawdbot gateway');
      const isCliCommand = 
        proc.command.includes('openclaw devices') ||
        proc.command.includes('openclaw --version') ||
        proc.command.includes('clawdbot devices') ||
        proc.command.includes('clawdbot --version');
      
      if (isGatewayProcess && !isCliCommand) {
        if (proc.status === 'starting' || proc.status === 'running') {
          return proc;
        }
      }
    }
  } catch (e) {
    console.log('Could not list processes:', e);
  }
  return null;
}

/**
 * Ensure the Moltbot gateway is running
 * 
 * This will:
 * 1. Mount R2 storage if configured
 * 2. Check for an existing gateway process
 * 3. Wait for it to be ready, or start a new one
 * 
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @returns The running gateway process
 */
export async function ensureMoltbotGateway(sandbox: Sandbox, env: MoltbotEnv): Promise<Process> {
  // Mount R2 storage for persistent data (non-blocking if not configured)
  // R2 is used as a backup - the startup script will restore from it on boot
  await mountR2Storage(sandbox, env);

  // Check if Moltbot is already running or starting
  const existingProcess = await findExistingMoltbotProcess(sandbox);
  if (existingProcess) {
    console.log('Found existing Moltbot process:', existingProcess.id, 'status:', existingProcess.status);

    // Always use full startup timeout - a process can be "running" but not ready yet
    // (e.g., just started by another concurrent request). Using a shorter timeout
    // causes race conditions where we kill processes that are still initializing.
    try {
      console.log('Waiting for Moltbot gateway on port', MOLTBOT_PORT, 'timeout:', STARTUP_TIMEOUT_MS);
      await existingProcess.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
      console.log('Moltbot gateway is reachable');
      return existingProcess;
    } catch (e) {
      // Timeout waiting for port - process is likely dead or stuck, kill and restart
      console.log('Existing process not reachable after full timeout, killing and restarting...');
      try {
        await existingProcess.kill();
      } catch (killError) {
        console.log('Failed to kill process:', killError);
      }
    }
  }

  // Start a new Moltbot gateway
  console.log('Starting new Moltbot gateway...');
  const aiConfig = await readAiEnvConfig(env.MOLTBOT_BUCKET);
  const mergedEnv = applyAiOverrides(env, aiConfig);
  const envVars = buildEnvVars(mergedEnv);
  const command = '/usr/local/bin/start-moltbot.sh';

  console.log('Starting process with command:', command);
  console.log('Environment vars being passed:', Object.keys(envVars));

  let process: Process;
  try {
    process = await sandbox.startProcess(command, {
      env: Object.keys(envVars).length > 0 ? envVars : undefined,
    });
    console.log('Process started with id:', process.id, 'status:', process.status);
  } catch (startErr) {
    console.error('Failed to start process:', startErr);
    throw startErr;
  }

  // Wait for the gateway to be ready
  try {
    console.log('[Gateway] Waiting for Moltbot gateway to be ready on port', MOLTBOT_PORT);
    await process.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
    console.log('[Gateway] Moltbot gateway is ready!');

    const logs = await process.getLogs();
    if (logs.stdout) console.log('[Gateway] stdout:', logs.stdout);
    if (logs.stderr) console.log('[Gateway] stderr:', logs.stderr);
  } catch (e) {
    console.error('[Gateway] waitForPort failed:', e);
    try {
      const logs = await process.getLogs();
      console.error('[Gateway] startup failed. Stderr:', logs.stderr);
      console.error('[Gateway] startup failed. Stdout:', logs.stdout);
      throw new Error(`Moltbot gateway failed to start. Stderr: ${logs.stderr || '(empty)'}`);
    } catch (logErr) {
      console.error('[Gateway] Failed to get logs:', logErr);
      throw e;
    }
  }

  // Verify gateway is actually responding
  console.log('[Gateway] Verifying gateway health...');
  
  return process;
}
