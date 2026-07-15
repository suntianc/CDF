import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { generateSlug } from './deepagent/agent-slug';
import {
  DelegatedAgentRunRepository,
  initializeDelegatedAgentRunSchema,
} from './deepagent/delegated-agent-run-repository';
import {
  GENERAL_PURPOSE_AGENT_SLUG,
  ensureGeneralPurposeAgent,
  ensureProjectMasterAgents,
} from './project-agent-service';

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
    scene TEXT NOT NULL DEFAULT 'general',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    agent_id TEXT,
    summary TEXT,
    prompt_snapshot TEXT,
    skill_snapshot TEXT,
    workflow_run_id TEXT,
    workflow_run_status TEXT,
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

// Safe migration for projects scene
safeMigrate('projects table (scene)', `ALTER TABLE projects ADD COLUMN scene TEXT NOT NULL DEFAULT 'general';`);
try {
  db.prepare(`UPDATE projects SET scene = 'general' WHERE scene IS NULL OR scene = ''`).run();
} catch (error) {
  console.error('Failed to backfill projects.scene:', error);
}

// Safe migration for sessions parent_session_id & summary
safeMigrate('sessions table (parent_session_id)', `ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;`);
safeMigrate('sessions table (agent_id)', `ALTER TABLE sessions ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL;`);
safeMigrate('sessions table (prompt_snapshot)', `ALTER TABLE sessions ADD COLUMN prompt_snapshot TEXT;`);
safeMigrate('sessions table (skill_snapshot)', `ALTER TABLE sessions ADD COLUMN skill_snapshot TEXT;`);

// Safe migration for llm_providers models
safeMigrate('llm_providers table (models)', `ALTER TABLE llm_providers ADD COLUMN models TEXT;`);

// Safe migration for sessions summary
safeMigrate('sessions table (summary)', `ALTER TABLE sessions ADD COLUMN summary TEXT;`);

// Safe migration for sessions workflow_run_id & workflow_run_status
safeMigrate('sessions table (workflow_run_id)', `ALTER TABLE sessions ADD COLUMN workflow_run_id TEXT;`);
safeMigrate('sessions table (workflow_run_status)', `ALTER TABLE sessions ADD COLUMN workflow_run_status TEXT;`);

// Think duration: store real LLM thinking wall-clock time so historical messages show accurate timing
safeMigrate('messages table (think_duration_seconds)', `ALTER TABLE messages ADD COLUMN think_duration_seconds INTEGER;`);

// Image data: JSON array of data URL strings for user-pasted images
safeMigrate('messages table (image_data)', `ALTER TABLE messages ADD COLUMN image_data TEXT;`);

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

  DROP TABLE IF EXISTS agent_mcp_servers;

  CREATE TABLE IF NOT EXISTS agent_mcp_exclusions (
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
    delegated_run_id TEXT,
    tool_name TEXT NOT NULL,
    input TEXT,
    output TEXT,
    status TEXT NOT NULL,
    error TEXT,
    approval_status TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (delegated_run_id) REFERENCES delegated_agent_runs(id) ON DELETE SET NULL
  );
`);

// Existing databases predate first-class Delegated Agent Runs.
safeMigrate(
  'agent_tool_calls table (delegated_run_id)',
  `ALTER TABLE agent_tool_calls ADD COLUMN delegated_run_id TEXT REFERENCES delegated_agent_runs(id) ON DELETE SET NULL;`,
);
initializeDelegatedAgentRunSchema(db);
new DelegatedAgentRunRepository(db).reconcileInterrupted(Date.now());

// A process restart cannot retain a live Agent run. Close stale rows before
// enforcing the one-active-run-per-Conversation invariant used by background continuations.
db.prepare(`UPDATE agent_runs
  SET status = 'interrupted',
      error = COALESCE(error, 'Application stopped before the Agent run completed'),
      ended_at = COALESCE(ended_at, ?),
      aborted = 1
  WHERE status IN ('running', 'waiting_approval')`).run(Date.now());
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_one_active_session
  ON agent_runs(session_id) WHERE status IN ('running', 'waiting_approval')`);

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
// (generateSlug itself lives in deepagent/agent-slug.ts — the canonical
// helper. This import is here to avoid duplicating the regex chain.)
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
      INSERT INTO projects (id, name, path, scene, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(defaultProjectId, defaultProjectName, defaultProjectPath, 'general', now, now);
    console.log('Successfully initialized default project:', defaultProjectId);
  }
} catch (error) {
  console.error('Failed to initialize default project:', error);
}

