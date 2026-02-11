/**
 * Configuration constants for Moltbot Sandbox
 */

/** Port that the Moltbot gateway listens on inside the container */
export const MOLTBOT_PORT = 18789;

/** Maximum time to wait for Moltbot to start (3 minutes) */
export const STARTUP_TIMEOUT_MS = 180_000;

/** Mount path for R2 persistent storage inside the container */
export const R2_MOUNT_PATH = '/data/moltbot';

const R2_BUCKET_SUFFIXES = [
  'shu',
  'niu',
  'hu',
  'tu',
  'long',
  'she',
  'ma',
  'yang',
  'hou',
  'ji',
  'gou',
  'zhu',
];

let cachedDefaultBucketName: string | null = null;

const formatDate = (value: Date): string => {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const buildDefaultBucketName = (): string => {
  const datePart = formatDate(new Date());
  const suffix = R2_BUCKET_SUFFIXES[Math.floor(Math.random() * R2_BUCKET_SUFFIXES.length)];
  return `openclaw-${datePart}-${suffix}`;
};

export function getR2BucketName(env?: { R2_BUCKET_NAME?: string }): string {
  if (env?.R2_BUCKET_NAME) {
    return env.R2_BUCKET_NAME;
  }
  if (!cachedDefaultBucketName) {
    cachedDefaultBucketName = buildDefaultBucketName();
  }
  return cachedDefaultBucketName;
}
