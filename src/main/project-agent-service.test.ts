import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GENERAL_PURPOSE_AGENT_SLUG,
  MASTER_AGENT_SLUG,
  assertProjectAgentCanBeDeleted,
  assertProjectAgentCanBeSaved,
  ensureGeneralPurposeAgent,
  ensureMasterAgent,
} from './project-agent-service';

describe('Project Agent service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY);
      CREATE TABLE agents (
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
        updated_at INTEGER NOT NULL
      );
      INSERT INTO projects (id) VALUES ('project-1');
    `);
  });

  it('exposes exactly one protected General-purpose Agent after repeated initialization', () => {
    ensureGeneralPurposeAgent(db, 'project-1', { createId: () => 'general-1', now: () => 10 });
    ensureGeneralPurposeAgent(db, 'project-1', { createId: () => 'general-2', now: () => 20 });

    const rows = db.prepare(
      'SELECT id, slug, provider_id, is_default FROM agents WHERE project_id = ?',
    ).all('project-1') as Array<Record<string, unknown>>;

    expect(rows).toEqual([{
      id: 'general-1',
      slug: GENERAL_PURPOSE_AGENT_SLUG,
      provider_id: null,
      is_default: 0,
    }]);
  });

  it('rejects deleting, renaming, or shadowing the reserved Agent identity', () => {
    ensureGeneralPurposeAgent(db, 'project-1', { createId: () => 'general-1', now: () => 10 });

    expect(() => assertProjectAgentCanBeDeleted(db, 'general-1')).toThrow(
      'General-purpose Agent is protected and cannot be deleted',
    );
    expect(() => assertProjectAgentCanBeSaved(db, {
      id: 'general-1',
      projectId: 'project-1',
      name: 'Renamed Agent',
    })).toThrow('General-purpose Agent is protected and cannot be renamed');
    expect(() => assertProjectAgentCanBeSaved(db, {
      id: 'user-1',
      projectId: 'project-1',
      name: 'General Purpose',
    })).toThrow('reserved for the protected General-purpose Agent');
  });

  it('creates exactly one protected Master Agent with a reserved stable identity', () => {
    ensureMasterAgent(db, 'project-1', { createId: () => 'master-1', now: () => 10 });
    ensureMasterAgent(db, 'project-1', { createId: () => 'master-2', now: () => 20 });

    expect(db.prepare(
      'SELECT id, slug, is_default FROM agents WHERE project_id = ?',
    ).all('project-1')).toEqual([{
      id: 'master-1',
      slug: MASTER_AGENT_SLUG,
      is_default: 1,
    }]);
  });

  it('rejects deleting, moving, renaming, or shadowing the Master Agent identity', () => {
    ensureMasterAgent(db, 'project-1', { createId: () => 'master-1', now: () => 10 });

    expect(() => assertProjectAgentCanBeDeleted(db, 'master-1')).toThrow(
      'Master Agent is protected and cannot be deleted',
    );
    expect(() => assertProjectAgentCanBeSaved(db, {
      id: 'master-1', projectId: 'project-2', name: 'Master Agent',
    })).toThrow('Master Agent is protected and cannot be renamed or moved');
    expect(() => assertProjectAgentCanBeSaved(db, {
      id: 'master-1', projectId: 'project-1', name: 'Renamed Agent',
    })).toThrow('Master Agent is protected and cannot be renamed or moved');
    expect(() => assertProjectAgentCanBeSaved(db, {
      id: 'user-1', projectId: 'project-1', name: 'Master Agent',
    })).toThrow('reserved for the protected Master Agent');
  });

  it('allows editing non-identity configuration on the protected Agent', () => {
    ensureGeneralPurposeAgent(db, 'project-1', { createId: () => 'general-1', now: () => 10 });

    expect(() => assertProjectAgentCanBeSaved(db, {
      id: 'general-1',
      projectId: 'project-1',
      name: 'General-purpose',
    })).not.toThrow();
  });
});
