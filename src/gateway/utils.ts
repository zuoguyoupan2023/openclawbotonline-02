/**
 * Shared utilities for gateway operations
 */

/**
 * Wait for a sandbox process to complete
 * 
 * @param proc - Process object with status property
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param pollIntervalMs - How often to check status (default 500ms)
 */
export async function waitForProcess(
  proc: { status: string }, 
  timeoutMs: number,
  pollIntervalMs: number = 500
): Promise<void> {
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);
  let attempts = 0;
  while (proc.status === 'running' && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    attempts++;
  }
}

export const CLI_BIN_CANDIDATES = ['openclawbot-online', 'openclaw', 'clawdbot'] as const;

export const buildCliCommand = (args: string) =>
  `if command -v openclawbot-online >/dev/null 2>&1; then openclawbot-online ${args}; elif command -v openclaw >/dev/null 2>&1; then openclaw ${args}; else clawdbot ${args}; fi`;

export const isCliCommand = (command: string) =>
  CLI_BIN_CANDIDATES.some(
    (bin) => command.includes(`${bin} devices`) || command.includes(`${bin} --version`)
  );

export const isGatewayCommand = (command: string) =>
  command.includes('start-moltbot.sh') ||
  CLI_BIN_CANDIDATES.some((bin) => command.includes(`${bin} gateway`));
