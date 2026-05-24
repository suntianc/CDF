import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(app.getPath('userData'), 'agent-workstation.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Migration check: check if the old "skills" table exists (destructive migration for refactoring)
try {
  const hasOldSkillsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skills'").get();
  if (hasOldSkillsTable) {
    console.log('Migrating database: dropping old database-driven skills tables...');
    db.exec(`
      DROP TABLE IF EXISTS agent_skills;
      DROP TABLE IF EXISTS skill_versions;
      DROP TABLE IF EXISTS skills;
    `);
  }
} catch (error) {
  console.error('Failed to run db migration for skills schema:', error);
}

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS llm_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    api_key TEXT,
    api_url TEXT,
    default_model TEXT NOT NULL,
    context_limit INTEGER NOT NULL DEFAULT 8192,
    is_active INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    tokens INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);

// Safe migration for sessions parent_session_id & summary
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;`);
} catch (error: any) {
  if (!error.message.includes('duplicate column name')) {
    console.error('Failed to migrate sessions table (parent_session_id):', error);
  }
}

// Safe migration for llm_providers models
try {
  db.exec(`ALTER TABLE llm_providers ADD COLUMN models TEXT;`);
} catch (error: any) {
  if (!error.message.includes('duplicate column name')) {
    console.error('Failed to migrate llm_providers table (models):', error);
  }
}

try {
  db.exec(`ALTER TABLE sessions ADD COLUMN summary TEXT;`);
} catch (error: any) {
  if (!error.message.includes('duplicate column name')) {
    console.error('Failed to migrate sessions table (summary):', error);
  }
}

// Phase 3 & Phase 4: Agent Library, Skills, MCP Servers tables
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    provider_id TEXT,
    system_prompt TEXT,
    config TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    server_type TEXT NOT NULL,
    config TEXT,
    is_connected INTEGER DEFAULT 0,
    last_health_check INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_mcp_servers (
    agent_id TEXT NOT NULL,
    mcp_server_id TEXT NOT NULL,
    PRIMARY KEY (agent_id, mcp_server_id),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_skills (
    agent_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    PRIMARY KEY (agent_id, skill_name),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  );
`);

try {
  db.exec(`ALTER TABLE agents ADD COLUMN project_id TEXT;`);
} catch (error: any) {
  if (!error.message.includes('duplicate column name')) {
    console.error('Failed to migrate agents table (project_id):', error);
  }
}

try {
  db.exec(`ALTER TABLE agents ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;`);
} catch (error: any) {
  if (!error.message.includes('duplicate column name')) {
    console.error('Failed to migrate agents table (is_default):', error);
  }
}

try {
  db.prepare(`UPDATE agents SET project_id = ? WHERE project_id IS NULL OR project_id = ''`).run('default-project');
} catch (error) {
  console.error('Failed to backfill agents.project_id:', error);
}

// Insert default project if no projects exist
try {
  const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
  if (projectCount && projectCount.count === 0) {
    const defaultProjectId = 'default-project';
    const defaultProjectName = '默认项目';
    const defaultProjectPath = path.join(app.getPath('userData'), 'default-project');
    const now = Date.now();
    
    // Create physical directory
    if (!fs.existsSync(defaultProjectPath)) {
      fs.mkdirSync(defaultProjectPath, { recursive: true });
    }
    
    db.prepare(`
      INSERT INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(defaultProjectId, defaultProjectName, defaultProjectPath, now, now);
    console.log('Successfully initialized default project:', defaultProjectId);
  }
} catch (error) {
  console.error('Failed to initialize default project:', error);
}

export default db;