// Every initialized Project eagerly receives one protected Master root. This
// repairs duplicate legacy Masters before creating the partial unique index.
try {
  ensureProjectMasterAgents(db);
  const projects = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>;
  const ensureGeneralPurpose = db.transaction(() => {
    for (const project of projects) ensureGeneralPurposeAgent(db, project.id);
  });
  ensureGeneralPurpose();
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_general_purpose_project
    ON agents(project_id) WHERE slug = '${GENERAL_PURPOSE_AGENT_SLUG}'`);
} catch (error) {
  console.error('Failed to initialize protected Project Agents:', error);
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

// ===== Workflow Skeleton + Workflow Run tables =====
// The product has not shipped legacy workflow data. If the old graph schema is
// present, reset it instead of carrying two execution models indefinitely.
try {
  const legacyGraphColumn = db.prepare(
    "SELECT name FROM pragma_table_info('workflows') WHERE name = 'graph_data'"
  ).get();
  if (legacyGraphColumn) {
    db.exec('DROP TABLE IF EXISTS workflow_run_tasks');
    db.exec('DROP TABLE IF EXISTS workflow_stage_gates');
    db.exec('DROP TABLE IF EXISTS workflow_runs');
    db.exec('DROP TABLE IF EXISTS workflow_node_runs');
    db.exec('DROP TABLE IF EXISTS workflow_executions');
    db.exec('DROP TABLE IF EXISTS workflows');
    console.log('[DB] Destructive reset: dropped legacy workflow tables');
  }
} catch {
  // A fresh database has no workflows table yet.
}

db.exec(`
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    stages TEXT NOT NULL DEFAULT '[]',
    master_agent_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    master_agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    current_stage_id TEXT NOT NULL,
    current_stage_index INTEGER NOT NULL DEFAULT 0,
    total_stages INTEGER NOT NULL,
    stages TEXT NOT NULL,
    skeleton_snapshot TEXT,
    error TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workflow_stage_gates (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    stage_name TEXT NOT NULL,
    report TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    feedback TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workflow_run_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    dependencies TEXT NOT NULL DEFAULT '[]',
    delegation_batch_id TEXT,
    delegation_worker_id TEXT,
    delegated_run_id TEXT,
    delegation_agent_slug TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);
  CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_session ON workflow_runs(session_id);
  CREATE INDEX IF NOT EXISTS idx_stage_gates_run ON workflow_stage_gates(run_id);
  CREATE INDEX IF NOT EXISTS idx_workflow_run_tasks_run ON workflow_run_tasks(run_id);
  CREATE INDEX IF NOT EXISTS idx_workflow_run_tasks_run_stage ON workflow_run_tasks(run_id, stage_id);
`);

safeMigrate(
  'workflow_runs table (current_stage_id)',
  `ALTER TABLE workflow_runs ADD COLUMN current_stage_id TEXT;`,
);
try {
  const legacyRuns = db.prepare(`
    SELECT id, current_stage_index, stages
    FROM workflow_runs
    WHERE current_stage_id IS NULL OR current_stage_id = ''
  `).all() as Array<{ id: string; current_stage_index: number; stages: string }>;
  const updateCurrentStageId = db.prepare('UPDATE workflow_runs SET current_stage_id = ? WHERE id = ?');
  for (const run of legacyRuns) {
    const stages = JSON.parse(run.stages) as Array<{ id?: string }>;
    const stage = stages[Math.min(run.current_stage_index, Math.max(stages.length - 1, 0))];
    if (stage?.id) updateCurrentStageId.run(stage.id, run.id);
  }
} catch (error) {
  console.error('Failed to backfill workflow_runs.current_stage_id:', error);
}

safeMigrate(
  'workflow_run_tasks table (delegated_run_id)',
  `ALTER TABLE workflow_run_tasks ADD COLUMN delegated_run_id TEXT;`,
);

export default db;
