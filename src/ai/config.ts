import type { MoltbotEnv } from '../types'

export type AiProviderType = 'openai' | 'anthropic' | 'workers-ai' | string

export interface AiProviderInput {
  id: string
  type: AiProviderType
  baseUrl: string
  enabled?: boolean
  apiKeys?: string[]
  models?: string[]
}

export interface AiProviderStored {
  id: string
  type: AiProviderType
  baseUrl: string
  enabled: boolean
  models: string[]
  apiKeysEncrypted: string[]
}

export interface AiConfigStored {
  version: number
  primaryProviderId: string | null
  primaryModel: string | null
  fallbackOrder: string[]
  providers: AiProviderStored[]
  updatedAt: string
}

export interface AiProviderRedacted {
  id: string
  type: AiProviderType
  baseUrl: string
  enabled: boolean
  models: string[]
  apiKeyCount: number
}

export interface AiConfigRedacted {
  version: number
  primaryProviderId: string | null
  primaryModel: string | null
  fallbackOrder: string[]
  providers: AiProviderRedacted[]
  updatedAt: string
}

export interface AiConfigInput {
  primaryProviderId?: string | null
  primaryModel?: string | null
  fallbackOrder?: string[]
  providers?: AiProviderInput[]
}

export interface AdminAiEnvOverrides {
  envVars: Record<string, string>
  providerType: AiProviderType
}

const AI_CONFIG_KEY = 'admin/ai-config.json'
const AI_CONFIG_VERSION = 1

const normalizeText = (value: string | undefined | null) => (value ?? '').trim()

const uniqueList = (items: string[]) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const value = item.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

const normalizeProviderInput = (input: AiProviderInput): AiProviderInput => {
  return {
    id: normalizeText(input.id),
    type: normalizeText(input.type) || 'openai',
    baseUrl: normalizeText(input.baseUrl),
    enabled: input.enabled ?? true,
    apiKeys: input.apiKeys ? uniqueList(input.apiKeys) : undefined,
    models: input.models ? uniqueList(input.models) : undefined,
  }
}

const encodeBase64 = (data: ArrayBuffer | Uint8Array) => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

const decodeBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const deriveKey = async (masterKey: string) => {
  const encoder = new TextEncoder()
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(masterKey))
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const encryptSecret = async (secret: string, masterKey: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoder = new TextEncoder()
  const key = await deriveKey(masterKey)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(secret)
  )
  return `v1:${encodeBase64(iv)}:${encodeBase64(cipher)}`
}

const decryptSecret = async (payload: string, masterKey: string) => {
  const parts = payload.split(':')
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Invalid secret payload')
  }
  const iv = decodeBase64(parts[1])
  const data = decodeBase64(parts[2])
  const key = await deriveKey(masterKey)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(plain)
}

const encryptKeys = async (keys: string[], masterKey: string) => {
  const encrypted: string[] = []
  for (const key of keys) {
    encrypted.push(await encryptSecret(key, masterKey))
  }
  return encrypted
}

const decryptKeys = async (encrypted: string[], masterKey: string) => {
  const decrypted: string[] = []
  for (const payload of encrypted) {
    decrypted.push(await decryptSecret(payload, masterKey))
  }
  return decrypted
}

const emptyConfig = (): AiConfigStored => ({
  version: AI_CONFIG_VERSION,
  primaryProviderId: null,
  primaryModel: null,
  fallbackOrder: [],
  providers: [],
  updatedAt: new Date().toISOString(),
})

