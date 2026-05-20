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
  // Session APIs
  sessionCreate: (cwd: string) => Promise<{ id: string; path: string }>
  sessionList: (cwd: string) => Promise<Array<{ id: string; name: string; createdAt: string; messageCount: number }>>
  sessionOpen: (path: string) => Promise<{ id: string; name: string; path: string; messages: any[]; settings: any }>
  sessionSendMessage: (data: { sessionPath: string; content: string; images?: Array<{ data: string; mimeType: string }> }) => Promise<{ entryId: string; sessionId: string }>
  sessionSetName: (sessionPath: string, name: string) => Promise<{ success: boolean }>
  sessionDelete: (sessionPath: string) => Promise<{ success: boolean }>
  sessionStartStream: (sessionPath: string) => void
  sessionStopStream: (sessionPath: string) => void
  sessionOnStreamChunk: (callback: (chunk: any) => void) => () => void
  // GSD APIs
  gsdExecute: (command: string, args: string[], cwd?: string) => Promise<{ success: boolean; output: string; error?: string }>
  gsdListCommands: () => Promise<any[]>
}

interface StreamChunk {
  type: 'text' | 'thinking' | 'toolCall' | 'toolResult' | 'error' | 'done' | 'stopped'
  content: string | any
  metadata?: { timestamp: string; index?: number }
}

interface ApiSession {
  create(cwd: string): Promise<{ id: string; path: string }>
  list(cwd: string): Promise<Array<{ id: string; name: string; createdAt: string; messageCount: number }>>
  open(path: string): Promise<{ id: string; name: string; path: string; messages: any[]; settings: any }>
  sendMessage(data: { sessionPath: string; content: string; images?: Array<{ data: string; mimeType: string }> }): Promise<{ entryId: string; sessionId: string }>
  setName(sessionPath: string, name: string): Promise<{ success: boolean }>
  delete(sessionPath: string): Promise<{ success: boolean }>
  startStream(sessionPath: string): void
  stopStream(sessionPath: string): void
  onStreamChunk(callback: (chunk: StreamChunk) => void): () => void
}

interface GSDCommand {
  id: string
  name: string
  description: string
  args: string
  icon: string
}

interface ApiGSD {
  execute(command: string, args: string[], cwd?: string): Promise<{ success: boolean; output: string; error?: string }>
  listCommands(): Promise<GSDCommand[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      session: ApiSession
      gsd: ApiGSD
    }
    electronAPI: ElectronAPI_Workbench
  }
}