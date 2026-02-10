import { useState, useEffect, useCallback } from 'react'
import {
  listDevices,
  approveDevice,
  approveAllDevices,
  restartGateway,
  getGatewayLogs,
  getStorageStatus,
  triggerRestore,
  triggerSync,
  listR2Objects,
  deleteR2Object,
  deleteR2Prefix,
  getR2ObjectContent,
  uploadR2Object,
  AuthError,
  getAdminAuthStatus,
  loginAdmin,
  getAiEnvConfig,
  saveAiEnvConfig,
  getClawdbotConfig,
  saveClawdbotConfig,
  getOpenclawConfig,
  saveOpenclawConfig,
  updateOpenclaw,
  type AiEnvConfigResponse,
  type AiEnvConfigUpdate,
  type PendingDevice,
  type PairedDevice,
  type DeviceListResponse,
  type StorageStatusResponse,
  type R2ObjectEntry,
  type GatewayLogsResponse,
} from '../api'
import enTranslations from '../locals/en.json'
import zhJtTranslations from '../locals/cn-jt.json'
import zhFtTranslations from '../locals/cn-ft.json'
import ruTranslations from '../locals/ru.json'
import esTranslations from '../locals/es.json'
import frTranslations from '../locals/fr.json'
import jaTranslations from '../locals/ja.json'
import koTranslations from '../locals/ko.json'
import './AdminPage.css'

// Small inline spinner for buttons
function ButtonSpinner() {
  return <span className="btn-spinner" />
}

type Locale = 'en' | 'cn-jt' | 'cn-ft' | 'ru' | 'es' | 'fr' | 'ja' | 'ko'

const translations = {
  en: enTranslations,
  'cn-jt': zhJtTranslations,
  'cn-ft': zhFtTranslations,
  ru: ruTranslations,
  es: esTranslations,
  fr: frTranslations,
  ja: jaTranslations,
  ko: koTranslations,
} as const

type TranslationKey = keyof typeof enTranslations

type ConfirmAction =
  | { type: 'delete-object'; key: string }
  | { type: 'delete-prefix'; prefix: string }

const interpolate = (template: string, vars?: Record<string, string | number>) => {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key])
  )
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const sanitizeUrl = (url: string) => {
  const trimmed = url.trim()
  if (/^(https?:\/\/|\/)/i.test(trimmed)) return trimmed
  return '#'
}

const browserCdpExample = `{
  "profiles": {
    "cloudflare": {
      "cdpUrl": "https://opensssxxxx.workers.dev/cdp?secret=1d594fc901c8xxxxxx804f9bdde044580d067",
      "color": "#6789ab"
    }
  }
}`

const toolBraveExample = `{
  "web": {
    "search": {
      "provider": "brave",
      "apiKey": "xxxxxxx",
      "maxResults": 5,
      "timeoutSeconds": 30
    }
  }
}`

