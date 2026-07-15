import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GENERAL_PURPOSE_AGENT_SLUG,
  MASTER_AGENT_SLUG,
  GENERAL_SCENE_DEFAULT_PROMPT,
  RESEARCH_SCENE_DEFAULT_PROMPT,
  assertProjectAgentCanBeDeleted,
  assertProjectAgentCanBeSaved,
  ensureGeneralPurposeAgent,
  ensureMasterAgent,
  ensureProjectMasterAgents,
  resetMasterAgentPrompt,
} from './project-agent-service';

describe('Project Agent service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, scene TEXT NOT NULL DEFAULT 'general');
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
      INSERT INTO projects (id, scene) VALUES ('project-1', 'general');
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

  it('eagerly repairs duplicate Masters for every Project and enforces the unique Master index', () => {
    db.prepare("INSERT INTO projects (id, scene) VALUES ('project-2', 'research')").run();
    db.prepare(`INSERT INTO agents (id, project_id, name, slug, is_default, created_at, updated_at)
      VALUES ('master-1', 'project-1', 'Master Agent', 'master-agent', 1, 1, 1),
             ('duplicate-master', 'project-1', 'Master Agent', 'master-agent', 1, 2, 2),
             ('custom-default', 'project-2', 'Custom', 'custom', 1, 1, 1)`).run();

    ensureProjectMasterAgents(db, { createId: () => 'master-2', now: () => 10 });

    expect(db.prepare("SELECT id, is_default FROM agents WHERE project_id = ? AND slug = 'master-agent'").all('project-1'))
      .toEqual([{ id: 'master-1', is_default: 1 }]);
    expect(db.prepare("SELECT id, is_default FROM agents WHERE project_id = ? AND slug = 'master-agent'").all('project-2'))
      .toEqual([{ id: 'master-2', is_default: 1 }]);
    expect(db.prepare('SELECT is_default FROM agents WHERE id = ?').get('duplicate-master')).toEqual({ is_default: 0 });
    expect(db.prepare('SELECT is_default FROM agents WHERE id = ?').get('custom-default')).toEqual({ is_default: 0 });
    expect(() => db.prepare(`INSERT INTO agents (id, project_id, name, slug, is_default, created_at, updated_at)
      VALUES ('another-master', 'project-1', 'Master Agent', 'master-agent', 1, 3, 3)`).run()).toThrow();
  });

  it('initializes each Master with its Scene Default Prompt and resets without overwriting custom content', () => {
    db.prepare("INSERT INTO projects (id, scene) VALUES ('research-project', 'research')").run();
    ensureMasterAgent(db, 'project-1', { createId: () => 'general-master', now: () => 10 });
    ensureMasterAgent(db, 'research-project', { createId: () => 'research-master', now: () => 10 });

    expect(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get('general-master')).toEqual({
      system_prompt: GENERAL_SCENE_DEFAULT_PROMPT,
    });
    expect(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get('research-master')).toEqual({
      system_prompt: RESEARCH_SCENE_DEFAULT_PROMPT,
    });

    db.prepare('UPDATE agents SET system_prompt = ? WHERE id = ?').run('User-authored complete prompt', 'research-master');
    ensureMasterAgent(db, 'research-project');
    expect(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get('research-master')).toEqual({
      system_prompt: 'User-authored complete prompt',
    });

    resetMasterAgentPrompt(db, 'research-project', { now: () => 20 });
    expect(db.prepare('SELECT system_prompt FROM agents WHERE id = ?').get('research-master')).toEqual({
      system_prompt: RESEARCH_SCENE_DEFAULT_PROMPT,
    });
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
