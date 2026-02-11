// API client for admin endpoints
// Authentication is handled by Cloudflare Access (JWT in cookies)

const API_BASE = '/api/admin';
const PUBLIC_API_BASE = '/api';

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
    throw new AuthError('Unauthorized - please log in');
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

export interface GatewayLogsResponse {
  ok: boolean;
  processId?: string;
  status?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface AiEnvSummaryResponse {
  baseUrls: string[];
  apiKeys: string[];
}

export interface AiEnvConfigResponse {
  baseUrls: Record<string, string | null>;
  apiKeys: Record<string, { isSet: boolean; source: 'env' | 'saved' | 'cleared' | null }>;
  primaryProvider: string | null;
}

export interface AiEnvConfigUpdate {
  baseUrls?: Record<string, string | null>;
  apiKeys?: Record<string, string | null>;
  primaryProvider?: string | null;
}

export async function restartGateway(): Promise<RestartGatewayResponse> {
  return apiRequest<RestartGatewayResponse>('/gateway/restart', {
    method: 'POST',
  });
}

export async function getGatewayLogs(): Promise<GatewayLogsResponse> {
  return apiRequest<GatewayLogsResponse>('/gateway/logs');
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

export interface AdminAuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

export interface AdminLoginResponse {
  success: boolean;
  error?: string;
}

async function publicApiRequest<T>(
  path: string,
  options: globalThis.RequestInit = {}
): Promise<T> {
  const response = await fetch(`${PUBLIC_API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  } as globalThis.RequestInit);

  const data = await response.json() as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data;
}

export async function getAdminAuthStatus(): Promise<AdminAuthStatus> {
  return publicApiRequest<AdminAuthStatus>('/auth/status');
}

export async function loginAdmin(username: string, password: string): Promise<AdminLoginResponse> {
  return publicApiRequest<AdminLoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logoutAdmin(): Promise<{ success: boolean }> {
  return publicApiRequest<{ success: boolean }>('/auth/logout', {
    method: 'POST',
  });
}
