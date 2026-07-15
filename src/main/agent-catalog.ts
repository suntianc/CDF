import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateAgentSlug, type AgentRole } from '../shared/agents';
import { SCENE_REGISTRY, type SceneId } from '../shared/scenes';

export type AgentCatalogRole = AgentRole;

export interface CatalogAgent {
  id: string;
  role: AgentCatalogRole;
  name: string;
  slug: string;
  description: string | null;
  provider_id: string | null;
  system_prompt: string | null;
  config: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface ResolvedMasterAgent {
  agent: CatalogAgent;
  system_prompt: string;
}

export interface MasterScenePromptChange {
  scene: SceneId | string;
  systemPrompt: string;
}

export interface CreateCustomAgentInput {
  name: string;
  description?: string | null;
  provider_id?: string | null;
  system_prompt?: string | null;
  config?: Record<string, unknown> | null;
}

export interface UpdateGeneralPurposeAgentInput {
  description?: string | null;
  provider_id?: string | null;
  system_prompt?: string | null;
  config?: Record<string, unknown> | null;
}

export interface UpdateCustomAgentInput extends UpdateGeneralPurposeAgentInput {
  name?: string;
}

export interface AgentCatalog {
  list(): CatalogAgent[];
  get(id: string): CatalogAgent | null;
  resolveMaster(scene: SceneId | string): ResolvedMasterAgent;
  listDelegationTargets(): CatalogAgent[];
  createCustom(input: CreateCustomAgentInput): CatalogAgent;
  updateGeneralPurpose(input: UpdateGeneralPurposeAgentInput): CatalogAgent;
  updateCustom(id: string, input: UpdateCustomAgentInput): CatalogAgent;
  deleteCustom(id: string): void;
  getMasterPrompt(scene: SceneId | string): string;
  getSceneDefaultPrompt(scene: SceneId | string): string;
  saveMasterPrompts(changes: readonly MasterScenePromptChange[]): string[];
  saveMasterPrompt(scene: SceneId | string, systemPrompt: string): string;
  resetMasterPrompt(scene: SceneId | string): string;
}

export interface CreateAgentCatalogOptions {
  createId?: () => string;
  now?: () => number;
  /** The application database initializes the schema once; runtime callers only open it. */
  initializeSchema?: boolean;
}

export const MASTER_AGENT_ID = 'system-master-agent';
export const GENERAL_PURPOSE_AGENT_ID = 'system-general-purpose-agent';
export const MASTER_AGENT_NAME = 'Master Agent';
export const MASTER_AGENT_SLUG = 'master-agent';
export const GENERAL_PURPOSE_AGENT_NAME = 'General-purpose';
export const GENERAL_PURPOSE_AGENT_SLUG = 'general-purpose';

const DEFAULT_GENERAL_PURPOSE_PROMPT = 'You are the project General-purpose Agent. Complete the delegated task within the provided scope and return a concise, verifiable result.';

interface AgentRow {
  id: string;
  role: AgentCatalogRole;
  name: string;
  slug: string;
  description: string | null;
  provider_id: string | null;
  system_prompt: string | null;
  config: string | null;
  created_at: number;
  updated_at: number;
}

function parseConfig(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid persisted Agent config');
  }
  return parsed as Record<string, unknown>;
}

function serializeAgent(row: AgentRow): CatalogAgent {
  return { ...row, config: parseConfig(row.config) };
}

