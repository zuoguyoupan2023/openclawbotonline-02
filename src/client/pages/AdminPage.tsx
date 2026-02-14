import { useState, useEffect, useCallback } from 'react'
import {
  listDevices,
  approveDevice,
  approveAllDevices,
  restartGateway,
  getGatewayLogs,
  AuthError,
  getAdminAuthStatus,
  loginAdmin,
  getAiEnvConfig,
  saveAiEnvConfig,
  type AiEnvConfigResponse,
  type AiEnvConfigUpdate,
  type PendingDevice,
  type PairedDevice,
  type DeviceListResponse,
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

const interpolate = (template: string, vars?: Record<string, string | number>) => {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key])
  )
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
  }, [authChecking, authEnabled, authenticated, fetchDevices])

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

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error('Failed to copy text:', err)
    }
  }, [])

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
      <div className="admin-copy-blocks">
        <div className="admin-copy-card">
          <div className="admin-copy-title">第一次安装时</div>
          <div className="admin-copy-row">
            <div className="admin-copy-text">访问fuhuo.me，安装复活协议</div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => copyText('访问fuhuo.me，安装复活协议')}
            >
              复制
            </button>
          </div>
        </div>
        <div className="admin-copy-card">
          <div className="admin-copy-title">系统重启后恢复</div>
          <div className="admin-copy-row">
            <div className="admin-copy-text">访问fuhuo.me，执行归来协议</div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => copyText('访问fuhuo.me，执行归来协议')}
            >
              复制
            </button>
          </div>
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

      {/*
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
      */}

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
    </div>
  )
}