const renderMarkdown = (markdown: string) => {
  const codeBlocks: string[] = []
  let text = markdown.replace(/```([\s\S]*?)```/g, (_, code: string) => {
    const token = `__CODEBLOCK_${codeBlocks.length}__`
    codeBlocks.push(code)
    return token
  })
  text = escapeHtml(text)

  const formatInline = (line: string) => {
    let output = line.replace(/`([^`]+)`/g, '<code>$1</code>')
    output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>')
    output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, rawUrl: string) => {
      const safeUrl = sanitizeUrl(rawUrl)
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`
    })
    return output
  }

  const lines = text.split('\n')
  const blocks: string[] = []
  let inList = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (inList) {
        blocks.push('</ul>')
        inList = false
      }
      continue
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      if (inList) {
        blocks.push('</ul>')
        inList = false
      }
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`)
      continue
    }
    const listMatch = line.match(/^[-*]\s+(.*)$/)
    if (listMatch) {
      if (!inList) {
        blocks.push('<ul>')
        inList = true
      }
      blocks.push(`<li>${formatInline(listMatch[1])}</li>`)
      continue
    }
    if (inList) {
      blocks.push('</ul>')
      inList = false
    }
    blocks.push(`<p>${formatInline(line)}</p>`)
  }
  if (inList) {
    blocks.push('</ul>')
  }

  let html = blocks.join('')
  codeBlocks.forEach((code, index) => {
    const escaped = escapeHtml(code)
    html = html.replace(
      `__CODEBLOCK_${index}__`,
      `<pre><code>${escaped}</code></pre>`
    )
  })
  return html
}

export default function AdminPage() {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'en'
    const stored = localStorage.getItem('adminLocale')
    if (stored === 'zh-CN' || stored === 'cn-zh') return 'cn-jt'
    return stored === 'cn-jt' ||
      stored === 'cn-ft' ||
      stored === 'ru' ||
      stored === 'es' ||
      stored === 'fr' ||
      stored === 'ja' ||
      stored === 'ko' ||
      stored === 'en'
      ? stored
      : 'en'
  })
  const [pending, setPending] = useState<PendingDevice[]>([])
  const [paired, setPaired] = useState<PairedDevice[]>([])
  const [storageStatus, setStorageStatus] = useState<StorageStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [authChecking, setAuthChecking] = useState(true)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [restartInProgress, setRestartInProgress] = useState(false)
  const [restoreInProgress, setRestoreInProgress] = useState(false)
  const [backupInProgress, setBackupInProgress] = useState(false)
  const [r2Prefix, setR2Prefix] = useState('workspace-core/')
  const [r2Objects, setR2Objects] = useState<R2ObjectEntry[]>([])
  const [r2Cursor, setR2Cursor] = useState<string | null>(null)
  const [r2Loading, setR2Loading] = useState(false)
  const [r2Action, setR2Action] = useState<string | null>(null)
  const [r2UploadFile, setR2UploadFile] = useState<File | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [mdPreview, setMdPreview] = useState<{ key: string; content: string } | null>(null)
  const [mdPreviewLoading, setMdPreviewLoading] = useState(false)
  const [mdPreviewError, setMdPreviewError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'basic' | 'ai'>('basic')
  const [aiConfigLoading, setAiConfigLoading] = useState(false)
  const [aiConfigError, setAiConfigError] = useState<string | null>(null)
  const [aiConfig, setAiConfig] = useState<AiEnvConfigResponse | null>(null)
  const [aiConfigSaving, setAiConfigSaving] = useState(false)
  const [aiPrimaryProvider, setAiPrimaryProvider] = useState('auto')
  const [aiPrimaryProviderDirty, setAiPrimaryProviderDirty] = useState(false)
  const [gatewayLogs, setGatewayLogs] = useState<GatewayLogsResponse | null>(null)
  const [gatewayLogsLoading, setGatewayLogsLoading] = useState(false)
  const [gatewayLogsError, setGatewayLogsError] = useState<string | null>(null)
  const [clawdbotConfig, setClawdbotConfig] = useState('')
  const [clawdbotLoading, setClawdbotLoading] = useState(false)
  const [clawdbotSaving, setClawdbotSaving] = useState(false)
  const [clawdbotStatus, setClawdbotStatus] = useState<string | null>(null)
  const [openclawConfig, setOpenclawConfig] = useState('')
  const [openclawLoading, setOpenclawLoading] = useState(false)
  const [openclawSaving, setOpenclawSaving] = useState(false)
  const [openclawStatus, setOpenclawStatus] = useState<string | null>(null)
  const [openclawUpdateLoading, setOpenclawUpdateLoading] = useState(false)
  const [openclawUpdateOutput, setOpenclawUpdateOutput] = useState('')
  const [baseUrlDrafts, setBaseUrlDrafts] = useState<Record<string, string>>({})
  const [baseUrlDirty, setBaseUrlDirty] = useState<Record<string, boolean>>({})
  const [baseUrlEditing, setBaseUrlEditing] = useState<Record<string, boolean>>({})
  const [baseUrlEditingValue, setBaseUrlEditingValue] = useState<Record<string, string>>({})
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({})
  const [apiKeyDirty, setApiKeyDirty] = useState<Record<string, boolean>>({})
  const [apiKeyEditing, setApiKeyEditing] = useState<Record<string, boolean>>({})
  const [apiKeyEditingValue, setApiKeyEditingValue] = useState<Record<string, string>>({})
  useEffect(() => {
    localStorage.setItem('adminLocale', locale)
  }, [locale])

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const dict = translations[locale] ?? translations.en
      const template = dict[key] ?? translations.en[key] ?? key
      return interpolate(template, vars)
    },
    [locale]
  )

  const dateLocale =
    locale === 'cn-jt'
      ? 'zh-CN'
      : locale === 'cn-ft'
        ? 'zh-HK'
        : locale === 'ru'
          ? 'ru-RU'
          : locale === 'es'
            ? 'es-ES'
            : locale === 'fr'
              ? 'fr-FR'
              : locale === 'ja'
                ? 'ja-JP'
                : locale === 'ko'
                  ? 'ko-KR'
                  : 'en-US'

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof AuthError) {
        setAuthenticated(false)
        setAuthEnabled(true)
        setLoginError(t('error.auth_required'))
        setLoading(false)
        return true
      }
      return false
    },
    [t]
  )

  const checkAuthStatus = useCallback(async () => {
    setAuthChecking(true)
    setLoginError(null)
    try {
      const status = await getAdminAuthStatus()
      setAuthEnabled(status.enabled)
      const isAuthed = status.enabled ? status.authenticated : true
      setAuthenticated(isAuthed)
      if (status.enabled && !status.authenticated) {
        setLoading(false)
      }
    } catch (err) {
      setAuthEnabled(true)
      setAuthenticated(false)
      setLoginError(err instanceof Error ? err.message : t('error.auth_required'))
      setLoading(false)
    } finally {
      setAuthChecking(false)
    }
  }, [t])

  useEffect(() => {
    checkAuthStatus()
  }, [checkAuthStatus])

  const fetchDevices = useCallback(async () => {
    try {
      setError(null)
      const data: DeviceListResponse = await listDevices()
      setPending(data.pending || [])
      setPaired(data.paired || [])
      
      if (data.error) {
        setError(data.error)
      } else if (data.parseError) {
        setError(t('error.parse', { error: data.parseError }))
      }
    } catch (err) {
      if (handleAuthError(err)) {
        return
      }
      {
        setError(err instanceof Error ? err.message : t('error.fetch_devices'))
      }
    } finally {
      setLoading(false)
    }
  }, [handleAuthError, t])

  const fetchStorageStatus = useCallback(async () => {
    try {
      const status = await getStorageStatus()
      setStorageStatus(status)
    } catch (err) {
      if (!handleAuthError(err)) {
        console.error(t('error.fetch_storage_status'), err)
      }
    }
  }, [handleAuthError, t])

  const loadAiConfig = useCallback(async () => {
    setAiConfigLoading(true)
    setAiConfigError(null)
    try {
      const config = await getAiEnvConfig()
      setAiConfig(config)
      setAiPrimaryProvider(config.primaryProvider ?? 'auto')
      setAiPrimaryProviderDirty(false)
      setBaseUrlDrafts(
        Object.fromEntries(
          Object.entries(config.baseUrls).map(([key, value]) => [key, value ?? ''])
        )
      )
      setBaseUrlDirty({})
      setBaseUrlEditing({})
      setBaseUrlEditingValue({})
      setApiKeyDrafts({})
      setApiKeyDirty({})
      setApiKeyEditing({})
      setApiKeyEditingValue({})
    } catch (err) {
      if (!handleAuthError(err)) {
        setAiConfigError(err instanceof Error ? err.message : t('ai.basic.error'))
      }
    } finally {
      setAiConfigLoading(false)
    }
  }, [handleAuthError, t])

  const loadGatewayLogs = useCallback(async () => {
    setGatewayLogsLoading(true)
    setGatewayLogsError(null)
    try {
      const logs = await getGatewayLogs()
      if (!logs.ok) {
        setGatewayLogs(null)
        setGatewayLogsError(logs.error ?? t('ai.basic.gateway_logs_error'))
        return
      }
      setGatewayLogs(logs)
    } catch (err) {
      if (!handleAuthError(err)) {
        setGatewayLogs(null)
        setGatewayLogsError(err instanceof Error ? err.message : t('ai.basic.gateway_logs_error'))
      }
    } finally {
      setGatewayLogsLoading(false)
    }
  }, [handleAuthError, t])

  const aiBaseUrlKeys = Object.keys(aiConfig?.baseUrls ?? {})
  const aiApiKeyKeys = Object.keys(aiConfig?.apiKeys ?? {})
  const gatewayLogsOutput = gatewayLogs
    ? [gatewayLogs.stderr, gatewayLogs.stdout]
        .filter((chunk): chunk is string => typeof chunk === 'string' && chunk.trim().length > 0)
        .join('\n')
    : ''

  const saveAiConfig = useCallback(async () => {
    if (!aiConfig) return
    setAiConfigSaving(true)
    setAiConfigError(null)
    try {
      const payload: AiEnvConfigUpdate = {}

      const baseUrlsUpdate: Record<string, string | null> = {}
      Object.entries(baseUrlDirty).forEach(([key, dirty]) => {
        if (!dirty) return
        const value = (baseUrlDrafts[key] ?? '').trim()
        baseUrlsUpdate[key] = value === '' ? null : value
      })
      if (Object.keys(baseUrlsUpdate).length > 0) payload.baseUrls = baseUrlsUpdate

      const apiKeysUpdate: Record<string, string | null> = {}
      Object.entries(apiKeyDirty).forEach(([key, dirty]) => {
        if (!dirty) return
        const value = (apiKeyDrafts[key] ?? '').trim()
        apiKeysUpdate[key] = value === '' ? null : value
      })
      if (Object.keys(apiKeysUpdate).length > 0) payload.apiKeys = apiKeysUpdate
      if (aiPrimaryProviderDirty) {
        payload.primaryProvider = aiPrimaryProvider === 'auto' ? null : aiPrimaryProvider
      }

      const next = await saveAiEnvConfig(payload)
      setAiConfig(next)
      setAiPrimaryProvider(next.primaryProvider ?? 'auto')
      setAiPrimaryProviderDirty(false)
      setBaseUrlDrafts(Object.fromEntries(Object.entries(next.baseUrls).map(([k, v]) => [k, v ?? ''])))
      setBaseUrlDirty({})
      setBaseUrlEditing({})
      setBaseUrlEditingValue({})
      setApiKeyDrafts({})
      setApiKeyDirty({})
      setApiKeyEditing({})
      setApiKeyEditingValue({})
    } catch (err) {
      setAiConfigError(err instanceof Error ? err.message : t('ai.basic.error'))
    } finally {
      setAiConfigSaving(false)
    }
  }, [
    aiConfig,
    aiPrimaryProvider,
    aiPrimaryProviderDirty,
    apiKeyDirty,
    apiKeyDrafts,
    baseUrlDirty,
    baseUrlDrafts,
    t,
  ])

  useEffect(() => {
    if (authChecking) return
    if (authEnabled && !authenticated) return
    fetchDevices()
    fetchStorageStatus()
  }, [authChecking, authEnabled, authenticated, fetchDevices, fetchStorageStatus])

  useEffect(() => {
    if (authChecking) return
    if (authEnabled && !authenticated) return
    if (activeTab === 'ai' && !aiConfig && !aiConfigLoading) {
      loadAiConfig()
    }
  }, [activeTab, aiConfig, aiConfigLoading, authChecking, authEnabled, authenticated, loadAiConfig])


  const handleLogin = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (loginLoading) return
      setLoginLoading(true)
      setLoginError(null)
      try {
        const result = await loginAdmin(loginUsername.trim(), loginPassword)
        if (!result.success) {
          setLoginError(result.error ?? t('auth.invalid'))
          return
        }
        setAuthenticated(true)
        setLoginPassword('')
        setLoading(true)
        await fetchDevices()
        await fetchStorageStatus()
        if (activeTab === 'ai') {
          await loadAiConfig()
        }
      } catch (err) {
        setLoginError(err instanceof Error ? err.message : t('auth.error'))
      } finally {
        setLoginLoading(false)
      }
    },
    [
      activeTab,
      fetchDevices,
      fetchStorageStatus,
      loadAiConfig,
      loginLoading,
      loginPassword,
      loginUsername,
      t,
    ]
  )

  const handleApprove = async (requestId: string) => {
    setActionInProgress(requestId)
    try {
      const result = await approveDevice(requestId)
      if (result.success) {
        // Refresh the list
        await fetchDevices()
      } else {
        setError(result.error || t('error.approval_failed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.approve_device'))
    } finally {
      setActionInProgress(null)
    }
  }

  const handleApproveAll = async () => {
    if (pending.length === 0) return
    
    setActionInProgress('all')
    try {
      const result = await approveAllDevices()
      if (result.failed && result.failed.length > 0) {
        setError(t('error.approve_failed_count', { count: result.failed.length }))
      }
      // Refresh the list
      await fetchDevices()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.approve_devices'))
    } finally {
      setActionInProgress(null)
    }
  }

  const handleRestartGateway = async () => {
    if (!confirm(t('confirm.restart_gateway'))) {
      return
    }
    
    setRestartInProgress(true)
    try {
      const result = await restartGateway()
      if (result.success) {
        setError(null)
        // Show success message briefly
        alert(t('notice.restart_gateway'))
      } else {
        setError(result.error || t('error.restart_gateway'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.restart_gateway'))
    } finally {
      setRestartInProgress(false)
    }
  }

  const handleRestore = async () => {
    setRestoreInProgress(true)
    try {
      const result = await triggerRestore()
      if (result.success) {
        setStorageStatus(prev =>
          prev
            ? {
                ...prev,
                lastSync: result.lastSync ?? prev.lastSync,
                restored: true,
              }
            : prev
        )
        setError(null)
        alert(t('notice.storage_restored'))
      } else {
        setError(result.error || t('error.restore_failed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.restore'))
    } finally {
      setRestoreInProgress(false)
    }
  }

  const handleBackup = async () => {
    setBackupInProgress(true)
    try {
      const result = await triggerSync()
      if (result.success) {
        setStorageStatus(prev => prev ? { ...prev, lastSync: result.lastSync || null } : null)
        setError(null)
      } else {
        setError(result.error || t('error.sync_failed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.sync'))
    } finally {
      setBackupInProgress(false)
    }
  }

  const handleLoadClawdbotConfig = async () => {
    setClawdbotLoading(true)
    setClawdbotStatus(null)
    try {
      const result = await getClawdbotConfig()
      const content = result.content ?? ''
      setClawdbotConfig(content)
      setClawdbotStatus(t('config.loaded'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('config.load_failed')
      setClawdbotStatus(message)
    } finally {
      setClawdbotLoading(false)
    }
  }

  const handleSaveClawdbotConfig = async () => {
    setClawdbotSaving(true)
    setClawdbotStatus(null)
    try {
      const result = await saveClawdbotConfig(clawdbotConfig)
      if (result.success) {
        setClawdbotStatus(t('config.saved'))
      } else {
        setClawdbotStatus(result.error || t('config.save_failed'))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('config.save_failed')
      setClawdbotStatus(t('error.parse', { error: message }))
    } finally {
      setClawdbotSaving(false)
    }
  }

  const handleLoadOpenclawConfig = async () => {
    setOpenclawLoading(true)
    setOpenclawStatus(null)
    try {
      const result = await getOpenclawConfig()
      setOpenclawConfig(result.content ?? '')
      setOpenclawStatus(t('config.loaded'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('config.load_failed')
      setOpenclawStatus(message)
    } finally {
      setOpenclawLoading(false)
    }
  }

  const handleSaveOpenclawConfig = async () => {
    setOpenclawSaving(true)
    setOpenclawStatus(null)
    try {
      const result = await saveOpenclawConfig(openclawConfig)
      if (result.success) {
        setOpenclawStatus(t('config.saved'))
      } else {
        setOpenclawStatus(result.error || t('config.save_failed'))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('config.save_failed')
      setOpenclawStatus(message)
    } finally {
      setOpenclawSaving(false)
    }
  }

  const handleUpdateOpenclaw = async () => {
    setOpenclawUpdateLoading(true)
    setOpenclawUpdateOutput('')
    try {
      const result = await updateOpenclaw()
      const output = [result.stderr, result.stdout]
        .filter((chunk): chunk is string => typeof chunk === 'string' && chunk.trim().length > 0)
        .join('\n')
      if (result.success) {
        setOpenclawUpdateOutput(output || t('openclaw.update_success'))
      } else {
        setOpenclawUpdateOutput(output || result.error || t('openclaw.update_failed'))
      }
    } catch (err) {
      setOpenclawUpdateOutput(err instanceof Error ? err.message : t('openclaw.update_failed'))
    } finally {
      setOpenclawUpdateLoading(false)
    }
  }

  const formatSyncTime = (isoString: string | null) => {
    if (!isoString) return t('time.never')
    try {
      const date = new Date(isoString)
      return date.toLocaleString(dateLocale)
    } catch {
      return isoString
    }
  }

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts)
    return date.toLocaleString(dateLocale)
  }

  const formatTimeAgo = (ts: number) => {
    const seconds = Math.floor((Date.now() - ts) / 1000)
    if (seconds < 60) return t('time.seconds_ago', { count: seconds })
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return t('time.minutes_ago', { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('time.hours_ago', { count: hours })
    const days = Math.floor(hours / 24)
    return t('time.days_ago', { count: days })
  }

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes)) return '-'
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    const mb = kb / 1024
    if (mb < 1024) return `${mb.toFixed(1)} MB`
    const gb = mb / 1024
    return `${gb.toFixed(2)} GB`
  }

  const r2PrefixOptions = [
    { value: 'workspace-core/', label: t('r2.prefix.workspace') },
    { value: 'workspace-core/scripts/', label: t('r2.prefix.scripts') },
    { value: 'workspace-core/config/', label: t('r2.prefix.config') },
    { value: 'workspace-core/logs/', label: t('r2.prefix.logs') },
    { value: 'workspace-core/memory/', label: t('r2.prefix.memory') },
    { value: 'skills/', label: t('r2.prefix.skills') },
    { value: 'clawdbot/', label: t('r2.prefix.clawdbot') },
  ]

  const loadR2Objects = useCallback(async (reset: boolean) => {
    if (!storageStatus?.configured) return
    setR2Loading(true)
    try {
      const result = await listR2Objects({
        prefix: r2Prefix,
        cursor: reset ? undefined : r2Cursor,
        limit: 200,
      })
      setR2Objects(prev => (reset ? result.objects : [...prev, ...result.objects]))
      setR2Cursor(result.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('r2.error.load'))
    } finally {
      setR2Loading(false)
    }
  }, [r2Prefix, r2Cursor, storageStatus?.configured, t])

  useEffect(() => {
    if (storageStatus?.configured) {
      loadR2Objects(true)
    }
  }, [storageStatus?.configured, r2Prefix, loadR2Objects])

  const executeR2Delete = async (action: ConfirmAction) => {
    const isPrefix = action.type === 'delete-prefix'
    const target = isPrefix ? action.prefix : action.key
    setR2Action(target)
    setConfirmBusy(true)
    try {
      if (isPrefix) {
        await deleteR2Prefix(action.prefix)
      } else {
        await deleteR2Object(action.key)
      }
      await loadR2Objects(true)
      setError(null)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isPrefix
            ? t('r2.error.delete_prefix')
            : t('r2.error.delete_object')
      )
    } finally {
      setR2Action(null)
      setConfirmBusy(false)
    }
  }

  const handleR2DeleteObject = (key: string) => {
    if (key.endsWith('/')) {
      setConfirmAction({ type: 'delete-prefix', prefix: key })
    } else {
      setConfirmAction({ type: 'delete-object', key })
    }
  }

  const handleR2DeletePrefix = () => {
    setConfirmAction({ type: 'delete-prefix', prefix: r2Prefix })
  }

  const handleR2Upload = async () => {
    if (!r2UploadFile) return
    setR2Action('upload')
    try {
      await uploadR2Object(r2Prefix, r2UploadFile)
      setR2UploadFile(null)
      await loadR2Objects(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('r2.error.upload'))
    } finally {
      setR2Action(null)
    }
  }

  const handleMdPreview = async (key: string) => {
    setMdPreview({ key, content: '' })
    setMdPreviewLoading(true)
    setMdPreviewError(null)
    try {
      const result = await getR2ObjectContent(key)
      setMdPreview({ key: result.key, content: result.content })
    } catch (err) {
      setMdPreviewError(err instanceof Error ? err.message : t('r2.preview_error'))
    } finally {
      setMdPreviewLoading(false)
    }
  }

  if (authChecking) {
    return (
      <div className="devices-page">
        <div className="loading">
          <div className="spinner"></div>
          <p>{t('auth.checking')}</p>
        </div>
      </div>
    )
  }

  if (authEnabled && !authenticated) {
    return (
      <div className="devices-page">
        <div className="page-toolbar">
          <div className="language-toggle">
            <button
              className={`lang-btn ${locale === 'en' ? 'active' : ''}`}
              onClick={() => setLocale('en')}
              aria-label={t('language.english')}
            >
              <span>EN</span>
            </button>
            <button
              className={`lang-btn ${locale === 'cn-jt' ? 'active' : ''}`}
              onClick={() => setLocale('cn-jt')}
              aria-label={t('language.chinese_simplified')}
            >
              <span>汉</span>
            </button>
            <button
              className={`lang-btn ${locale === 'cn-ft' ? 'active' : ''}`}
              onClick={() => setLocale('cn-ft')}
              aria-label={t('language.chinese_traditional')}
            >
              <span>漢</span>
            </button>
            <button
              className={`lang-btn ${locale === 'ru' ? 'active' : ''}`}
              onClick={() => setLocale('ru')}
              aria-label={t('language.russian')}
            >
              <span>Рус</span>
            </button>
            <button
              className={`lang-btn ${locale === 'es' ? 'active' : ''}`}
              onClick={() => setLocale('es')}
              aria-label={t('language.spanish')}
            >
              <span>ES</span>
            </button>
            <button
              className={`lang-btn ${locale === 'fr' ? 'active' : ''}`}
              onClick={() => setLocale('fr')}
              aria-label={t('language.french')}
            >
              <span>FR</span>
            </button>
            <button
              className={`lang-btn ${locale === 'ja' ? 'active' : ''}`}
              onClick={() => setLocale('ja')}
              aria-label={t('language.japanese')}
            >
              <span>日</span>
            </button>
            <button
              className={`lang-btn ${locale === 'ko' ? 'active' : ''}`}
              onClick={() => setLocale('ko')}
              aria-label={t('language.korean')}
            >
              <span>한</span>
            </button>
          </div>
        </div>
        <div className="auth-container">
          <form className="auth-card" onSubmit={handleLogin}>
            <div className="auth-header">
              <h1>{t('auth.title')}</h1>
              <p>{t('auth.subtitle')}</p>
            </div>
            {loginError ? <div className="auth-error">{loginError}</div> : null}
            <div className="auth-fields">
              <label className="auth-field">
                <span className="auth-label">{t('auth.username')}</span>
                <input
                  className="auth-input"
                  type="text"
                  autoComplete="username"
                  value={loginUsername}
                  onChange={(event) => setLoginUsername(event.target.value)}
                  disabled={loginLoading}
                  required
                />
              </label>
              <label className="auth-field">
                <span className="auth-label">{t('auth.password')}</span>
                <input
                  className="auth-input"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  disabled={loginLoading}
                  required
                />
              </label>
            </div>
            <div className="auth-actions">
              <button className="btn btn-primary" type="submit" disabled={loginLoading}>
                {loginLoading && <ButtonSpinner />}
                {loginLoading ? t('auth.logging_in') : t('auth.login')}
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="devices-page">
      <div className="page-toolbar">
        <div className="language-toggle">
          <button
            className={`lang-btn ${locale === 'en' ? 'active' : ''}`}
            onClick={() => setLocale('en')}
            aria-label={t('language.english')}
          >
            <span>EN</span>
          </button>
          <button
            className={`lang-btn ${locale === 'cn-jt' ? 'active' : ''}`}
            onClick={() => setLocale('cn-jt')}
            aria-label={t('language.chinese_simplified')}
          >
            <span>汉</span>
          </button>
          <button
            className={`lang-btn ${locale === 'cn-ft' ? 'active' : ''}`}
            onClick={() => setLocale('cn-ft')}
            aria-label={t('language.chinese_traditional')}
          >
            <span>漢</span>
          </button>
          <button
            className={`lang-btn ${locale === 'ru' ? 'active' : ''}`}
            onClick={() => setLocale('ru')}
            aria-label={t('language.russian')}
          >
            <span>Рус</span>
          </button>
          <button
            className={`lang-btn ${locale === 'es' ? 'active' : ''}`}
            onClick={() => setLocale('es')}
            aria-label={t('language.spanish')}
          >
            <span>ES</span>
          </button>
          <button
            className={`lang-btn ${locale === 'fr' ? 'active' : ''}`}
            onClick={() => setLocale('fr')}
            aria-label={t('language.french')}
          >
            <span>FR</span>
          </button>
          <button
            className={`lang-btn ${locale === 'ja' ? 'active' : ''}`}
            onClick={() => setLocale('ja')}
            aria-label={t('language.japanese')}
          >
            <span>日</span>
          </button>
          <button
            className={`lang-btn ${locale === 'ko' ? 'active' : ''}`}
            onClick={() => setLocale('ko')}
            aria-label={t('language.korean')}
          >
            <span>한</span>
          </button>
        </div>
      </div>
      <div className="tab-bar-row">
        <div className="tab-bar">
          <button
            className={`tab-button ${activeTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveTab('basic')}
          >
            {t('tabs.basic')}
          </button>
          <button
            className={`tab-button ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            {t('tabs.ai')}
          </button>
        </div>
        <div className="gateway-action">
          <div className="hover-hint-wrapper">
            <button
              className="btn btn-danger"
              onClick={handleRestartGateway}
              disabled={restartInProgress}
            >
              {restartInProgress && <ButtonSpinner />}
              {restartInProgress ? t('gateway.restarting') : t('gateway.restart')}
            </button>
            <span className="hover-hint">{t('gateway.hint')}</span>
          </div>
        </div>
      </div>
      {activeTab === 'basic' ? (
        <>
          {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="dismiss-btn">
            {t('action.dismiss')}
          </button>
        </div>
          )}

      {storageStatus && !storageStatus.configured && (
        <div className="warning-banner">
          <div className="warning-content">
            <strong>{t('storage.not_configured_title')}</strong>
            <p>
              {t('storage.not_configured_body_start')}{' '}
              {t('storage.not_configured_body_mid')}{' '}
              {t('storage.not_configured_body_end')}{' '}
              <a href="https://github.com/cloudflare/moltworker" target="_blank" rel="noopener noreferrer">
                {t('storage.readme')}
              </a>
              {t('storage.not_configured_body_tail')}
            </p>
            {storageStatus.missing && (
              <p className="missing-secrets">
                {t('storage.missing', { items: storageStatus.missing.join(', ') })}
              </p>
            )}
          </div>
        </div>
      )}

      {storageStatus?.configured && (
        <div className="success-banner">
          <div className="storage-status">
            <div className="storage-info">
              <span>{t('storage.configured')}</span>
              <span className="last-sync">
                {t('storage.last_backup', { time: formatSyncTime(storageStatus.lastSync) })}
              </span>
            </div>
            <div className="storage-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRestore}
                disabled={restoreInProgress || storageStatus.restored}
              >
                {restoreInProgress && <ButtonSpinner />}
                {restoreInProgress
                  ? t('storage.restoring')
                  : storageStatus.restored
                    ? t('storage.synced')
                    : t('storage.sync_now')}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleBackup}
                disabled={backupInProgress || !storageStatus.restored}
              >
                {backupInProgress && <ButtonSpinner />}
                {backupInProgress ? t('storage.backing_up') : t('storage.backup_now')}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="config-section">
        <div className="section-header">
          <div>
            <h2>{t('config.title')}</h2>
            <p className="section-hint">{t('config.hint')}</p>
          </div>
        </div>
        <div className="config-grid">
          <div className="config-card">
            <div className="config-card-header">
              <h3>{t('config.clawdbot_title')}</h3>
              <div className="config-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleLoadClawdbotConfig}
                  disabled={clawdbotLoading || clawdbotSaving}
                >
                  {clawdbotLoading && <ButtonSpinner />}
                  {clawdbotLoading ? t('config.loading') : t('config.load')}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveClawdbotConfig}
                  disabled={clawdbotLoading || clawdbotSaving}
                >
                  {clawdbotSaving && <ButtonSpinner />}
                  {clawdbotSaving ? t('config.saving') : t('config.save')}
                </button>
              </div>
            </div>
            <div className="config-fields-layout">
              <div className="config-fields-main">
                <textarea
                  className="config-textarea"
                  value={clawdbotConfig}
                  onChange={(event) => setClawdbotConfig(event.target.value)}
                  spellCheck={false}
                />
                {clawdbotStatus && <div className="config-status">{clawdbotStatus}</div>}
              </div>
              <div className="config-examples">
                <div className="config-example">
                  <div className="config-example-title">browser-cdp</div>
                  <pre className="config-example-code">{browserCdpExample}</pre>
                </div>
                <div className="config-example">
                  <div className="config-example-title">tool-brave</div>
                  <pre className="config-example-code">{toolBraveExample}</pre>
                </div>
              </div>
            </div>
          </div>
          <div className="config-card">
            <div className="config-card-header">
              <h3>{t('config.openclaw_title')}</h3>
              <div className="config-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleLoadOpenclawConfig}
                  disabled={openclawLoading || openclawSaving || openclawUpdateLoading}
                >
                  {openclawLoading && <ButtonSpinner />}
                  {openclawLoading ? t('config.loading') : t('config.load')}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveOpenclawConfig}
                  disabled={openclawLoading || openclawSaving || openclawUpdateLoading}
                >
                  {openclawSaving && <ButtonSpinner />}
                  {openclawSaving ? t('config.saving') : t('config.save')}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleUpdateOpenclaw}
                  disabled={openclawLoading || openclawSaving || openclawUpdateLoading}
                >
                  {openclawUpdateLoading && <ButtonSpinner />}
                  {openclawUpdateLoading ? t('openclaw.updating') : t('openclaw.update')}
                </button>
              </div>
            </div>
            <textarea
              className="config-textarea"
              value={openclawConfig}
              onChange={(event) => setOpenclawConfig(event.target.value)}
              spellCheck={false}
            />
            {openclawStatus && <div className="config-status">{openclawStatus}</div>}
            {openclawUpdateOutput && <pre className="log-output">{openclawUpdateOutput}</pre>}
          </div>
        </div>
      </section>

      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
          <p>{t('devices.loading')}</p>
        </div>
      ) : (
        <>
          <section className="devices-section">
        <div className="section-header">
          <h2>{t('devices.pending_title')}</h2>
          <div className="header-actions">
            {pending.length > 0 && (
              <button
                className="btn btn-primary"
                onClick={handleApproveAll}
                disabled={actionInProgress !== null}
              >
                {actionInProgress === 'all' && <ButtonSpinner />}
                {actionInProgress === 'all'
                  ? t('devices.approving')
                  : t('devices.approve_all', { count: pending.length })}
              </button>
            )}
            <button className="btn btn-secondary" onClick={fetchDevices} disabled={loading}>
              {t('action.refresh')}
            </button>
          </div>
        </div>

        {pending.length === 0 ? (
          <div className="empty-state">
            <p>{t('devices.no_pending')}</p>
            <p className="hint">
              {t('devices.pending_hint')}
            </p>
          </div>
        ) : (
          <div className="devices-grid">
            {pending.map((device) => (
              <div key={device.requestId} className="device-card pending">
                <div className="device-header">
                  <span className="device-name">
                    {device.displayName || device.deviceId || t('devices.unknown')}
                  </span>
                  <span className="device-badge pending">{t('devices.pending')}</span>
                </div>
                <div className="device-details">
                  {device.platform && (
                    <div className="detail-row">
                      <span className="label">{t('devices.platform')}</span>
                      <span className="value">{device.platform}</span>
                    </div>
                  )}
                  {device.clientId && (
                    <div className="detail-row">
                      <span className="label">{t('devices.client')}</span>
                      <span className="value">{device.clientId}</span>
                    </div>
                  )}
                  {device.clientMode && (
                    <div className="detail-row">
                      <span className="label">{t('devices.mode')}</span>
                      <span className="value">{device.clientMode}</span>
                    </div>
                  )}
                  {device.role && (
                    <div className="detail-row">
                      <span className="label">{t('devices.role')}</span>
                      <span className="value">{device.role}</span>
                    </div>
                  )}
                  {device.remoteIp && (
                    <div className="detail-row">
                      <span className="label">{t('devices.ip')}</span>
                      <span className="value">{device.remoteIp}</span>
                    </div>
                  )}
                  <div className="detail-row">
                    <span className="label">{t('devices.requested')}</span>
                    <span className="value" title={formatTimestamp(device.ts)}>
                      {formatTimeAgo(device.ts)}
                    </span>
                  </div>
                </div>
                <div className="device-actions">
                  <button
                    className="btn btn-success"
                    onClick={() => handleApprove(device.requestId)}
                    disabled={actionInProgress !== null}
                  >
                    {actionInProgress === device.requestId && <ButtonSpinner />}
                    {actionInProgress === device.requestId ? t('devices.approving') : t('devices.approve')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="devices-section">
        <div className="section-header">
          <h2>{t('devices.paired_title')}</h2>
        </div>

        {paired.length === 0 ? (
          <div className="empty-state">
            <p>{t('devices.no_paired')}</p>
          </div>
        ) : (
          <div className="devices-grid">
            {paired.map((device, index) => (
              <div key={device.deviceId || index} className="device-card paired">
                <div className="device-header">
                  <span className="device-name">
                    {device.displayName || device.deviceId || t('devices.unknown')}
                  </span>
                  <span className="device-badge paired">{t('devices.paired')}</span>
                </div>
                <div className="device-details">
                  {device.platform && (
                    <div className="detail-row">
                      <span className="label">{t('devices.platform')}</span>
                      <span className="value">{device.platform}</span>
                    </div>
                  )}
                  {device.clientId && (
                    <div className="detail-row">
                      <span className="label">{t('devices.client')}</span>
                      <span className="value">{device.clientId}</span>
                    </div>
                  )}
                  {device.clientMode && (
                    <div className="detail-row">
                      <span className="label">{t('devices.mode')}</span>
                      <span className="value">{device.clientMode}</span>
                    </div>
                  )}
                  {device.role && (
                    <div className="detail-row">
                      <span className="label">{t('devices.role')}</span>
                      <span className="value">{device.role}</span>
                    </div>
                  )}
                  <div className="detail-row">
                    <span className="label">{t('devices.paired_label')}</span>
                    <span className="value" title={formatTimestamp(device.approvedAtMs)}>
                      {formatTimeAgo(device.approvedAtMs)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
        </>
      )}
    </>
      ) : (
        <section className="devices-section">
          <div className="section-header">
            <h2>{t('ai.basic.title')}</h2>
          </div>
          <p className="hint">{t('ai.basic.hint')}</p>
          {aiConfigLoading ? (
            <div className="loading">
              <div className="spinner"></div>
              <p>{t('ai.basic.loading')}</p>
            </div>
          ) : aiConfigError ? (
            <div className="error-banner">
              <span>{aiConfigError}</span>
              <button className="btn btn-secondary btn-sm" onClick={loadAiConfig}>
                {t('action.refresh')}
              </button>
            </div>
          ) : (
            <div className="env-stack">
              <div className="env-block">
                <div className="env-title">{t('ai.basic.primary_provider')}</div>
                <div className="env-editor provider-toggle">
                  <label
                    className={`provider-option ${aiPrimaryProvider === 'auto' ? 'active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ai-primary-provider"
                      value="auto"
                      checked={aiPrimaryProvider === 'auto'}
                      onChange={() => {
                        setAiPrimaryProvider('auto')
                        setAiPrimaryProviderDirty(true)
                      }}
                    />
                    <span>{t('ai.basic.provider_auto')}</span>
                  </label>
                  <label
                    className={`provider-option ${aiPrimaryProvider === 'anthropic' ? 'active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ai-primary-provider"
                      value="anthropic"
                      checked={aiPrimaryProvider === 'anthropic'}
                      onChange={() => {
                        setAiPrimaryProvider('anthropic')
                        setAiPrimaryProviderDirty(true)
                      }}
                    />
                    <span>{t('ai.basic.provider_anthropic')}</span>
                  </label>
                  <label
                    className={`provider-option ${aiPrimaryProvider === 'chatglm' ? 'active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ai-primary-provider"
                      value="chatglm"
                      checked={aiPrimaryProvider === 'chatglm'}
                      onChange={() => {
                        setAiPrimaryProvider('chatglm')
                        setAiPrimaryProviderDirty(true)
                      }}
                    />
                    <span>{t('ai.basic.provider_chatglm')}</span>
                  </label>
                  <label
                    className={`provider-option ${aiPrimaryProvider === 'openai' ? 'active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ai-primary-provider"
                      value="openai"
                      checked={aiPrimaryProvider === 'openai'}
                      onChange={() => {
                        setAiPrimaryProvider('openai')
                        setAiPrimaryProviderDirty(true)
                      }}
                    />
                    <span>{t('ai.basic.provider_openai')}</span>
                  </label>
                  <label
                    className={`provider-option ${aiPrimaryProvider === 'deepseek' ? 'active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ai-primary-provider"
                      value="deepseek"
                      checked={aiPrimaryProvider === 'deepseek'}
                      onChange={() => {
                        setAiPrimaryProvider('deepseek')
                        setAiPrimaryProviderDirty(true)
                      }}
                    />
                    <span>{t('ai.basic.provider_deepseek')}</span>
                  </label>
                  <label
                    className={`provider-option ${aiPrimaryProvider === 'kimi' ? 'active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ai-primary-provider"
                      value="kimi"
                      checked={aiPrimaryProvider === 'kimi'}
                      onChange={() => {
                        setAiPrimaryProvider('kimi')
                        setAiPrimaryProviderDirty(true)
                      }}
                    />
                    <span>{t('ai.basic.provider_kimi')}</span>
                  </label>
                </div>
              </div>
              <div className="env-summary">
                <div className="env-block">
                  <div className="env-title">{t('ai.basic.base_urls')}</div>
                  {aiBaseUrlKeys.length === 0 ? (
                    <span className="env-empty">{t('ai.basic.none')}</span>
                  ) : (
                    <div className="env-editor">
                      {aiBaseUrlKeys.map((key: string) => {
                        const isEditing = !!baseUrlEditing[key]
                        return (
                          <div key={key} className="env-row">
                            <div className="env-key">{key}</div>
                            <input
                              className="env-input"
                              value={
                                isEditing
                                  ? baseUrlEditingValue[key] ?? baseUrlDrafts[key] ?? ''
                                  : baseUrlDrafts[key] ?? ''
                              }
                              onChange={(e) => {
                                if (!isEditing) return
                                const value = e.currentTarget.value
                                setBaseUrlEditingValue((prev) => ({ ...prev, [key]: value }))
                              }}
                              readOnly={!isEditing}
                            />
                            <div className="env-actions">
                              {isEditing ? (
                                <>
                                  <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => {
                                      const value = (baseUrlEditingValue[key] ?? baseUrlDrafts[key] ?? '').trim()
                                      setBaseUrlDrafts((prev) => ({ ...prev, [key]: value }))
                                      setBaseUrlDirty((prev) => ({ ...prev, [key]: true }))
                                      setBaseUrlEditing((prev) => ({ ...prev, [key]: false }))
                                      setBaseUrlEditingValue((prev) => ({ ...prev, [key]: '' }))
                                    }}
                                  >
                                    {t('action.confirm')}
                                  </button>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                      setBaseUrlEditing((prev) => ({ ...prev, [key]: false }))
                                      setBaseUrlEditingValue((prev) => ({ ...prev, [key]: '' }))
                                    }}
                                  >
                                    {t('action.cancel')}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                      setBaseUrlEditing((prev) => ({ ...prev, [key]: true }))
                                      setBaseUrlEditingValue((prev) => ({
                                        ...prev,
                                        [key]: baseUrlDrafts[key] ?? '',
                                      }))
                                    }}
                                  >
                                    +
                                  </button>
                                  <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => {
                                      setBaseUrlDrafts((prev) => ({ ...prev, [key]: '' }))
                                      setBaseUrlDirty((prev) => ({ ...prev, [key]: true }))
                                    }}
                                  >
                                    ×
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="env-block">
                  <div className="env-title">{t('ai.basic.api_keys')}</div>
                  {aiApiKeyKeys.length === 0 ? (
                    <span className="env-empty">{t('ai.basic.none')}</span>
                  ) : (
                    <div className="env-editor">
                      {aiApiKeyKeys.map((key: string) => {
                        const isEditing = !!apiKeyEditing[key]
                        const displayMasked = aiConfig?.apiKeys?.[key]?.isSet && !isEditing
                        return (
                          <div key={key} className="env-row">
                            <div className="env-key">{key}</div>
                            {isEditing ? (
                              <input
                                className="env-input"
                                type="text"
                                value={apiKeyEditingValue[key] ?? ''}
                                onChange={(e) => {
                                  const value = e.currentTarget.value
                                  setApiKeyEditingValue((prev) => ({ ...prev, [key]: value }))
                                }}
                              />
                            ) : (
                              <input
                                className="env-input"
                                type="password"
                                value={displayMasked ? '********' : ''}
                                readOnly
                              />
                            )}
                            <div className="env-actions">
                              {isEditing ? (
                                <>
                                  <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => {
                                      const value = (apiKeyEditingValue[key] ?? '').trim()
                                      setApiKeyDrafts((prev) => ({ ...prev, [key]: value }))
                                      setApiKeyDirty((prev) => ({ ...prev, [key]: true }))
                                      setApiKeyEditing((prev) => ({ ...prev, [key]: false }))
                                      setApiKeyEditingValue((prev) => ({ ...prev, [key]: '' }))
                                    }}
                                  >
                                    {t('action.confirm')}
                                  </button>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                      setApiKeyEditing((prev) => ({ ...prev, [key]: false }))
                                      setApiKeyEditingValue((prev) => ({ ...prev, [key]: '' }))
                                    }}
                                  >
                                    {t('action.cancel')}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                      setApiKeyEditing((prev) => ({ ...prev, [key]: true }))
                                    }}
                                  >
                                    +
                                  </button>
                                  <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => {
                                      setApiKeyDrafts((prev) => ({ ...prev, [key]: '' }))
                                      setApiKeyDirty((prev) => ({ ...prev, [key]: true }))
                                    }}
                                  >
                                    ×
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="env-block">
                <div className="env-title">{t('ai.basic.diagnostics')}</div>
                <div className="env-editor">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={loadGatewayLogs}
                    disabled={gatewayLogsLoading}
                  >
                    {gatewayLogsLoading ? <ButtonSpinner /> : null}
                    {t('ai.basic.fetch_gateway_logs')}
                  </button>
                  {gatewayLogsError ? (
                    <div className="error-banner">
                      <span>{gatewayLogsError}</span>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setGatewayLogsError(null)}
                      >
                        {t('action.dismiss')}
                      </button>
                    </div>
                  ) : gatewayLogsOutput ? (
                    <pre className="log-output">{gatewayLogsOutput}</pre>
                  ) : (
                    <span className="env-empty">{t('ai.basic.gateway_logs_empty')}</span>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="section-actions">
            <button
              className="btn btn-secondary"
              onClick={loadAiConfig}
              disabled={aiConfigLoading || aiConfigSaving}
            >
              {t('action.refresh')}
            </button>
            <button
              className="btn btn-primary"
              onClick={saveAiConfig}
              disabled={aiConfigLoading || aiConfigSaving}
            >
              {aiConfigSaving ? <ButtonSpinner /> : null}
              {t('action.confirm')}
            </button>
          </div>
        </section>
      )}

      {storageStatus?.configured && (
        <section className="devices-section">
          <div className="section-header">
            <h2>{t('r2.title')}</h2>
            <div className="header-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => loadR2Objects(true)}
                disabled={r2Loading}
              >
                {r2Loading && <ButtonSpinner />}
                {t('action.refresh')}
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={handleR2DeletePrefix}
                disabled={r2Action !== null || r2Loading || confirmBusy}
              >
                {r2Action === r2Prefix && <ButtonSpinner />}
                {t('r2.delete_prefix')}
              </button>
            </div>
          </div>
          <p className="hint">{t('r2.hint')}</p>
          <div className="r2-toolbar">
            <label className="r2-field">
              <span className="r2-label">{t('r2.prefix.label')}</span>
              <select
                className="r2-select"
                value={r2Prefix}
                onChange={(event) => {
                  const value = event.target.value
                  setR2Prefix(value)
                  setR2Objects([])
                  setR2Cursor(null)
                }}
              >
                {r2PrefixOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="r2-field">
              <span className="r2-label">{t('r2.upload.label')}</span>
              <input
                className="r2-file"
                type="file"
                onChange={(event) => setR2UploadFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleR2Upload}
              disabled={!r2UploadFile || r2Action !== null}
            >
              {r2Action === 'upload' && <ButtonSpinner />}
              {t('r2.upload.action')}
            </button>
          </div>
          {r2Loading ? (
            <div className="loading">
              <div className="spinner"></div>
              <p>{t('r2.loading')}</p>
            </div>
          ) : r2Objects.length === 0 ? (
            <div className="empty-state">
              <p>{t('r2.empty')}</p>
            </div>
          ) : (
            <>
              <div className="devices-grid r2-grid">
                {r2Objects.map((obj) => {
                  const isMarkdown = obj.key.toLowerCase().endsWith('.md')
                  return (
                    <div key={obj.key} className="device-card">
                      <div className="device-header">
                        {isMarkdown ? (
                          <button
                            type="button"
                            className="r2-md-link"
                            onClick={() => handleMdPreview(obj.key)}
                          >
                            {obj.key}
                          </button>
                        ) : (
                          <span className="device-name">{obj.key}</span>
                        )}
                        <div className="device-actions">
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleR2DeleteObject(obj.key)}
                            disabled={r2Action !== null || confirmBusy}
                          >
                            {r2Action === obj.key && <ButtonSpinner />}
                            {obj.key.endsWith('/') ? t('r2.delete_prefix') : t('r2.delete_object')}
                          </button>
                        </div>
                      </div>
                      <div className="device-details">
                        <div className="detail-row">
                          <span className="label">{t('r2.object.size')}</span>
                          <span className="value">{formatBytes(obj.size)}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">{t('r2.object.updated')}</span>
                          <span className="value">{formatSyncTime(obj.uploaded)}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">{t('r2.object.etag')}</span>
                          <span className="value">{obj.etag}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {r2Cursor && (
                <div className="r2-load-more">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadR2Objects(false)}
                    disabled={r2Loading}
                  >
                    {t('r2.load_more')}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {confirmAction && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h3>{t('confirm.title')}</h3>
            </div>
            <div className="modal-body">
              {confirmAction.type === 'delete-prefix'
                ? t('r2.confirm.delete_prefix', { prefix: confirmAction.prefix })
                : t('r2.confirm.delete_object', { key: confirmAction.key })}
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmAction(null)}
                disabled={confirmBusy}
              >
                {t('action.cancel')}
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  const action = confirmAction
                  setConfirmAction(null)
                  await executeR2Delete(action)
                }}
                disabled={confirmBusy}
              >
                {confirmAction.type === 'delete-prefix'
                  ? t('r2.delete_prefix')
                  : t('r2.delete_object')}
              </button>
            </div>
          </div>
        </div>
      )}

      {mdPreview && (
        <div className="modal-backdrop">
          <div className="modal modal-wide">
            <div className="modal-header">
              <h3>{t('r2.preview_title', { key: mdPreview.key })}</h3>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setMdPreview(null)
                  setMdPreviewError(null)
                }}
              >
                {t('action.close')}
              </button>
            </div>
            <div className="modal-body">
              {mdPreviewLoading ? (
                <div className="loading">
                  <div className="spinner"></div>
                  <p>{t('r2.preview_loading')}</p>
                </div>
              ) : mdPreviewError ? (
                <div className="error-banner">
                  <span>{mdPreviewError}</span>
                  <button onClick={() => setMdPreviewError(null)} className="dismiss-btn">
                    {t('action.dismiss')}
                  </button>
                </div>
              ) : (
                <div
                  className="markdown-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(mdPreview.content) }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