export const readAiConfig = async (env: MoltbotEnv): Promise<AiConfigStored | null> => {
  const object = await env.MOLTBOT_BUCKET.get(AI_CONFIG_KEY)
  if (!object) return null
  try {
    const raw = await object.json<AiConfigStored>()
    return {
      version: raw.version ?? AI_CONFIG_VERSION,
      primaryProviderId: normalizeText(raw.primaryProviderId ?? null) || null,
      primaryModel: normalizeText(raw.primaryModel ?? null) || null,
      fallbackOrder: uniqueList(raw.fallbackOrder ?? []),
      providers: Array.isArray(raw.providers)
        ? raw.providers.map((provider) => ({
            id: normalizeText(provider.id),
            type: normalizeText(provider.type) || 'openai',
            baseUrl: normalizeText(provider.baseUrl),
            enabled: provider.enabled ?? true,
            models: uniqueList(provider.models ?? []),
            apiKeysEncrypted: Array.isArray(provider.apiKeysEncrypted)
              ? provider.apiKeysEncrypted.map((value) => String(value))
              : [],
          }))
        : [],
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export const writeAiConfig = async (env: MoltbotEnv, config: AiConfigStored) => {
  await env.MOLTBOT_BUCKET.put(AI_CONFIG_KEY, JSON.stringify(config, null, 2), {
    httpMetadata: {
      contentType: 'application/json',
    },
  })
}

export const redactAiConfig = (config: AiConfigStored): AiConfigRedacted => ({
  version: config.version,
  primaryProviderId: config.primaryProviderId,
  primaryModel: config.primaryModel,
  fallbackOrder: [...config.fallbackOrder],
  updatedAt: config.updatedAt,
  providers: config.providers.map((provider) => ({
    id: provider.id,
    type: provider.type,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    models: [...provider.models],
    apiKeyCount: provider.apiKeysEncrypted.length,
  })),
})

export const upsertAiConfig = async (
  env: MoltbotEnv,
  input: AiConfigInput
): Promise<AiConfigStored> => {
  const masterKey = normalizeText(env.AI_CONFIG_MASTER_KEY)
  if (!masterKey) {
    throw new Error('AI_CONFIG_MASTER_KEY is required')
  }
  const existing = (await readAiConfig(env)) ?? emptyConfig()
  const normalizedProviders = (input.providers ?? existing.providers).map(normalizeProviderInput)
  const providerMap = new Map(existing.providers.map((provider) => [provider.id, provider]))
  const providers: AiProviderStored[] = []

  for (const provider of normalizedProviders) {
    if (!provider.id || !provider.baseUrl) continue
    const existingProvider = providerMap.get(provider.id)
    const apiKeys =
      provider.apiKeys !== undefined
        ? provider.apiKeys
        : existingProvider?.apiKeysEncrypted
          ? await decryptKeys(existingProvider.apiKeysEncrypted, masterKey).catch(() => [])
          : []
    const apiKeysEncrypted = await encryptKeys(apiKeys, masterKey)
    const models = provider.models ? uniqueList(provider.models) : []
    const enabled = (provider.enabled ?? true) && models.length > 0
    providers.push({
      id: provider.id,
      type: provider.type,
      baseUrl: provider.baseUrl.replace(/\/+$/, ''),
      enabled,
      models,
      apiKeysEncrypted,
    })
  }

  const primaryProviderId = normalizeText(input.primaryProviderId ?? existing.primaryProviderId ?? null) || null
  const primaryModel = normalizeText(input.primaryModel ?? existing.primaryModel ?? null) || null
  const fallbackOrder = uniqueList(input.fallbackOrder ?? existing.fallbackOrder ?? [])

  const config: AiConfigStored = {
    version: AI_CONFIG_VERSION,
    primaryProviderId,
    primaryModel,
    fallbackOrder,
    providers,
    updatedAt: new Date().toISOString(),
  }
  await writeAiConfig(env, config)
  return config
}

export const resolveAdminAiEnvOverrides = async (
  env: MoltbotEnv
): Promise<AdminAiEnvOverrides | null> => {
  if (env.AI_GATEWAY_API_KEY || env.AI_GATEWAY_BASE_URL) return null
  const masterKey = normalizeText(env.AI_CONFIG_MASTER_KEY)
  if (!masterKey) return null
  const config = await readAiConfig(env)
  if (!config || config.providers.length === 0) return null
  const provider =
    config.providers.find((item) => item.id === config.primaryProviderId) ??
    config.providers.find((item) => item.enabled)
  if (!provider || !provider.enabled) return null
  const keys = await decryptKeys(provider.apiKeysEncrypted, masterKey).catch(() => [])
  const activeKey = keys.find((value) => value.trim().length > 0)
  if (!activeKey || !provider.baseUrl) return null
  const models = provider.models ?? []
  if (models.length === 0) return null
  const primaryModel =
    normalizeText(config.primaryModel ?? null) ||
    normalizeText(models[0] ?? null) ||
    null
  const envVars: Record<string, string> = {
    ADMIN_AI_PROVIDER_TYPE: provider.type,
    ADMIN_AI_BASE_URL: provider.baseUrl,
    ADMIN_AI_MODELS: JSON.stringify(models),
  }
  if (primaryModel) envVars.ADMIN_AI_PRIMARY_MODEL = primaryModel
  if (provider.type === 'anthropic') {
    envVars.ANTHROPIC_API_KEY = activeKey
    envVars.ANTHROPIC_BASE_URL = provider.baseUrl
  } else {
    envVars.OPENAI_API_KEY = activeKey
    envVars.OPENAI_BASE_URL = provider.baseUrl
  }
  return { envVars, providerType: provider.type }
}

export const getAiConfigOrEmpty = async (env: MoltbotEnv): Promise<AiConfigStored> => {
  return (await readAiConfig(env)) ?? emptyConfig()
}

export const decryptProviderKeys = async (
  env: MoltbotEnv,
  provider: AiProviderStored
): Promise<string[]> => {
  const masterKey = normalizeText(env.AI_CONFIG_MASTER_KEY)
  if (!masterKey) throw new Error('AI_CONFIG_MASTER_KEY is required')
  return decryptKeys(provider.apiKeysEncrypted, masterKey)
}
