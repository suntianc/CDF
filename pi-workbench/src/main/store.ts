import Store from 'electron-store'

interface StoreSchema {
  workspaces: Array<{
    path: string
    name: string
    lastOpened: string
  }>
  providers: Array<{
    id: string
    type: 'anthropic' | 'openai' | 'google' | 'custom'
    name: string
    apiKey: string
    baseUrl?: string
    models: string[]
    defaultModel?: string
  }>
  theme: 'light' | 'dark' | 'system'
  windowState: {
    x?: number
    y?: number
    width: number
    height: number
    maximized: boolean
  }
  lastWorkspace?: string
}

const store = new Store<StoreSchema>({
  defaults: {
    workspaces: [],
    providers: [],
    theme: 'system',
    windowState: { width: 1200, height: 800, maximized: false }
  },
  encryptionKey: 'pi-workbench-store-encryption-key',
  encryptionAlgorithm: 'aes-256-gcm'
})

export default store