import { useState, useEffect, useCallback } from 'react'
import {
  listDevices,
  approveDevice,
  approveAllDevices,
  restartGateway,
  getStorageStatus,
  triggerSync,
  AuthError,
  type PendingDevice,
  type PairedDevice,
  type DeviceListResponse,
  type StorageStatusResponse,
} from '../api'
import enTranslations from '../locals/en.json'
import zhTranslations from '../locals/cn-zh.json'
import './AdminPage.css'

// Small inline spinner for buttons
function ButtonSpinner() {
  return <span className="btn-spinner" />
}

type Locale = 'en' | 'zh-CN'

const translations = {
  en: enTranslations,
  'zh-CN': zhTranslations,
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
    return stored === 'zh-CN' || stored === 'en' ? stored : 'en'
  })
  const [pending, setPending] = useState<PendingDevice[]>([])
  const [paired, setPaired] = useState<PairedDevice[]>([])
  const [storageStatus, setStorageStatus] = useState<StorageStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [restartInProgress, setRestartInProgress] = useState(false)
  const [syncInProgress, setSyncInProgress] = useState(false)

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

  const dateLocale = locale === 'zh-CN' ? 'zh-CN' : 'en-US'

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
      if (err instanceof AuthError) {
        setError(t('error.auth_required'))
      } else {
        setError(err instanceof Error ? err.message : t('error.fetch_devices'))
      }
    } finally {
      setLoading(false)
    }
  }, [t])

  const fetchStorageStatus = useCallback(async () => {
    try {
      const status = await getStorageStatus()
      setStorageStatus(status)
    } catch (err) {
      // Don't show error for storage status - it's not critical
      console.error(t('error.fetch_storage_status'), err)
    }
  }, [t])

  useEffect(() => {
    fetchDevices()
    fetchStorageStatus()
  }, [fetchDevices, fetchStorageStatus])

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

  const handleSync = async () => {
    setSyncInProgress(true)
    try {
      const result = await triggerSync()
      if (result.success) {
        // Update the storage status with new lastSync time
        setStorageStatus(prev => prev ? { ...prev, lastSync: result.lastSync || null } : null)
        setError(null)
      } else {
        setError(result.error || t('error.sync_failed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.sync'))
    } finally {
      setSyncInProgress(false)
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

  return (
    <div className="devices-page">
      <div className="page-toolbar">
        <div className="language-toggle">
          <button
            className={`lang-btn ${locale === 'en' ? 'active' : ''}`}
            onClick={() => setLocale('en')}
            aria-label={t('language.english')}
          >
            <span className="flag">🇺🇸</span>
            <span>EN</span>
          </button>
          <button
            className={`lang-btn ${locale === 'zh-CN' ? 'active' : ''}`}
            onClick={() => setLocale('zh-CN')}
            aria-label={t('language.chinese')}
          >
            <span className="flag">🇨🇳</span>
            <span>中文</span>
          </button>
        </div>
      </div>
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
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleSync}
              disabled={syncInProgress}
            >
              {syncInProgress && <ButtonSpinner />}
              {syncInProgress ? t('storage.syncing') : t('storage.backup_now')}
            </button>
          </div>
        </div>
      )}

      <section className="devices-section gateway-section">
        <div className="section-header">
          <h2>{t('gateway.title')}</h2>
          <button
            className="btn btn-danger"
            onClick={handleRestartGateway}
            disabled={restartInProgress}
          >
            {restartInProgress && <ButtonSpinner />}
            {restartInProgress ? t('gateway.restarting') : t('gateway.restart')}
          </button>
        </div>
        <p className="hint">
          {t('gateway.hint')}
        </p>
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
    </div>
  )
}
