export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
}

export interface Session {
  id: string;
  project_id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface ElectronAPI {
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  db: {
    getProjects: () => Promise<Project[]>;
    createProject: (name: string, projectPath: string) => Promise<Project>;
    deleteProject: (id: string) => Promise<void>;
    getSessions: (projectId: string) => Promise<Session[]>;
    selectDirectory: () => Promise<string | null>;
  };
  platform: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
