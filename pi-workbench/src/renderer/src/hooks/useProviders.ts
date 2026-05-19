import { useState, useEffect, useCallback } from 'react'

interface Provider {
  id: string
  type: 'anthropic' | 'openai' | 'google' | 'custom'
  name: string
  apiKey: string
  baseUrl?: string
  models: string[]
  defaultModel?: string
}

// Preset provider templates
const PRESET_PROVIDERS: Array<Omit<Provider, 'id' | 'apiKey' | 'models' | 'defaultModel'>> = [
  { type: 'anthropic', name: 'Anthropic' },
  { type: 'openai', name: 'OpenAI' },
  { type: 'google', name: 'Google' }
]

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.electronAPI.providersList().then((list) => {
      setProviders(list)
      setLoading(false)
    })
  }, [])

  const saveProvider = useCallback(async (provider: Omit<Provider, 'id'> & { id?: string }) => {
    const p: Provider = {
      ...provider,
      id: provider.id || `${provider.type}-${Date.now()}`
    }
    await window.electronAPI.providersSave(p as unknown as Record<string, unknown>)
    const updated = await window.electronAPI.providersList()
    setProviders(updated)
    return p.id
  }, [])

  const deleteProvider = useCallback(async (id: string) => {
    await window.electronAPI.providersDelete(id)
    const updated = await window.electronAPI.providersList()
    setProviders(updated)
  }, [])

  const testConnection = useCallback(async (provider: Omit<Provider, 'id'>) => {
    return await window.electronAPI.providersTest(provider)
  }, [])

  return {
    providers,
    loading,
    presets: PRESET_PROVIDERS,
    saveProvider,
    deleteProvider,
    testConnection
  }
}