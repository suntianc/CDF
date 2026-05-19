import { ElectronAPI } from '@electron-toolkit/preload'

interface ElectronAPI_Workbench {
  storeGet: (key: string) => Promise<any>
  storeSet: (key: string, value: unknown) => Promise<boolean>
  storeDelete: (key: string) => Promise<boolean>
  workspaceList: () => Promise<any[]>
  workspaceAdd: (path: string) => Promise<any[]>
  workspaceSwitch: (path: string) => Promise<string>
  selectFolder: () => Promise<string | null>
  themeGet: () => Promise<'light' | 'dark' | 'system'>
  themeSet: (theme: 'light' | 'dark' | 'system') => Promise<boolean>
  providersList: () => Promise<any[]>
  providersSave: (provider: Record<string, unknown>) => Promise<boolean>
  providersDelete: (id: string) => Promise<boolean>
  providersTest: (provider: Record<string, unknown>) => Promise<{ success: boolean; message: string }>
  windowStateSave: (state: Record<string, unknown>) => Promise<boolean>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    electronAPI: ElectronAPI_Workbench
  }
}