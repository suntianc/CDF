import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(app.getPath('userData'), 'cdf.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
    agent_id TEXT,
    summary TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
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

// Safe migration helper - ignores 'duplicate column name' errors
const safeMigrate = (description: string, sql: string) => {
  try {
    db.exec(sql);
  } catch (error: any) {
    if (!error.message.includes('duplicate column name')) {
      console.error(`Failed to migrate ${description}:`, error);
    }
  }
};

// Safe migration for sessions parent_session_id & summary
safeMigrate('sessions table (parent_session_id)', `ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;`);
safeMigrate('sessions table (agent_id)', `ALTER TABLE sessions ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL;`);

// Safe migration for llm_providers models
safeMigrate('llm_providers table (models)', `ALTER TABLE llm_providers ADD COLUMN models TEXT;`);

// Safe migration for sessions summary
safeMigrate('sessions table (summary)', `ALTER TABLE sessions ADD COLUMN summary TEXT;`);

// Tool configs table for built-in tools with API keys
db.exec(`
  CREATE TABLE IF NOT EXISTS tool_configs (
    id TEXT PRIMARY KEY,
    tool_type TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    api_key TEXT,
    config TEXT,
    is_enabled INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

// Data migration: rename provider_type to match lobehub icon enum values
try {
  db.prepare("UPDATE llm_providers SET provider_type = 'zhipu' WHERE provider_type = 'glm'").run();
  db.prepare("UPDATE llm_providers SET provider_type = 'moonshot' WHERE provider_type = 'kimi'").run();
  db.prepare("UPDATE llm_providers SET provider_type = 'xiaomimimo' WHERE provider_type = 'mimo'").run();
} catch (error) {
  console.error('Failed to migrate provider_type values:', error);
}

// Phase 3 & Phase 4: Agent Library, Skills, MCP Servers tables

// Phase 3 & Phase 4: Agent Library, Skills, MCP Servers tables
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT,
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

  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    aborted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input TEXT,
    output TEXT,
    status TEXT NOT NULL,
    error TEXT,
    approval_status TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
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

// D-03: Add slug column for stable task(name) key
try {
  db.exec(`ALTER TABLE agents ADD COLUMN slug TEXT`);
} catch (error: any) {
  if (!error.message.includes('duplicate column name')) {
    console.error('Failed to migrate agents table (slug):', error);
  }
}

// D-03: Backfill existing agents' slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
try {
  const agentsWithoutSlug = db.prepare("SELECT id, name FROM agents WHERE slug IS NULL OR slug = ''").all() as Array<{ id: string; name: string }>;
  for (const agent of agentsWithoutSlug) {
    const slug = generateSlug(agent.name);
    db.prepare('UPDATE agents SET slug = ? WHERE id = ?').run(slug, agent.id);
  }
} catch (error) {
  console.error('Failed to backfill agents.slug:', error);
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

// Insert default LLM providers if none exist
try {
  const providerCount = db.prepare('SELECT COUNT(*) as count FROM llm_providers').get() as { count: number };
  if (providerCount && providerCount.count === 0) {
    const now = Date.now();
    const defaultProviders = [
      {
        id: 'default-openai',
        name: 'OpenAI',
        provider_type: 'openai',
        api_url: 'https://api.openai.com/v1',
        default_model: 'gpt-4o',
        context_limit: 8192,
        is_active: 1, // 默认激活 OpenAI
        models: JSON.stringify(['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'])
      },
      {
        id: 'default-anthropic',
        name: 'Anthropic',
        provider_type: 'anthropic',
        api_url: 'https://api.anthropic.com/v1',
        default_model: 'claude-3-5-sonnet-20241022',
        context_limit: 200000,
        is_active: 0,
        models: JSON.stringify(['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-5-haiku-20241022'])
      },
      {
        id: 'default-deepseek',
        name: 'DeepSeek',
        provider_type: 'deepseek',
        api_url: 'https://api.deepseek.com',
        default_model: 'deepseek-chat',
        context_limit: 64000,
        is_active: 0,
        models: JSON.stringify(['deepseek-chat', 'deepseek-coder'])
      },
      {
        id: 'default-glm',
        name: 'GLM CN',
        provider_type: 'zhipu',
        api_url: 'https://open.bigmodel.cn/api/paas/v4',
        default_model: 'glm-4-flash',
        context_limit: 128000,
        is_active: 0,
        models: JSON.stringify(['glm-4-flash', 'glm-4-plus', 'glm-4-air'])
      },
      {
        id: 'default-glm-overseas',
        name: 'GLM EN',
        provider_type: 'glm-overseas',
        api_url: 'https://open.bigmodel.cn/api/paas/v4',
        default_model: 'glm-4-flash',
        context_limit: 128000,
        is_active: 0,
        models: JSON.stringify(['glm-4-flash', 'glm-4-plus'])
      },
      {
        id: 'default-minimax',
        name: 'Minimax CN',
        provider_type: 'minimax',
        api_url: 'https://api.minimaxi.com/anthropic/v1',
        default_model: 'MiniMax-M3',
        context_limit: 1000000,
        is_active: 0,
        models: JSON.stringify(['MiniMax-M3', 'MiniMax-M2.7-highspeed', 'abab6.5g-chat'])
      },
      {
        id: 'default-minimax-overseas',
        name: 'Minimax EN',
        provider_type: 'minimax-overseas',
        api_url: 'https://api.minimax.io/anthropic/v1',
        default_model: 'MiniMax-M3',
        context_limit: 1000000,
        is_active: 0,
        models: JSON.stringify(['MiniMax-M3', 'MiniMax-M2.5'])
      },
      {
        id: 'default-kimi',
        name: 'Kimi',
        provider_type: 'moonshot',
        api_url: 'https://api.moonshot.ai/v1',
        default_model: 'moonshot-v1-8k',
        context_limit: 128000,
        is_active: 0,
        models: JSON.stringify(['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'])
      },
      {
        id: 'default-qwen',
        name: 'Qwen',
        provider_type: 'qwen',
        api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        default_model: 'qwen-plus',
        context_limit: 128000,
        is_active: 0,
        models: JSON.stringify(['qwen-plus', 'qwen-turbo', 'qwen-max'])
      },
      {
        id: 'default-mimo',
        name: 'Xiaomi MiMo',
        provider_type: 'xiaomimimo',
        api_url: 'https://api.xiaomimimo.com/v1',
        default_model: 'mimo-chat',
        context_limit: 64000,
        is_active: 0,
        models: JSON.stringify(['mimo-chat'])
      },
      {
        id: 'default-ollama',
        name: 'Ollama',
        provider_type: 'ollama',
        api_url: 'http://localhost:11434',
        default_model: 'llama3',
        context_limit: 8192,
        is_active: 0,
        models: JSON.stringify(['llama3'])
      }
    ];

    const insertProvider = db.prepare(`
      INSERT INTO llm_providers (id, name, provider_type, api_url, default_model, context_limit, is_active, models, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of defaultProviders) {
      insertProvider.run(p.id, p.name, p.provider_type, p.api_url, p.default_model, p.context_limit, p.is_active, p.models, now, now);
    }
    console.log('Successfully initialized default LLM providers');
  }
} catch (error) {
  console.error('Failed to initialize default LLM providers:', error);
}

// ===== Phase 4: Workflow System Tables =====

db.exec(`
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    graph_data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workflow_executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    trigger_source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input TEXT,
    output TEXT,
    error TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workflow_node_runs (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    node_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input TEXT,
    output TEXT,
    error TEXT,
    error_type TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    logs TEXT,
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);
  CREATE INDEX IF NOT EXISTS idx_executions_workflow ON workflow_executions(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_node_runs_execution ON workflow_node_runs(execution_id);
`);

try {
  db.prepare('ALTER TABLE workflow_node_runs ADD COLUMN logs TEXT').run();
} catch (err) {
  // Column already exists
}

// 工具调用结构化记录（导出 JSON 用,跨 invokeAgent 累积）
try { db.exec(`ALTER TABLE workflow_node_runs ADD COLUMN tool_calls TEXT`); } catch {}

// 工作流配置快照（执行时固化 agents/mcp/skills 引用配置，导出用）
try { db.exec(`ALTER TABLE workflow_executions ADD COLUMN config_snapshot TEXT`); } catch {}
// 完整事件流时间线（导出用）
try { db.exec(`ALTER TABLE workflow_executions ADD COLUMN events_snapshot TEXT`); } catch {}

export default db;