function serializeConfig(config: Record<string, unknown> | null | undefined): string | null {
  return config === null || config === undefined ? null : JSON.stringify(config);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getSceneDefinition(sceneId: SceneId | string) {
  const scene = SCENE_REGISTRY.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error(`Unknown Scene: ${sceneId}`);
  return scene;
}

function getAgent(db: Database.Database, id: string): CatalogAgent | null {
  const row = db.prepare(`SELECT id, role, name, slug, description, provider_id, system_prompt, config, created_at, updated_at FROM agents WHERE id = ?`).get(id) as AgentRow | undefined;
  return row ? serializeAgent(row) : null;
}

function listAgents(db: Database.Database): CatalogAgent[] {
  return (db.prepare(`
    SELECT id, role, name, slug, description, provider_id, system_prompt, config, created_at, updated_at
    FROM agents
    ORDER BY CASE role WHEN 'master' THEN 0 WHEN 'general-purpose' THEN 1 ELSE 2 END, name
  `).all() as AgentRow[]).map(serializeAgent);
}

function getMasterPrompt(db: Database.Database, sceneId: SceneId | string): string {
  getSceneDefinition(sceneId);
  const row = db.prepare('SELECT system_prompt FROM master_agent_prompts WHERE scene = ?').get(sceneId) as { system_prompt: string } | undefined;
  if (!row) throw new Error(`Master prompt is missing for Scene: ${sceneId}`);
  return row.system_prompt;
}

function getRequiredCustomAgent(db: Database.Database, id: string, action: 'updated' | 'deleted'): CatalogAgent {
  const agent = getAgent(db, id);
  if (!agent) throw new Error(`Custom Agent not found: ${id}`);
  if (agent.role !== 'custom') throw new Error(`Only Custom Agents can be ${action}`);
  return agent;
}

function assertCustomIdentityAvailable(db: Database.Database, normalizedName: string, normalizedSlug: string, excludedId?: string): void {
  const conflict = db.prepare(`
    SELECT id, normalized_name, normalized_slug FROM agents
    WHERE (normalized_name = ? OR normalized_slug = ?) AND (? IS NULL OR id <> ?) LIMIT 1
  `).get(normalizedName, normalizedSlug, excludedId ?? null, excludedId ?? null) as
    | { id: string; normalized_name: string; normalized_slug: string }
    | undefined;
  if (!conflict) return;
  if (conflict.normalized_name === normalizedName) throw new Error('Agent name conflicts with an existing Agent');
  throw new Error('Agent delegation key conflicts with an existing Agent');
}

function toCustomIdentity(name: string): { name: string; normalizedName: string; slug: string } {
  const trimmedName = name.trim();
  const normalizedName = normalizeName(trimmedName);
  const slug = generateAgentSlug(trimmedName);
  if (!trimmedName || !normalizedName || !slug) throw new Error('Custom Agent name must produce a non-empty delegation key');
  return { name: trimmedName, normalizedName, slug };
}

function assertCompatibleAgentsSchema(db: Database.Database): void {
  const columns = db.prepare("SELECT name FROM pragma_table_info('agents')").all() as Array<{ name: string }>;
  if (columns.length === 0) return;
  const names = new Set(columns.map((column) => column.name));
  const required = ['id', 'role', 'name', 'normalized_name', 'slug', 'normalized_slug', 'description', 'provider_id', 'system_prompt', 'config', 'created_at', 'updated_at'];
  if (names.has('project_id') || names.has('is_default') || required.some((name) => !names.has(name))) {
    throw new Error('Incompatible agents schema detected. Reset the development database; Agent Catalog does not migrate the legacy project-owned agents schema.');
  }
}

function initializeSchema(db: Database.Database, now: number): void {
  assertCompatibleAgentsSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('master', 'general-purpose', 'custom')),
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL,
      normalized_slug TEXT NOT NULL UNIQUE,
      description TEXT,
      provider_id TEXT,
      system_prompt TEXT,
      config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (role <> 'master' OR system_prompt IS NULL),
      FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS master_agent_prompts (
      scene TEXT PRIMARY KEY,
      system_prompt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agents_single_system_role ON agents(role) WHERE role IN ('master', 'general-purpose');
    CREATE TRIGGER IF NOT EXISTS agents_role_is_immutable BEFORE UPDATE OF role ON agents
      WHEN OLD.role <> NEW.role BEGIN SELECT RAISE(ABORT, 'Agent role is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS agents_system_identity_is_protected BEFORE UPDATE OF id, name, normalized_name, slug, normalized_slug ON agents
      WHEN OLD.role IN ('master', 'general-purpose') BEGIN SELECT RAISE(ABORT, 'System Agent identity is protected'); END;
    CREATE TRIGGER IF NOT EXISTS agents_system_agent_cannot_be_deleted BEFORE DELETE ON agents
      WHEN OLD.role IN ('master', 'general-purpose') BEGIN SELECT RAISE(ABORT, 'System Agent is protected'); END;
  `);

  const insertSystemAgent = db.prepare(`
    INSERT OR IGNORE INTO agents (id, role, name, normalized_name, slug, normalized_slug, description, provider_id, system_prompt, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
  `);
  insertSystemAgent.run(MASTER_AGENT_ID, 'master', MASTER_AGENT_NAME, normalizeName(MASTER_AGENT_NAME), MASTER_AGENT_SLUG, MASTER_AGENT_SLUG, 'Global Master Agent', null, now, now);
  insertSystemAgent.run(GENERAL_PURPOSE_AGENT_ID, 'general-purpose', GENERAL_PURPOSE_AGENT_NAME, normalizeName(GENERAL_PURPOSE_AGENT_NAME), GENERAL_PURPOSE_AGENT_SLUG, GENERAL_PURPOSE_AGENT_SLUG, 'Default General-purpose Agent', DEFAULT_GENERAL_PURPOSE_PROMPT, now, now);

  const insertPrompt = db.prepare('INSERT OR IGNORE INTO master_agent_prompts (scene, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?)');
  for (const scene of SCENE_REGISTRY) insertPrompt.run(scene.id, scene.defaultMasterPrompt, now, now);

  const identities = db.prepare("SELECT id, role, name, slug FROM agents WHERE role IN ('master', 'general-purpose') ORDER BY role").all();
  const expected = [
    { id: GENERAL_PURPOSE_AGENT_ID, role: 'general-purpose', name: GENERAL_PURPOSE_AGENT_NAME, slug: GENERAL_PURPOSE_AGENT_SLUG },
    { id: MASTER_AGENT_ID, role: 'master', name: MASTER_AGENT_NAME, slug: MASTER_AGENT_SLUG },
  ];
  if (JSON.stringify(identities) !== JSON.stringify(expected)) throw new Error('Agent Catalog system identities are invalid');
}

export function createAgentCatalog(db: Database.Database, options: CreateAgentCatalogOptions = {}): AgentCatalog {
  const createId = options.createId ?? crypto.randomUUID;
  const now = options.now ?? Date.now;
  if (options.initializeSchema !== false) initializeSchema(db, now());

  return {
    list: () => listAgents(db),
    get: (id) => getAgent(db, id),
    resolveMaster(scene) {
      const agent = getAgent(db, MASTER_AGENT_ID);
      if (!agent) throw new Error('Master Agent is missing');
      return { agent, system_prompt: getMasterPrompt(db, scene) };
    },
    listDelegationTargets: () => listAgents(db).filter((agent) => agent.role !== 'master'),
    createCustom(input) {
      const identity = toCustomIdentity(input.name);
      assertCustomIdentityAvailable(db, identity.normalizedName, identity.slug);
      const id = createId();
      const timestamp = now();
      try {
        db.prepare(`INSERT INTO agents (id, role, name, normalized_name, slug, normalized_slug, description, provider_id, system_prompt, config, created_at, updated_at) VALUES (?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, identity.name, identity.normalizedName, identity.slug, identity.slug, input.description ?? null, input.provider_id ?? null, input.system_prompt ?? null, serializeConfig(input.config), timestamp, timestamp,
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('Custom Agent name and delegation key must be globally unique');
        throw error;
      }
      const created = getAgent(db, id);
      if (!created) throw new Error('Created Custom Agent could not be read');
      return created;
    },
    updateGeneralPurpose(input) {
      const current = getAgent(db, GENERAL_PURPOSE_AGENT_ID);
      if (!current || current.role !== 'general-purpose') throw new Error('General-purpose Agent is missing');
      db.prepare('UPDATE agents SET description = ?, provider_id = ?, system_prompt = ?, config = ?, updated_at = ? WHERE id = ?').run(
        input.description === undefined ? current.description : input.description,
        input.provider_id === undefined ? current.provider_id : input.provider_id,
        input.system_prompt === undefined ? current.system_prompt : input.system_prompt,
        input.config === undefined ? serializeConfig(current.config) : serializeConfig(input.config), now(), GENERAL_PURPOSE_AGENT_ID,
      );
      return getAgent(db, GENERAL_PURPOSE_AGENT_ID)!;
    },
    updateCustom(id, input) {
      const current = getRequiredCustomAgent(db, id, 'updated');
      const identity = input.name === undefined ? { name: current.name, normalizedName: normalizeName(current.name), slug: current.slug } : toCustomIdentity(input.name);
      assertCustomIdentityAvailable(db, identity.normalizedName, identity.slug, id);
      db.prepare(`UPDATE agents SET name = ?, normalized_name = ?, slug = ?, normalized_slug = ?, description = ?, provider_id = ?, system_prompt = ?, config = ?, updated_at = ? WHERE id = ?`).run(
        identity.name, identity.normalizedName, identity.slug, identity.slug,
        input.description === undefined ? current.description : input.description,
        input.provider_id === undefined ? current.provider_id : input.provider_id,
        input.system_prompt === undefined ? current.system_prompt : input.system_prompt,
        input.config === undefined ? serializeConfig(current.config) : serializeConfig(input.config), now(), id,
      );
      return getAgent(db, id)!;
    },
    deleteCustom(id) {
      getRequiredCustomAgent(db, id, 'deleted');
      db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    },
    getMasterPrompt: (scene) => getMasterPrompt(db, scene),
    getSceneDefaultPrompt: (scene) => getSceneDefinition(scene).defaultMasterPrompt,
    saveMasterPrompts(changes) {
      for (const change of changes) {
        getSceneDefinition(change.scene);
        if (typeof change.systemPrompt !== 'string') throw new Error('Master prompt must be a string');
      }
      return db.transaction(() => {
        const save = db.prepare('UPDATE master_agent_prompts SET system_prompt = ?, updated_at = ? WHERE scene = ?');
        return changes.map((change) => {
          if (save.run(change.systemPrompt, now(), change.scene).changes !== 1) throw new Error(`Master prompt is missing for Scene: ${change.scene}`);
          return change.systemPrompt;
        });
      })();
    },
    saveMasterPrompt(scene, systemPrompt) { return this.saveMasterPrompts([{ scene, systemPrompt }])[0]; },
    resetMasterPrompt(scene) { return this.saveMasterPrompts([{ scene, systemPrompt: getSceneDefinition(scene).defaultMasterPrompt }])[0]; },
  };
}
