import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { R2_MOUNT_PATH } from '../config';
import { mountR2Storage } from './r2';
import { waitForProcess } from './utils';

export interface SyncResult {
  success: boolean;
  lastSync?: string;
  error?: string;
  details?: string;
}

export interface RestoreResult {
  success: boolean;
  lastSync?: string;
  error?: string;
  details?: string;
}

const RESTORE_MARKER_PATH = '/root/.clawdbot/.restored-from-r2';
const MANIFEST_LOCAL_PATH = '/root/.openclaw/.sync-manifest.json';
const MANIFEST_R2_PATH = `${R2_MOUNT_PATH}/manifest.json`;

const hasRestoreMarker = async (sandbox: Sandbox) => {
  try {
    const proc = await sandbox.startProcess(`test -f ${RESTORE_MARKER_PATH} && echo "restored"`);
    await waitForProcess(proc, 5000);
    const logs = await proc.getLogs();
    return !!logs.stdout?.includes('restored');
  } catch {
    return false;
  }
};

const runSandboxCommand = async (sandbox: Sandbox, command: string, timeout = 5000) => {
  const proc = await sandbox.startProcess(command);
  await waitForProcess(proc, timeout);
  const logs = await proc.getLogs();
  return { exitCode: proc.exitCode ?? 0, stdout: logs.stdout ?? '', stderr: logs.stderr ?? '' };
};

const resolveConfigDir = async (sandbox: Sandbox) => {
  try {
    const checkOpenclaw = await sandbox.startProcess('test -f /root/.openclaw/openclaw.json');
    await waitForProcess(checkOpenclaw, 5000);
    if (checkOpenclaw.exitCode === 0) return '/root/.openclaw';
    const checkLegacy = await sandbox.startProcess('test -f /root/.clawdbot/clawdbot.json');
    await waitForProcess(checkLegacy, 5000);
    if (checkLegacy.exitCode === 0) return '/root/.clawdbot';
    return null;
  } catch {
    return null;
  }
};

const buildManifestCommand = (configDir: string) => {
  const script = [
    "const fs = require('fs')",
    "const path = require('path')",
    "const configDir = process.env.CONFIG_DIR",
    "const skillsDir = process.env.SKILLS_DIR",
    "const workspaceDir = process.env.WORKSPACE_DIR",
    "const manifestPath = process.env.MANIFEST_PATH",
    "const entries = []",
    "const workspaceRootFiles = new Set(['IDENTITY.md', 'USER.md', 'SOUL.md', 'MEMORY.md'])",
    "const normalize = (value) => value.split(path.sep).join('/')",
    "const addEntry = (baseDir, prefix, filePath) => {",
    "  const stat = fs.statSync(filePath)",
    "  if (!stat.isFile()) return",
    "  const rel = normalize(path.relative(baseDir, filePath))",
    "  entries.push({ path: prefix + '/' + rel, size: stat.size, mtime: Math.floor(stat.mtimeMs) })",
    "}",
    "const walk = (baseDir, currentDir, prefix, filter) => {",
    "  if (!fs.existsSync(currentDir)) return",
    "  const items = fs.readdirSync(currentDir)",
    "  for (const item of items) {",
    "    const full = path.join(currentDir, item)",
    "    const rel = normalize(path.relative(baseDir, full))",
    "    const stat = fs.statSync(full)",
    "    if (stat.isDirectory()) {",
    "      if (filter && !filter(rel, true)) continue",
    "      walk(baseDir, full, prefix, filter)",
    "    } else if (stat.isFile()) {",
    "      if (filter && !filter(rel, false)) continue",
    "      addEntry(baseDir, prefix, full)",
    "    }",
    "  }",
    "}",
    "const configFilter = (rel, isDir) => {",
    "  if (isDir) return true",
    "  if (rel.endsWith('.lock') || rel.endsWith('.log') || rel.endsWith('.tmp')) return false",
    "  return true",
    "}",
    "const workspaceFilter = (rel, isDir) => {",
    "  if (!rel) return true",
    "  if (isDir) {",
    "    return rel === 'memory' || rel.startsWith('memory/') || rel === 'assets' || rel.startsWith('assets/')",
    "  }",
    "  if (workspaceRootFiles.has(rel)) return true",
    "  return rel.startsWith('memory/') || rel.startsWith('assets/')",
    "}",
    "walk(configDir, configDir, 'openclaw', configFilter)",
    "walk(skillsDir, skillsDir, 'skills')",
    "walk(workspaceDir, workspaceDir, 'workspace', workspaceFilter)",
    "entries.sort((a, b) => a.path.localeCompare(b.path))",
    "fs.mkdirSync(path.dirname(manifestPath), { recursive: true })",
    "fs.writeFileSync(manifestPath, JSON.stringify({ entries }), 'utf8')",
    "process.stdout.write(JSON.stringify({ entries }))",
  ].join('\n');
  return `CONFIG_DIR=${configDir} WORKSPACE_DIR=/root/clawd SKILLS_DIR=/root/clawd/skills MANIFEST_PATH=${MANIFEST_LOCAL_PATH} node << 'EOF'\n${script}\nEOF`;
};

