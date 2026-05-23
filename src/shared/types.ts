export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
  isGit?: boolean;
}

export interface Session {
  id: string;
  project_id: string;
  name: string;
  parent_session_id?: string | null;
  summary?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
  tokens?: number | null;
}

export interface LLMProvider {
  id: string;
  name: string;
  provider_type: 'openai' | 'anthropic' | 'ollama' | 'custom';
  api_key?: string;
  api_url?: string;
  default_model: string;
  context_limit: number;
  is_active: number;
  hasKey?: boolean;
  models?: string[];
  created_at: number;
  updated_at: number;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  provider_id?: string;
  system_prompt?: string;
  config?: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface Skill {
  id: string;
  name: string;
  description?: string;
  script_content: string;
  script_type: 'bash' | 'python' | 'javascript';
  created_at: number;
  updated_at: number;
}

export interface SkillVersion {
  id: string;
  skill_id: string;
  version_number: number;
  script_content: string;
  created_at: number;
}

export interface MCPServer {
  id: string;
  name: string;
  server_type: string;
  config: Record<string, unknown>;
  is_connected: boolean;
  last_health_check?: number;
  created_at: number;
  updated_at: number;
}

export interface ElectronAPI {
  store: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  db: {
    getProjects: () => Promise<Project[]>;
    createProject: (name: string, projectPath: string) => Promise<Project>;
    deleteProject: (id: string) => Promise<void>;
    getSessions: (projectId: string) => Promise<Session[]>;
    createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string) => Promise<Session>;
    deleteSession: (sessionId: string) => Promise<void>;
    getMessages: (sessionId: string) => Promise<Message[]>;
    saveMessage: (message: any) => Promise<Message>;
    getProviders: () => Promise<LLMProvider[]>;
    saveProvider: (provider: any) => Promise<LLMProvider>;
    deleteProvider: (id: string) => Promise<void>;
    setActiveProvider: (id: string) => Promise<void>;
    selectDirectory: () => Promise<string | null>;
    // Phase 3: Agent Library
    getAgents: () => Promise<Agent[]>;
    saveAgent: (agent: any) => Promise<Agent>;
    deleteAgent: (id: string) => Promise<void>;
    // Phase 3: Skills
    getSkills: () => Promise<Skill[]>;
    saveSkill: (skill: any) => Promise<Skill>;
    deleteSkill: (id: string) => Promise<void>;
    getSkillVersions: (skillId: string) => Promise<SkillVersion[]>;
    // Phase 3: MCP Servers
    getMcpServers: () => Promise<MCPServer[]>;
    saveMcpServer: (server: any) => Promise<MCPServer>;
    deleteMcpServer: (id: string) => Promise<void>;
    checkMcpHealth: (id: string) => Promise<{ ok: boolean; message?: string }>;
    toggleMcpConnection: (id: string, connected: boolean) => Promise<void>;
    selectFile: () => Promise<{ name: string; script_type: 'bash' | 'python' | 'javascript'; content: string } | null>;
  };
  llm: {
    chat: (requestId: string, payload: { providerId: string; model?: string; messages: { role: string; content: string }[] }) => Promise<void>;
    stopChat: (requestId: string) => Promise<void>;
    testProvider: (providerId: string) => Promise<{ ok: boolean; message: string }>;
    fetchProviderModels: (providerId: string) => Promise<string[]>;
    fetchOllamaModels: (apiUrl: string) => Promise<string[]>;
    onChunk: (
      requestId: string,
      callback: (event: any, data: { type: 'chunk' | 'done' | 'error'; text?: string; error?: string }) => void
    ) => () => void;
  };
  deepagents: {
    createAgent: (config: { providerId: string; model: string; systemPrompt?: string; tools?: string[] }) => Promise<{ agentId: string }>;
  };
  platform: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
