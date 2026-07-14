import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateAgentSlug } from '../shared/agents';

export const MASTER_AGENT_SLUG = 'master-agent';
export const MASTER_AGENT_NAME = 'Master Agent';
export const GENERAL_PURPOSE_AGENT_SLUG = 'general-purpose';
export const GENERAL_PURPOSE_AGENT_NAME = 'General-purpose';

interface ProjectAgentOptions {
  createId?: () => string;
  now?: () => number;
}

interface ProjectAgentIdentityInput {
  id: string;
  projectId: string;
  name: string;
}

interface ProjectAgentIdentityRow {
  id: string;
  project_id: string;
  name: string;
  slug: string | null;
}

export type ProjectAgentRole = 'master' | 'general-purpose' | 'custom';

export function isMasterAgent(agent: { slug?: string | null }): boolean {
  return agent.slug === MASTER_AGENT_SLUG;
}

export function isGeneralPurposeAgent(agent: { slug?: string | null }): boolean {
  return agent.slug === GENERAL_PURPOSE_AGENT_SLUG;
}

export function getProjectAgentRole(agent: { slug?: string | null }): ProjectAgentRole {
  if (isMasterAgent(agent)) return 'master';
  if (isGeneralPurposeAgent(agent)) return 'general-purpose';
  return 'custom';
}

export function ensureMasterAgent(
  db: Database.Database,
  projectId: string,
  options: ProjectAgentOptions = {},
): ProjectAgentIdentityRow {
  const existing = db.prepare(
    'SELECT id, project_id, name, slug FROM agents WHERE project_id = ? AND slug = ? LIMIT 1',
  ).get(projectId, MASTER_AGENT_SLUG) as ProjectAgentIdentityRow | undefined;
  if (existing) return existing;

  const id = (options.createId ?? crypto.randomUUID)();
  const now = (options.now ?? Date.now)();
  db.prepare(`
    INSERT INTO agents (
      id, project_id, name, slug, description, provider_id,
      system_prompt, config, is_default, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 1, ?, ?)
  `).run(
    id,
    projectId,
    MASTER_AGENT_NAME,
    MASTER_AGENT_SLUG,
    'Project Master Agent',
    'You are the project Master Agent. Coordinate project work, use available Skills and MCP tools, and delegate specialized tasks to subagents when appropriate.',
    now,
    now,
  );

  return { id, project_id: projectId, name: MASTER_AGENT_NAME, slug: MASTER_AGENT_SLUG };
}

export function ensureGeneralPurposeAgent(
  db: Database.Database,
  projectId: string,
  options: ProjectAgentOptions = {},
): ProjectAgentIdentityRow {
  const existing = db.prepare(
    'SELECT id, project_id, name, slug FROM agents WHERE project_id = ? AND slug = ? LIMIT 1',
  ).get(projectId, GENERAL_PURPOSE_AGENT_SLUG) as ProjectAgentIdentityRow | undefined;
  if (existing) return existing;

  const id = (options.createId ?? crypto.randomUUID)();
  const now = (options.now ?? Date.now)();
  db.prepare(`
    INSERT INTO agents (
      id, project_id, name, slug, description, provider_id,
      system_prompt, config, is_default, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?, ?)
  `).run(
    id,
    projectId,
    GENERAL_PURPOSE_AGENT_NAME,
    GENERAL_PURPOSE_AGENT_SLUG,
    'Always-available general-purpose delegation target',
    'You are the project General-purpose Agent. Complete the delegated task within the provided scope and return a concise, verifiable result.',
    now,
    now,
  );

  return {
    id,
    project_id: projectId,
    name: GENERAL_PURPOSE_AGENT_NAME,
    slug: GENERAL_PURPOSE_AGENT_SLUG,
  };
}

export function assertProjectAgentCanBeSaved(
  db: Database.Database,
  input: ProjectAgentIdentityInput,
): void {
  const existing = db.prepare(
    'SELECT id, project_id, name, slug FROM agents WHERE id = ?',
  ).get(input.id) as ProjectAgentIdentityRow | undefined;

  if (existing && isMasterAgent(existing)) {
    if (existing.project_id !== input.projectId || existing.name !== input.name) {
      throw new Error('Master Agent is protected and cannot be renamed or moved to another Project.');
    }
    return;
  }

  if (existing && isGeneralPurposeAgent(existing)) {
    if (existing.project_id !== input.projectId || existing.name !== input.name) {
      throw new Error('General-purpose Agent is protected and cannot be renamed or moved to another Project.');
    }
    return;
  }

  const slug = generateAgentSlug(input.name);
  if (slug === MASTER_AGENT_SLUG) {
    throw new Error('The slug "master-agent" is reserved for the protected Master Agent.');
  }
  if (slug === GENERAL_PURPOSE_AGENT_SLUG) {
    throw new Error('The slug "general-purpose" is reserved for the protected General-purpose Agent.');
  }
}

export function assertProjectAgentCanBeDeleted(
  db: Database.Database,
  agentId: string,
): void {
  const existing = db.prepare('SELECT slug FROM agents WHERE id = ?').get(agentId) as
    | { slug: string | null }
    | undefined;
  if (existing && isMasterAgent(existing)) {
    throw new Error('Master Agent is protected and cannot be deleted.');
  }
  if (existing && isGeneralPurposeAgent(existing)) {
    throw new Error('General-purpose Agent is protected and cannot be deleted.');
  }
}