export async function restoreFromR2(sandbox: Sandbox, env: MoltbotEnv): Promise<RestoreResult> {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.CF_ACCOUNT_ID) {
    return { success: false, error: 'R2 storage is not configured' };
  }

  const mounted = await mountR2Storage(sandbox, env);
  if (!mounted) {
    return { success: false, error: 'Failed to mount R2 storage' };
  }

  let configSource: 'openclaw' | 'openclaw-legacy' | 'clawdbot' | 'legacy' | null = null;
  try {
    const configProc = await sandbox.startProcess(
      `if [ -f ${R2_MOUNT_PATH}/openclaw/openclaw.json ]; then echo "openclaw"; elif [ -f ${R2_MOUNT_PATH}/openclaw/clawdbot.json ]; then echo "openclaw-legacy"; elif [ -f ${R2_MOUNT_PATH}/clawdbot/clawdbot.json ]; then echo "clawdbot"; elif [ -f ${R2_MOUNT_PATH}/clawdbot.json ]; then echo "legacy"; fi`
    );
    await waitForProcess(configProc, 5000);
    const configLogs = await configProc.getLogs();
    const output = (configLogs.stdout ?? '').trim();
    if (
      output === 'openclaw' ||
      output === 'openclaw-legacy' ||
      output === 'clawdbot' ||
      output === 'legacy'
    ) {
      configSource = output as 'openclaw' | 'openclaw-legacy' | 'clawdbot' | 'legacy';
    }
  } catch {
    configSource = null;
  }

  if (!configSource) {
    return { success: false, error: 'No backup found in R2' };
  }

  const restoreCmdParts = [
    'set -e',
    'mkdir -p /root/.clawdbot /root/clawd/skills /root/clawd',
  ];
  if (configSource === 'openclaw' || configSource === 'openclaw-legacy') {
    restoreCmdParts.push(
      `rsync -r --no-times --delete ${R2_MOUNT_PATH}/openclaw/ /root/.clawdbot/`,
      `if [ -f /root/.clawdbot/openclaw.json ] && [ ! -f /root/.clawdbot/clawdbot.json ]; then mv /root/.clawdbot/openclaw.json /root/.clawdbot/clawdbot.json; fi`
    );
  } else if (configSource === 'clawdbot') {
    restoreCmdParts.push(`rsync -r --no-times --delete ${R2_MOUNT_PATH}/clawdbot/ /root/.clawdbot/`);
  } else {
    restoreCmdParts.push(`cp -a ${R2_MOUNT_PATH}/clawdbot.json /root/.clawdbot/clawdbot.json`);
  }
  restoreCmdParts.push(
    `if [ -d ${R2_MOUNT_PATH}/skills ]; then rsync -r --no-times --delete ${R2_MOUNT_PATH}/skills/ /root/clawd/skills/; fi`,
    `if [ -d ${R2_MOUNT_PATH}/workspace ]; then rsync -r --no-times --delete --include='IDENTITY.md' --include='USER.md' --include='SOUL.md' --include='MEMORY.md' --include='memory/' --include='memory/***' --include='assets/' --include='assets/***' --exclude='*' ${R2_MOUNT_PATH}/workspace/ /root/clawd/; elif [ -d ${R2_MOUNT_PATH}/workspace-core ]; then rsync -r --no-times --delete --include='IDENTITY.md' --include='USER.md' --include='SOUL.md' --include='MEMORY.md' --include='memory/' --include='memory/***' --include='assets/' --include='assets/***' --exclude='*' ${R2_MOUNT_PATH}/workspace-core/ /root/clawd/; fi`,
    `if [ -f ${R2_MOUNT_PATH}/.last-sync ]; then cp -f ${R2_MOUNT_PATH}/.last-sync /root/.clawdbot/.last-sync; fi`,
    `date -Iseconds > ${RESTORE_MARKER_PATH}`
  );

  try {
    const restoreProc = await sandbox.startProcess(restoreCmdParts.join('; '));
    await waitForProcess(restoreProc, 30000);
  } catch (err) {
    return {
      success: false,
      error: 'Restore failed',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  const manifestConfigDir = await resolveConfigDir(sandbox);
  if (manifestConfigDir) {
    await runSandboxCommand(sandbox, buildManifestCommand(manifestConfigDir), 20000);
    const r2Manifest = await runSandboxCommand(
      sandbox,
      `cat ${MANIFEST_R2_PATH} 2>/dev/null || echo ""`
    );
    if (r2Manifest.stdout.trim()) {
      await runSandboxCommand(
        sandbox,
        `mkdir -p /root/.openclaw; cp -f ${MANIFEST_R2_PATH} ${MANIFEST_LOCAL_PATH}`
      );
    } else {
      await runSandboxCommand(
        sandbox,
        `if [ -f ${MANIFEST_LOCAL_PATH} ]; then cp -f ${MANIFEST_LOCAL_PATH} ${MANIFEST_R2_PATH}; fi`
      );
    }
  }

  let lastSync: string | undefined;
  try {
    const timestampProc = await sandbox.startProcess(`cat ${R2_MOUNT_PATH}/.last-sync 2>/dev/null || echo ""`);
    await waitForProcess(timestampProc, 5000);
    const timestampLogs = await timestampProc.getLogs();
    const timestamp = timestampLogs.stdout?.trim();
    if (timestamp && timestamp.match(/^\d{4}-\d{2}-\d{2}/)) {
      lastSync = timestamp;
    }
  } catch {
    lastSync = undefined;
  }

  return { success: true, lastSync };
}

/**
 * Sync moltbot config from container to R2 for persistence.
 * 
 * This function:
 * 1. Mounts R2 if not already mounted
 * 2. Verifies source has critical files (prevents overwriting good backup with empty data)
 * 3. Runs rsync to copy config to R2
 * 4. Writes a timestamp file for tracking
 * 
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @returns SyncResult with success status and optional error details
 */
export async function syncToR2(sandbox: Sandbox, env: MoltbotEnv): Promise<SyncResult> {
  // Check if R2 is configured
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.CF_ACCOUNT_ID) {
    return { success: false, error: 'R2 storage is not configured' };
  }

  // Mount R2 if not already mounted
  const mounted = await mountR2Storage(sandbox, env);
  if (!mounted) {
    return { success: false, error: 'Failed to mount R2 storage' };
  }

  const restored = await hasRestoreMarker(sandbox);
  if (!restored) {
    return { success: false, error: 'Restore required before backup' };
  }

  // Sanity check: verify source has critical files before syncing
  // This prevents accidentally overwriting a good backup with empty/corrupted data
  let configDir = '/root/.openclaw';
  try {
    const checkProc = await sandbox.startProcess(
      'if [ -f /root/.openclaw/openclaw.json ]; then echo "openclaw"; elif [ -f /root/.clawdbot/clawdbot.json ]; then echo "clawdbot"; fi'
    );
    await waitForProcess(checkProc, 5000);
    const checkLogs = await checkProc.getLogs();
    const output = checkLogs.stdout?.trim() ?? '';
    if (output === 'openclaw') {
      configDir = '/root/.openclaw';
    } else if (output === 'clawdbot') {
      configDir = '/root/.clawdbot';
    } else {
      return {
        success: false,
        error: 'Sync aborted: no config file found',
        details: 'Neither openclaw.json nor clawdbot.json found in config directory.',
      };
    }
  } catch (err) {
    return {
      success: false,
      error: 'Failed to verify source files',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  const manifestResult = await runSandboxCommand(sandbox, buildManifestCommand(configDir), 20000);
  if (manifestResult.exitCode === 0) {
    const localManifest = await runSandboxCommand(
      sandbox,
      `cat ${MANIFEST_LOCAL_PATH} 2>/dev/null || echo ""`
    );
    const r2Manifest = await runSandboxCommand(
      sandbox,
      `cat ${MANIFEST_R2_PATH} 2>/dev/null || echo ""`
    );
    const localValue = localManifest.stdout.trim();
    const r2Value = r2Manifest.stdout.trim();
    if (localValue && r2Value && localValue === r2Value) {
      const lastSyncResult = await runSandboxCommand(
        sandbox,
        `cat ${R2_MOUNT_PATH}/.last-sync 2>/dev/null || echo ""`
      );
      const lastSync = lastSyncResult.stdout.trim();
      if (lastSync && lastSync.match(/^\d{4}-\d{2}-\d{2}/)) {
        return { success: true, lastSync };
      }
      return { success: true };
    }
  }

  const syncCmd = `rsync -r --no-times --copy-links --delete --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' ${configDir}/ ${R2_MOUNT_PATH}/openclaw/ && rsync -r --no-times --delete /root/clawd/skills/ ${R2_MOUNT_PATH}/skills/ && rsync -r --no-times --delete --include='IDENTITY.md' --include='USER.md' --include='SOUL.md' --include='MEMORY.md' --include='memory/' --include='memory/***' --include='assets/' --include='assets/***' --exclude='*' /root/clawd/ ${R2_MOUNT_PATH}/workspace/ && if [ -f ${MANIFEST_LOCAL_PATH} ]; then cp -f ${MANIFEST_LOCAL_PATH} ${MANIFEST_R2_PATH}; fi && date -Iseconds > ${R2_MOUNT_PATH}/.last-sync`;
  
  try {
    const proc = await sandbox.startProcess(syncCmd);
    await waitForProcess(proc, 30000); // 30 second timeout for sync

    // Check for success by reading the timestamp file
    // (process status may not update reliably in sandbox API)
    // Note: backup structure is ${R2_MOUNT_PATH}/openclaw/ and ${R2_MOUNT_PATH}/skills/
    const timestampProc = await sandbox.startProcess(`cat ${R2_MOUNT_PATH}/.last-sync`);
    await waitForProcess(timestampProc, 5000);
    const timestampLogs = await timestampProc.getLogs();
    const lastSync = timestampLogs.stdout?.trim();
    
    if (lastSync && lastSync.match(/^\d{4}-\d{2}-\d{2}/)) {
      return { success: true, lastSync };
    } else {
      const logs = await proc.getLogs();
      return {
        success: false,
        error: 'Sync failed',
        details: logs.stderr || logs.stdout || 'No timestamp file created',
      };
    }
  } catch (err) {
    return { 
      success: false, 
      error: 'Sync error',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
