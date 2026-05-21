import { ElectronAPI } from '@electron-toolkit/preload'

interface ElectronAPI_Workbench {
  storeGet: (key: string) => Promise<any>
  storeSet: (key: string, value: unknown) => Promise<boolean>
  storeDelete: (key: string) => Promise<boolean>
  workspaceList: () => Promise<any[]>
  workspaceAdd: (path: string) => Promise<any[]>
  workspaceSwitch: (path: string) => Promise<string>
  workspaceGetContext: (path: string) => Promise<{
    git: {
      available: boolean
      branch: string
      changedFiles: number
      stagedFiles: number
      ahead: number
      behind: number
      lastCommit: string
    }
    workflow: {
      available: boolean
      workflowCount: number
      currentPhase: string
      status: string
      phaseSummary: string
    }
  }>
  selectFolder: () => Promise<string | null>
  themeGet: () => Promise<'light' | 'dark' | 'system'>
  themeSet: (theme: 'light' | 'dark' | 'system') => Promise<boolean>
  providersList: () => Promise<any[]>
  providersSave: (provider: Record<string, unknown>) => Promise<boolean>
  providersDelete: (id: string) => Promise<boolean>
  providersTest: (provider: Record<string, unknown>) => Promise<{ success: boolean; message: string }>
  windowStateSave: (state: Record<string, unknown>) => Promise<boolean>
  // Session APIs
  sessionCreate: (cwd: string, modelId?: string) => Promise<{ id: string; path: string; name: string; modelProvider?: string; modelId?: string }>
  sessionList: (cwd: string) => Promise<Array<{ id: string; path: string; name: string; createdAt: string; messageCount: number }>>
  sessionOpen: (path: string) => Promise<{ id: string; name: string; path: string; messages: any[]; settings: any }>
  sessionSendMessage: (data: { sessionPath: string; content: string; images?: Array<{ data: string; mimeType: string }> }) => Promise<{ success: boolean }>
  sessionSetName: (sessionPath: string, name: string) => Promise<{ success: boolean }>
  sessionDelete: (sessionPath: string) => Promise<{ success: boolean }>
  sessionSetModel: (sessionPath: string, modelId: string) => Promise<{ success: boolean; modelProvider?: string; modelId?: string }>
  sessionGetAvailableModels: () => Promise<Array<{ provider: string; id: string; name: string }>>
  sessionStartStream: (sessionPath: string) => void
  sessionStopStream: (sessionPath: string) => void
  sessionOnStreamChunk: (callback: (chunk: any) => void) => () => void
  // GSD APIs
  gsdExecute: (command: string, args: string[], cwd?: string) => Promise<{ success: boolean; output: string; error?: string }>
  gsdListCommands: () => Promise<any[]>
}

interface ModelInfo {
  provider: string
  id: string
  name: string
}

interface StreamChunk {
  type: 'text' | 'thinking' | 'tool_start' | 'tool_output' | 'tool_end' | 'info' | 'message_start' | 'agent_start' | 'error' | 'done' | 'stopped'
  content?: string
  name?: string
  args?: Record<string, any>
  isError?: boolean
  metadata?: { timestamp: string; index?: number }
}

interface StreamToken {
  type: 'token' | 'end' | 'error'
  delta?: string
  message?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  streaming?: boolean
  status?: 'sending' | 'sent' | 'error'
}

interface ConversationMeta {
  id: string
  name: string
  path: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface ApiChatHistory {
  create(workspacePath: string, name?: string): Promise<{ id: string; path: string }>
  list(workspacePath: string): Promise<ConversationMeta[]>
  load(path: string, offset?: number, limit?: number): Promise<Message[]>
  save(path: string, messages: Message[]): Promise<{ success: boolean }>
  append(path: string, message: Message): Promise<{ success: boolean }>
  delete(path: string): Promise<{ success: boolean }>
  updateMeta(path: string, meta: Partial<ConversationMeta>): Promise<{ success: boolean }>
}

interface ApiSession {
  create(cwd: string, modelId?: string): Promise<{ id: string; path: string; name: string; modelProvider?: string; modelId?: string }>
  list(cwd: string): Promise<Array<{ id: string; path: string; name: string; createdAt: string; messageCount: number }>>
  open(path: string): Promise<{ id: string; name: string; path: string; messages: any[]; settings: any }>
  sendMessage(data: { sessionPath: string; content: string; images?: Array<{ data: string; mimeType: string }> }): Promise<{ success: boolean }>
  setName(sessionPath: string, name: string): Promise<{ success: boolean }>
  delete(sessionPath: string): Promise<{ success: boolean }>
  setModel(sessionPath: string, modelId: string): Promise<{ success: boolean; modelProvider?: string; modelId?: string }>
  getAvailableModels(): Promise<Array<{ provider: string; id: string; name: string }>>
  // Channel event pattern streaming (D-02)
  startStream(sessionPath: string): Promise<string>
  stopStream(streamId: string): void
  onStreamToken(streamId: string, callback: (data: StreamToken) => void): () => void
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
      chatHistory: ApiChatHistory
    }
    electronAPI: ElectronAPI_Workbench
  }
}
