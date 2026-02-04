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

  let r2HasSync = false;
  let localHasSync = false;
  let localHasUser = false;
  let localHasSoul = false;
  let localHasMemory = false;

  try {
    const r2SyncProc = await sandbox.startProcess(`test -f ${R2_MOUNT_PATH}/.last-sync && echo "r2"`);
    await waitForProcess(r2SyncProc, 5000);
    const r2SyncLogs = await r2SyncProc.getLogs();
    r2HasSync = !!r2SyncLogs.stdout?.includes('r2');
  } catch {
    r2HasSync = false;
  }

  try {
    const localSyncProc = await sandbox.startProcess('test -f /root/.clawdbot/.last-sync && echo "local"');
    await waitForProcess(localSyncProc, 5000);
    const localSyncLogs = await localSyncProc.getLogs();
    localHasSync = !!localSyncLogs.stdout?.includes('local');
  } catch {
    localHasSync = false;
  }

  try {
    const userProc = await sandbox.startProcess('test -f /root/clawd/USER.md && echo "user"');
    await waitForProcess(userProc, 5000);
    const userLogs = await userProc.getLogs();
    localHasUser = !!userLogs.stdout?.includes('user');
  } catch {
    localHasUser = false;
  }

  try {
    const soulProc = await sandbox.startProcess('test -f /root/clawd/SOUL.md && echo "soul"');
    await waitForProcess(soulProc, 5000);
    const soulLogs = await soulProc.getLogs();
    localHasSoul = !!soulLogs.stdout?.includes('soul');
  } catch {
    localHasSoul = false;
  }

  try {
    const memoryProc = await sandbox.startProcess('test -f /root/clawd/MEMORY.md && echo "memory"');
    await waitForProcess(memoryProc, 5000);
    const memoryLogs = await memoryProc.getLogs();
    localHasMemory = !!memoryLogs.stdout?.includes('memory');
  } catch {
    localHasMemory = false;
  }

  if (r2HasSync && (!localHasSync || !localHasUser || !localHasSoul || !localHasMemory)) {
    const restoreCmd = `set -e; mkdir -p /root/.clawdbot /root/clawd/skills /root/clawd; if [ -d ${R2_MOUNT_PATH}/clawdbot ]; then rsync -r --no-times --delete ${R2_MOUNT_PATH}/clawdbot/ /root/.clawdbot/; fi; if [ -d ${R2_MOUNT_PATH}/skills ]; then rsync -r --no-times --delete ${R2_MOUNT_PATH}/skills/ /root/clawd/skills/; fi; if [ -d ${R2_MOUNT_PATH}/workspace-core ]; then rsync -r --no-times --delete --exclude='/.git/' --exclude='/.git/**' --exclude='/skills/' --exclude='/skills/**' --exclude='/node_modules/' --exclude='/node_modules/**' ${R2_MOUNT_PATH}/workspace-core/ /root/clawd/; fi; cp -f ${R2_MOUNT_PATH}/.last-sync /root/.clawdbot/.last-sync`;
    try {
      const restoreProc = await sandbox.startProcess(restoreCmd);
      await waitForProcess(restoreProc, 30000);
    } catch (err) {
      return {
        success: false,
        error: 'Restore failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  // Sanity check: verify source has critical files before syncing
  // This prevents accidentally overwriting a good backup with empty/corrupted data
  try {
    const checkProc = await sandbox.startProcess('test -f /root/.clawdbot/clawdbot.json && echo "ok"');
    await waitForProcess(checkProc, 5000);
    const checkLogs = await checkProc.getLogs();
    if (!checkLogs.stdout?.includes('ok')) {
      return { 
        success: false, 
        error: 'Sync aborted: source missing clawdbot.json',
        details: 'The local config directory is missing critical files. This could indicate corruption or an incomplete setup.',
      };
    }
  } catch (err) {
    return { 
      success: false, 
      error: 'Failed to verify source files',
      details: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  // Run rsync to backup config to R2
  // Note: Use --no-times because s3fs doesn't support setting timestamps
  const syncCmd = `rsync -r --no-times --delete --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' /root/.clawdbot/ ${R2_MOUNT_PATH}/clawdbot/ && rsync -r --no-times --delete /root/clawd/skills/ ${R2_MOUNT_PATH}/skills/ && rsync -r --no-times --delete --exclude='/.git/' --exclude='/.git/**' --exclude='/skills/' --exclude='/skills/**' --exclude='/node_modules/' --exclude='/node_modules/**' /root/clawd/ ${R2_MOUNT_PATH}/workspace-core/ && date -Iseconds > ${R2_MOUNT_PATH}/.last-sync`;
  
  try {
    const proc = await sandbox.startProcess(syncCmd);
    await waitForProcess(proc, 30000); // 30 second timeout for sync

    // Check for success by reading the timestamp file
    // (process status may not update reliably in sandbox API)
    // Note: backup structure is ${R2_MOUNT_PATH}/clawdbot/ and ${R2_MOUNT_PATH}/skills/
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
