import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  activateAiConfig,
  getAiConfig,
  testAiProvider,
  updateAiConfig,
  verifyAiFallback,
  type AiConfigRedacted,
  type AiProviderRedacted,
} from '../../api'

type ProviderDraft = {
  id: string
  type: string
  baseUrl: string
  enabled: boolean
  models: string[]
  apiKeyCount: number
  apiKeys?: string[]
}

type ProviderCatalog = {
  id: string
  type: string
  baseUrl: string
  models: string[]
}

type TestStatus =
  | { state: 'idle'; message?: string }
  | { state: 'loading'; message?: string }
  | { state: 'ok'; message: string }
  | { state: 'error'; message: string }

type AiManagementTabProps = {
  active: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
}

const normalizeList = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

const toDraft = (provider: AiProviderRedacted): ProviderDraft => ({
  id: provider.id,
  type: provider.type,
  baseUrl: provider.baseUrl,
  enabled: provider.enabled,
  models: provider.models ?? [],
  apiKeyCount: provider.apiKeyCount,
})

const providerCatalog: ProviderCatalog[] = [
  {
    id: 'claude',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet-20240620', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  },
  {
    id: 'chatgpt',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
  },
  {
    id: 'gemini',
    type: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  },
  {
    id: 'deepseek',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'qwen',
    type: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-72b-instruct'],
  },
  {
    id: 'kimi',
    type: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  {
    id: 'minimax',
    type: 'openai',
    baseUrl: 'https://api.minimax.chat/v1',
    models: ['abab6.5-chat', 'abab6.5s-chat', 'abab6-chat'],
  },
]

const providerCatalogMap = new Map(providerCatalog.map((provider) => [provider.id, provider]))

const getCatalogModels = (id: string) => providerCatalogMap.get(id)?.models ?? []

const mergeProviders = (stored: AiProviderRedacted[]): ProviderDraft[] => {
  const storedMap = new Map(stored.map((provider) => [provider.id, toDraft(provider)]))
  const catalogProviders = providerCatalog.map((provider) => {
    const existing = storedMap.get(provider.id)
    if (existing) {
      return {
        ...existing,
        type: existing.type || provider.type,
        baseUrl: existing.baseUrl || provider.baseUrl,
      }
    }
    return {
      id: provider.id,
      type: provider.type,
      baseUrl: provider.baseUrl,
      enabled: false,
      models: [],
      apiKeyCount: 0,
    }
  })
  const customProviders = stored
    .filter((provider) => !providerCatalogMap.has(provider.id))
    .map((provider) => storedMap.get(provider.id) as ProviderDraft)
  return [...catalogProviders, ...customProviders]
}

const providerHasKeys = (provider: ProviderDraft) =>
  (provider.apiKeys?.length ?? provider.apiKeyCount) > 0

export default function AiManagementTab({ active, t }: AiManagementTabProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<AiConfigRedacted | null>(null)
  const [providers, setProviders] = useState<ProviderDraft[]>([])
  const [hasMasterKey, setHasMasterKey] = useState(false)
  const [primaryProviderId, setPrimaryProviderId] = useState<string>('')
  const [primaryModel, setPrimaryModel] = useState<string>('')
  const [fallbackOrderIds, setFallbackOrderIds] = useState<string[]>([])
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({})
  const [verifyResults, setVerifyResults] = useState<Record<string, TestStatus>>({})

  const [modalOpen, setModalOpen] = useState(false)
  const [modalSaving, setModalSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftId, setDraftId] = useState('')
  const [draftType, setDraftType] = useState('openai')
  const [draftBaseUrl, setDraftBaseUrl] = useState('')
  const [draftModelsText, setDraftModelsText] = useState('')
  const [draftModelsSelected, setDraftModelsSelected] = useState<string[]>([])
  const [draftApiKeys, setDraftApiKeys] = useState('')
  const [draftApiKeysTouched, setDraftApiKeysTouched] = useState(false)
  const draftCatalogModels = useMemo(() => getCatalogModels(draftId), [draftId])

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await getAiConfig()
      setConfig(response.config)
      setProviders(mergeProviders(response.config.providers))
      setHasMasterKey(response.hasMasterKey)
      setPrimaryProviderId(response.config.primaryProviderId ?? '')
      setPrimaryModel(response.config.primaryModel ?? '')
      setFallbackOrderIds(response.config.fallbackOrder)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ai.load_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (active && !config && !loading) {
      loadConfig()
    }
  }, [active, config, loadConfig, loading])

  const enabledProviders = useMemo(() => providers.filter((item) => item.enabled), [providers])
  const enabledProviderIds = useMemo(() => enabledProviders.map((item) => item.id), [enabledProviders])

  useEffect(() => {
    setFallbackOrderIds((prev) => {
      const filtered = prev.filter((id) => enabledProviderIds.includes(id))
      const missing = enabledProviderIds.filter((id) => !filtered.includes(id))
      const next = [...filtered, ...missing]
      return next
    })
  }, [enabledProviderIds])

  const availableModels = useMemo(() => {
    const provider = enabledProviders.find((item) => item.id === primaryProviderId)
    return provider?.models ?? []
  }, [enabledProviders, primaryProviderId])

  useEffect(() => {
    if (primaryProviderId && !enabledProviders.some((item) => item.id === primaryProviderId)) {
      setPrimaryProviderId('')
      setPrimaryModel('')
      return
    }
    if (primaryModel && availableModels.includes(primaryModel)) return
    if (availableModels.length > 0) {
      setPrimaryModel(availableModels[0])
    } else if (primaryModel) {
      setPrimaryModel('')
    }
  }, [availableModels, enabledProviders, primaryModel, primaryProviderId])

  const openCreateModal = () => {
    setEditingId(null)
    setDraftId('')
    setDraftType('openai')
    setDraftBaseUrl('')
    setDraftModelsText('')
    setDraftModelsSelected([])
    setDraftApiKeys('')
    setDraftApiKeysTouched(false)
    setModalOpen(true)
  }

  const openEditModal = (provider: ProviderDraft) => {
    setEditingId(provider.id)
    setDraftId(provider.id)
    setDraftType(provider.type)
    setDraftBaseUrl(provider.baseUrl)
    setDraftModelsText(provider.models.join('\n'))
    setDraftModelsSelected(provider.models)
    setDraftApiKeys('')
    setDraftApiKeysTouched(false)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
  }

  const handleSaveProvider = async () => {
    if (!hasMasterKey) {
      setError(t('ai.master_key_missing'))
      return
    }
    const id = draftId.trim()
    const type = draftType.trim()
    const baseUrl = draftBaseUrl.trim()
    if (!id || !type || !baseUrl) {
      setError(t('ai.provider.required'))
      return
    }
    const existingIndex = providers.findIndex((item) => item.id === id)
    if (existingIndex >= 0 && id !== editingId) {
      setError(t('ai.provider.duplicate'))
      return
    }
    const useCatalogModels = draftCatalogModels.length > 0
    const models = useCatalogModels ? draftModelsSelected : normalizeList(draftModelsText)
    const apiKeys = draftApiKeysTouched ? normalizeList(draftApiKeys) : undefined
    const apiKeyCount = apiKeys ? apiKeys.length : providers.find((item) => item.id === editingId)?.apiKeyCount ?? 0
    const currentEnabled = providers.find((item) => item.id === editingId)?.enabled ?? false
    const nextEnabled = currentEnabled && (apiKeys ? apiKeys.length > 0 : apiKeyCount > 0)
    const nextProvider: ProviderDraft = {
      id,
      type,
      baseUrl,
      enabled: nextEnabled,
      models,
      apiKeyCount,
      apiKeys,
    }
    const nextProviders = [...providers]
    if (editingId) {
      const index = nextProviders.findIndex((item) => item.id === editingId)
      if (index >= 0) {
        nextProviders[index] = nextProvider
      } else {
        nextProviders.push(nextProvider)
      }
    } else {
      nextProviders.push(nextProvider)
    }
    setModalSaving(true)
    setError(null)
    try {
      const response = await updateAiConfig({
        providers: nextProviders.map((provider) => {
          const hasKeys = providerHasKeys(provider)
          return {
            id: provider.id,
            type: provider.type,
            baseUrl: provider.baseUrl,
            enabled: provider.enabled && hasKeys,
            models: provider.models,
            ...(provider.apiKeys ? { apiKeys: provider.apiKeys } : {}),
          }
        }),
      })
      setConfig(response.config)
      setProviders(mergeProviders(response.config.providers))
      setModalOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ai.save_error'))
      setProviders(nextProviders)
    } finally {
      setModalSaving(false)
    }
  }

  const handleToggleProviderEnabled = (providerId: string, nextEnabled: boolean) => {
    const provider = providers.find((item) => item.id === providerId)
    if (!provider) return
    if (nextEnabled && !providerHasKeys(provider)) {
      setError(t('ai.provider.enable_requires_key'))
      return
    }
    setProviders((prev) =>
      prev.map((item) => (item.id === providerId ? { ...item, enabled: nextEnabled } : item))
    )
    if (!nextEnabled && primaryProviderId === providerId) {
      setPrimaryProviderId('')
      setPrimaryModel('')
    }
  }

  const handleDeleteProvider = (providerId: string) => {
    if (!confirm(t('ai.confirm_delete_provider', { id: providerId }))) return
    const nextProviders = providers.filter((item) => item.id !== providerId)
    setProviders(nextProviders)
    if (primaryProviderId === providerId) {
      setPrimaryProviderId('')
      setPrimaryModel('')
    }
    setFallbackOrderIds((prev) => prev.filter((id) => id !== providerId))
  }

  const handleSaveProviders = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await updateAiConfig({
        providers: providers.map((provider) => {
          const hasKeys = providerHasKeys(provider)
          return {
            id: provider.id,
            type: provider.type,
            baseUrl: provider.baseUrl,
            enabled: provider.enabled && hasKeys,
            models: provider.models,
            ...(provider.apiKeys ? { apiKeys: provider.apiKeys } : {}),
          }
        }),
      })
      setConfig(response.config)
      setProviders(mergeProviders(response.config.providers))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ai.save_error'))
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async () => {
    setActivating(true)
    setError(null)
    try {
      const response = await activateAiConfig({
        primaryProviderId: primaryProviderId || null,
        primaryModel: primaryModel || null,
        fallbackOrder: fallbackOrderIds,
      })
      setConfig(response.config)
      setProviders(mergeProviders(response.config.providers))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ai.activate_error'))
    } finally {
      setActivating(false)
    }
  }

  const handleTestProvider = async (providerId: string) => {
    setTestStatus((prev) => ({ ...prev, [providerId]: { state: 'loading' } }))
    try {
      const response = await testAiProvider({ providerId })
      if (response.ok) {
        setTestStatus((prev) => ({
          ...prev,
          [providerId]: { state: 'ok', message: t('ai.test_result_ok') },
        }))
      } else {
        setTestStatus((prev) => ({
          ...prev,
          [providerId]: {
            state: 'error',
            message: t('ai.test_result_fail', { status: response.status }),
          },
        }))
      }
    } catch (err) {
      setTestStatus((prev) => ({
        ...prev,
        [providerId]: {
          state: 'error',
          message: err instanceof Error ? err.message : t('ai.test_result_fail', { status: 0 }),
        },
      }))
    }
  }

  const handleVerifyFallback = async () => {
    setVerifying(true)
    setError(null)
    try {
      const response = await verifyAiFallback()
      const next: Record<string, TestStatus> = {}
      response.results.forEach((result) => {
        next[result.id] = result.ok
          ? { state: 'ok', message: t('ai.fallback.ok') }
          : { state: 'error', message: result.error || t('ai.fallback.fail') }
      })
      setVerifyResults(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ai.verify_error'))
    } finally {
      setVerifying(false)
    }
  }

  const handleReorderFallback = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    setFallbackOrderIds((prev) => {
      const next = [...prev]
      const fromIndex = next.indexOf(sourceId)
      const toIndex = next.indexOf(targetId)
      if (fromIndex === -1 || toIndex === -1) return prev
      next.splice(fromIndex, 1)
      next.splice(toIndex, 0, sourceId)
      return next
    })
  }

  if (!active) return null

  return (
    <div className="ai-management">
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="dismiss-btn">
            {t('action.dismiss')}
          </button>
        </div>
      )}

      {!hasMasterKey && (
        <div className="warning-banner">
          <div className="warning-content">
            <strong>{t('ai.master_key_missing')}</strong>
          </div>
        </div>
      )}

      <section className="devices-section">
        <div className="section-header">
          <h2>{t('ai.title')}</h2>
          <div className="header-actions">
            <button className="btn btn-secondary btn-sm" onClick={openCreateModal}>
              {t('ai.add_provider')}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSaveProviders}
              disabled={saving || !hasMasterKey}
            >
              {saving ? t('ai.saving') : t('ai.save')}
            </button>
          </div>
        </div>
        <p className="hint">{t('ai.hint')}</p>
        {loading ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>{t('ai.loading')}</p>
          </div>
        ) : providers.length === 0 ? (
          <div className="empty-state">
            <p>{t('ai.no_providers')}</p>
          </div>
        ) : (
          <div className="ai-table-wrapper">
            <table className="ai-table">
              <thead>
                <tr>
                  <th>{t('ai.provider.id')}</th>
                  <th>{t('ai.provider.type')}</th>
                  <th>{t('ai.provider.base_url')}</th>
                  <th>{t('ai.provider.models')}</th>
                  <th>{t('ai.provider.api_key_count')}</th>
                  <th>{t('ai.provider.enabled')}</th>
                  <th>{t('ai.provider.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((provider) => {
                  const modelsText =
                    provider.models.length > 0 ? provider.models.join(', ') : t('ai.provider.no_models_selected')
                  const status = testStatus[provider.id] ?? { state: 'idle' }
                  const verify = verifyResults[provider.id]
                  const hasKeys = providerHasKeys(provider)
                  return (
                    <tr key={provider.id} className={provider.enabled ? '' : 'ai-row-disabled'}>
                      <td>{provider.id}</td>
                      <td>{provider.type}</td>
                      <td>{provider.baseUrl}</td>
                      <td>{modelsText}</td>
                      <td>{provider.apiKeys?.length ?? provider.apiKeyCount}</td>
                      <td>
                        <label className="ai-toggle">
                          <input
                            type="checkbox"
                            checked={provider.enabled}
                            disabled={!hasKeys}
                            onChange={(event) =>
                              handleToggleProviderEnabled(provider.id, event.target.checked)
                            }
                          />
                        </label>
                      </td>
                      <td>
                        <div className="ai-row-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEditModal(provider)}
                          >
                            {t('action.edit')}
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleTestProvider(provider.id)}
                            disabled={status.state === 'loading' || !hasKeys}
                          >
                            {status.state === 'loading' ? t('ai.provider.testing') : t('ai.provider.test')}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteProvider(provider.id)}
                          >
                            {t('ai.delete_provider')}
                          </button>
                        </div>
                        {status.state !== 'idle' && status.message && (
                          <div className={`ai-status ai-status-${status.state}`}>
                            {status.message}
                          </div>
                        )}
                        {verify && verify.state !== 'idle' && verify.message && (
                          <div className={`ai-status ai-status-${verify.state}`}>
                            {verify.message}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="devices-section">
        <div className="section-header">
          <h2>{t('ai.primary.title')}</h2>
          <div className="header-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleActivate}
              disabled={activating || !hasMasterKey || enabledProviders.length === 0}
            >
              {activating ? t('ai.primary.activating') : t('ai.primary.activate')}
            </button>
          </div>
        </div>
        <div className="ai-form-grid">
          <label className="ai-field">
            <span className="ai-label">{t('ai.primary.provider')}</span>
            <select
              className="ai-input"
              value={primaryProviderId}
              onChange={(event) => setPrimaryProviderId(event.target.value)}
            >
              <option value="">{t('ai.primary.none')}</option>
              {enabledProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.id}
                </option>
              ))}
            </select>
          </label>
          <label className="ai-field">
            <span className="ai-label">{t('ai.primary.model')}</span>
            <select
              className="ai-input"
              value={primaryModel}
              onChange={(event) => setPrimaryModel(event.target.value)}
              disabled={!primaryProviderId}
            >
              <option value="">{t('ai.primary.model_placeholder')}</option>
              {availableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label className="ai-field ai-field-wide">
            <span className="ai-label">{t('ai.fallback.title')}</span>
            {enabledProviderIds.length === 0 ? (
              <div className="ai-fallback-empty">{t('ai.fallback.empty')}</div>
            ) : (
              <div className="ai-fallback-list">
                {fallbackOrderIds.map((id) => (
                  <div
                    key={id}
                    className="ai-fallback-item"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', id)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      const sourceId = event.dataTransfer.getData('text/plain')
                      if (sourceId) handleReorderFallback(sourceId, id)
                    }}
                  >
                    <span className="ai-fallback-handle">⋮⋮</span>
                    <span>{id}</span>
                  </div>
                ))}
              </div>
            )}
            <span className="ai-fallback-hint">{t('ai.fallback.hint')}</span>
          </label>
          <div className="ai-field ai-field-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleVerifyFallback}
              disabled={verifying}
            >
              {verifying ? t('ai.fallback.verifying') : t('ai.fallback.verify')}
            </button>
          </div>
        </div>
      </section>

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h3>{editingId ? t('ai.edit_provider') : t('ai.add_provider')}</h3>
              <button className="btn btn-secondary btn-sm" onClick={closeModal}>
                {t('action.close')}
              </button>
            </div>
            <div className="modal-body">
              <div className="ai-form-grid">
                <label className="ai-field">
                  <span className="ai-label">{t('ai.provider.id')}</span>
                  <input
                    className="ai-input"
                    value={draftId}
                    onChange={(event) => setDraftId(event.target.value)}
                  />
                </label>
                <label className="ai-field">
                  <span className="ai-label">{t('ai.provider.type')}</span>
                  <input
                    className="ai-input"
                    list="ai-provider-types"
                    value={draftType}
                    onChange={(event) => setDraftType(event.target.value)}
                  />
                  <datalist id="ai-provider-types">
                    <option value="openai" />
                    <option value="anthropic" />
                    <option value="workers-ai" />
                  </datalist>
                </label>
                <label className="ai-field ai-field-wide">
                  <span className="ai-label">{t('ai.provider.base_url')}</span>
                  <input
                    className="ai-input"
                    value={draftBaseUrl}
                    onChange={(event) => setDraftBaseUrl(event.target.value)}
                  />
                </label>
                <label className="ai-field ai-field-wide">
                  <span className="ai-label">{t('ai.provider.models')}</span>
                  {draftCatalogModels.length > 0 ? (
                    <div className="ai-models-grid">
                      {draftCatalogModels.map((model) => (
                        <label key={model} className="ai-model-option">
                          <input
                            type="checkbox"
                            checked={draftModelsSelected.includes(model)}
                            onChange={(event) => {
                              const checked = event.target.checked
                              setDraftModelsSelected((prev) =>
                                checked ? [...prev, model] : prev.filter((item) => item !== model)
                              )
                            }}
                          />
                          <span>{model}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <textarea
                      className="ai-textarea"
                      value={draftModelsText}
                      onChange={(event) => setDraftModelsText(event.target.value)}
                      placeholder={t('ai.provider.models_hint')}
                    />
                  )}
                </label>
                <label className="ai-field ai-field-wide">
                  <span className="ai-label">{t('ai.provider.api_keys')}</span>
                  <textarea
                    className="ai-textarea"
                    value={draftApiKeys}
                    onChange={(event) => {
                      setDraftApiKeys(event.target.value)
                      setDraftApiKeysTouched(true)
                    }}
                    placeholder={t('ai.provider.api_keys_hint')}
                  />
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-sm" onClick={closeModal}>
                {t('action.cancel')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveProvider}
                disabled={modalSaving}
              >
                {modalSaving ? t('ai.saving') : t('action.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
