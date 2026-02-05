// API client for admin endpoints
// Authentication is handled by Cloudflare Access (JWT in cookies)

const API_BASE = '/api/admin';

export interface PendingDevice {
  requestId: string;
  deviceId: string;
  displayName?: string;
  platform?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  ts: number;
}

export interface PairedDevice {
  deviceId: string;
  displayName?: string;
  platform?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  createdAtMs: number;
  approvedAtMs: number;
}

export interface DeviceListResponse {
  pending: PendingDevice[];
  paired: PairedDevice[];
  raw?: string;
  stderr?: string;
  parseError?: string;
  error?: string;
}

export interface ApproveResponse {
  success: boolean;
  requestId: string;
  message?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface ApproveAllResponse {
  approved: string[];
  failed: Array<{ requestId: string; success: boolean; error?: string }>;
  message?: string;
  error?: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

async function apiRequest<T>(
  path: string,
  options: globalThis.RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  } as globalThis.RequestInit);

  if (response.status === 401) {
    throw new AuthError('Unauthorized - please log in via Cloudflare Access');
  }

  const data = await response.json() as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data;
}

export async function listDevices(): Promise<DeviceListResponse> {
  return apiRequest<DeviceListResponse>('/devices');
}

export async function approveDevice(requestId: string): Promise<ApproveResponse> {
  return apiRequest<ApproveResponse>(`/devices/${requestId}/approve`, {
    method: 'POST',
  });
}

export async function approveAllDevices(): Promise<ApproveAllResponse> {
  return apiRequest<ApproveAllResponse>('/devices/approve-all', {
    method: 'POST',
  });
}

export interface RestartGatewayResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface AiEnvSummaryResponse {
  baseUrls: string[];
  apiKeys: string[];
}

export interface AiEnvConfigResponse {
  baseUrls: Record<string, string | null>;
  apiKeys: Record<string, { isSet: boolean; source: 'env' | 'saved' | 'cleared' | null }>;
  primaryProvider: 'anthropic' | 'deepseek';
  primaryModel: 'deepseek-chat' | 'deepseek-reasoner' | null;
}

export interface AiEnvConfigUpdate {
  baseUrls?: Record<string, string | null>;
  apiKeys?: Record<string, string | null>;
  primaryProvider?: 'anthropic' | 'deepseek' | null;
  primaryModel?: 'deepseek-chat' | 'deepseek-reasoner' | null;
}

export async function restartGateway(): Promise<RestartGatewayResponse> {
  return apiRequest<RestartGatewayResponse>('/gateway/restart', {
    method: 'POST',
  });
}

export async function getAiEnvSummary(): Promise<AiEnvSummaryResponse> {
  return apiRequest<AiEnvSummaryResponse>('/ai/env');
}

export async function getAiEnvConfig(): Promise<AiEnvConfigResponse> {
  return apiRequest<AiEnvConfigResponse>('/ai/config');
}

export async function saveAiEnvConfig(payload: AiEnvConfigUpdate): Promise<AiEnvConfigResponse> {
  return apiRequest<AiEnvConfigResponse>('/ai/config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface StorageStatusResponse {
  configured: boolean;
  missing?: string[];
  lastSync: string | null;
  message: string;
}

export async function getStorageStatus(): Promise<StorageStatusResponse> {
  return apiRequest<StorageStatusResponse>('/storage');
}

export interface SyncResponse {
  success: boolean;
  message?: string;
  lastSync?: string;
  error?: string;
  details?: string;
}

export async function triggerSync(): Promise<SyncResponse> {
  return apiRequest<SyncResponse>('/storage/sync', {
    method: 'POST',
  });
}

export interface R2ObjectEntry {
  key: string;
  size: number;
  etag: string;
  uploaded: string;
}

export interface R2ListResponse {
  prefix: string;
  cursor: string | null;
  nextCursor: string | null;
  truncated: boolean;
  objects: R2ObjectEntry[];
}

export interface R2DeleteResponse {
  success: boolean;
  key?: string;
}

export interface R2DeletePrefixResponse {
  success: boolean;
  prefix: string;
  deletedCount: number;
}

export interface R2UploadResponse {
  success: boolean;
  key: string;
}

export interface R2ObjectContentResponse {
  key: string;
  contentType: string | null;
  content: string;
}

export async function listR2Objects(params: {
  prefix: string;
  cursor?: string | null;
  limit?: number;
}): Promise<R2ListResponse> {
  const query = new URLSearchParams({ prefix: params.prefix });
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  return apiRequest<R2ListResponse>(`/r2/list?${query.toString()}`);
}

export async function deleteR2Object(key: string): Promise<R2DeleteResponse> {
  const query = new URLSearchParams({ key });
  return apiRequest<R2DeleteResponse>(`/r2/object?${query.toString()}`, {
    method: 'DELETE',
  });
}

export async function deleteR2Prefix(prefix: string): Promise<R2DeletePrefixResponse> {
  const query = new URLSearchParams({ prefix });
  return apiRequest<R2DeletePrefixResponse>(`/r2/prefix?${query.toString()}`, {
    method: 'DELETE',
  });
}

export async function getR2ObjectContent(key: string): Promise<R2ObjectContentResponse> {
  const query = new URLSearchParams({ key });
  return apiRequest<R2ObjectContentResponse>(`/r2/object?${query.toString()}`);
}

export async function uploadR2Object(prefix: string, file: File): Promise<R2UploadResponse> {
  const form = new FormData();
  form.append('prefix', prefix);
  form.append('file', file);
  const response = await fetch(`${API_BASE}/r2/upload`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (response.status === 401) {
    throw new AuthError('Unauthorized - please log in via Cloudflare Access');
  }
  const data = await response.json() as R2UploadResponse & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }
  return data;
}
