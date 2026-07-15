import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SCENE_REGISTRY } from '../shared/scenes';
import {
  createAgentCatalog,
  GENERAL_PURPOSE_AGENT_ID,
  MASTER_AGENT_ID,
} from './agent-catalog';

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE llm_providers (id TEXT PRIMARY KEY)');
  return db;
}

describe('Agent Catalog', () => {
  it('initializes one stable protected Master and General-purpose identity', () => {
    const catalog = createAgentCatalog(createDatabase(), {
      now: () => 10,
    });

    expect(catalog.list()).toMatchObject([
      {
        id: MASTER_AGENT_ID,
        role: 'master',
        name: 'Master Agent',
        slug: 'master-agent',
      },
      {
        id: GENERAL_PURPOSE_AGENT_ID,
        role: 'general-purpose',
        name: 'General-purpose',
        slug: 'general-purpose',
      },
    ]);
  });

  it('is idempotent without overwriting Catalog-owned configuration', () => {
    const db = createDatabase();
    const first = createAgentCatalog(db, {
      createId: () => 'custom-1',
      now: () => 10,
    });
    first.saveMasterPrompt('general', 'User-authored general prompt');
    first.updateGeneralPurpose({ config: { model: 'local' } });
    first.createCustom({ name: 'Focused Reviewer' });

    const second = createAgentCatalog(db, { now: () => 20 });

    expect(second.getMasterPrompt('general')).toBe('User-authored general prompt');
    expect(second.get(GENERAL_PURPOSE_AGENT_ID)).toMatchObject({
      config: { model: 'local' },
      system_prompt: 'You are the project General-purpose Agent. Complete the delegated task within the provided scope and return a concise, verifiable result.',
    });
    expect(second.list().map((agent) => agent.role)).toEqual([
      'master',
      'general-purpose',
      'custom',
    ]);
  });

  it('persists complete Master prompts independently for every registered Scene', () => {
    const catalog = createAgentCatalog(createDatabase(), { now: () => 10 });
    const research = SCENE_REGISTRY.find((scene) => scene.id === 'research');
    if (!research) throw new Error('Research Scene must be registered');

    expect(catalog.resolveMaster(research.id)).toMatchObject({
      agent: { id: MASTER_AGENT_ID, role: 'master' },
      system_prompt: research.defaultMasterPrompt,
    });

    catalog.saveMasterPrompts([
      { scene: 'research', systemPrompt: 'User-authored research prompt' },
      { scene: 'general', systemPrompt: 'User-authored general prompt' },
    ]);
    expect(catalog.getMasterPrompt('research')).toBe('User-authored research prompt');
    expect(catalog.getMasterPrompt('general')).toBe('User-authored general prompt');
    expect(catalog.getSceneDefaultPrompt('general')).toBe(
      SCENE_REGISTRY.find((scene) => scene.id === 'general')?.defaultMasterPrompt,
    );
    expect(catalog.resetMasterPrompt('research')).toBe(research.defaultMasterPrompt);
    expect(() => catalog.getMasterPrompt('unknown')).toThrow('Unknown Scene: unknown');
  });

  it('updates and deletes only Custom Agents', () => {
    const catalog = createAgentCatalog(createDatabase(), {
      createId: () => 'custom-1',
      now: () => 30,
    });
    const created = catalog.createCustom({ name: 'Focused Reviewer' });

    expect(catalog.updateCustom(created.id, {
      name: 'Focused Research Reviewer',
      system_prompt: 'Review research evidence.',
    })).toMatchObject({
      role: 'custom',
      name: 'Focused Research Reviewer',
      slug: 'focused-research-reviewer',
      system_prompt: 'Review research evidence.',
    });
    expect(catalog.deleteCustom(created.id)).toBeUndefined();
    expect(catalog.get(created.id)).toBeNull();
  });

  it('rejects Custom identities that collide after name or key normalization', () => {
    const ids = ['custom-1', 'custom-2', 'custom-3'];
    const catalog = createAgentCatalog(createDatabase(), {
      createId: () => ids.shift() ?? 'unexpected-id',
    });
    catalog.createCustom({ name: 'Evidence Reviewer' });

    expect(() => catalog.createCustom({ name: ' evidence reviewer ' })).toThrow(
      'Agent name conflicts with an existing Agent',
    );
    expect(() => catalog.createCustom({ name: 'Evidence-Reviewer!' })).toThrow(
      'Agent name conflicts with an existing Agent',
    );
    expect(() => catalog.createCustom({ name: 'General Purpose' })).toThrow(
      'Agent name conflicts with an existing Agent',
    );
    catalog.createCustom({ name: `${'a'.repeat(50)} first` });
    expect(() => catalog.createCustom({ name: `${'a'.repeat(50)} second` })).toThrow(
      'Agent delegation key conflicts with an existing Agent',
    );
    expect(catalog.listDelegationTargets().map((agent) => agent.slug)).toEqual([
      'general-purpose',
      'evidence-reviewer',
      'a'.repeat(50),
    ]);
  });

  it('protects system identities while permitting General-purpose configuration changes', () => {
    const db = createDatabase();
    db.prepare('INSERT INTO llm_providers (id) VALUES (?)').run('provider-2');
    const catalog = createAgentCatalog(db, { now: () => 40 });

    expect(() => catalog.updateCustom(MASTER_AGENT_ID, { name: 'Replacement' })).toThrow(
      'Only Custom Agents can be updated',
    );
    expect(() => catalog.deleteCustom(GENERAL_PURPOSE_AGENT_ID)).toThrow(
      'Only Custom Agents can be deleted',
    );
    expect(catalog.updateGeneralPurpose({
      provider_id: 'provider-2',
      config: { model: 'local' },
    })).toMatchObject({
      id: GENERAL_PURPOSE_AGENT_ID,
      role: 'general-purpose',
      name: 'General-purpose',
      slug: 'general-purpose',
      provider_id: 'provider-2',
      config: { model: 'local' },
    });
  });

  it('rolls back a batch prompt save when any Scene is invalid', () => {
    const catalog = createAgentCatalog(createDatabase(), { now: () => 10 });

    expect(() => catalog.saveMasterPrompts([
      { scene: 'general', systemPrompt: 'would be changed' },
      { scene: 'unknown', systemPrompt: 'invalid' },
    ])).toThrow('Unknown Scene: unknown');
    expect(catalog.getMasterPrompt('general')).toBe(catalog.getSceneDefaultPrompt('general'));
  });

  it('survives an unrelated Project lifecycle through the public Catalog interface', () => {
    const db = createDatabase();
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    const catalog = createAgentCatalog(db, { createId: () => 'custom-1', now: () => 10 });
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?), (?, ?)').run('project-1', 'One', 'project-2', 'Two');
    const custom = catalog.createCustom({ name: 'Evidence Reviewer' });

    db.prepare('DELETE FROM projects WHERE id = ?').run('project-1');

    expect(catalog.resolveMaster('general').agent.id).toBe(MASTER_AGENT_ID);
    expect(catalog.listDelegationTargets().map((agent) => agent.id)).toEqual([
      GENERAL_PURPOSE_AGENT_ID,
      custom.id,
    ]);
    expect(catalog.get(custom.id)).toMatchObject({ role: 'custom', name: 'Evidence Reviewer' });
  });

  it('keeps Provider deletion semantics without leaving a dangling Agent reference', () => {
    const db = createDatabase();
    db.pragma('foreign_keys = ON');
    db.prepare('INSERT INTO llm_providers (id) VALUES (?)').run('provider-1');
    const catalog = createAgentCatalog(db, { createId: () => 'custom-1' });
    const custom = catalog.createCustom({ name: 'Evidence Reviewer', provider_id: 'provider-1' });

    db.prepare('DELETE FROM llm_providers WHERE id = ?').run('provider-1');

    expect(catalog.get(custom.id)?.provider_id).toBeNull();
  });

  it('persists the one-system-role, immutable-role, and fixed-system-id invariants', () => {
    const db = createDatabase();
    const catalog = createAgentCatalog(db, { createId: () => 'custom-1' });
    const custom = catalog.createCustom({ name: 'Evidence Reviewer' });

    expect(() => db.prepare('UPDATE agents SET id = ? WHERE id = ?').run('replacement-master', MASTER_AGENT_ID))
      .toThrow('System Agent identity is protected');
    expect(() => db.prepare("UPDATE agents SET role = 'master' WHERE id = ?").run(custom.id))
      .toThrow('Agent role is immutable');
    expect(() => db.prepare(`
      INSERT INTO agents (
        id, role, name, normalized_name, slug, normalized_slug,
        created_at, updated_at
      ) VALUES (?, 'master', ?, ?, ?, ?, 1, 1)
    `).run('second-master', 'Second Master', 'secondmaster', 'second-master', 'second-master'))
      .toThrow(/UNIQUE constraint failed/);
  });

  it('creates a globally unique Custom Agent and exposes it as a delegation target', () => {
    const db = createDatabase();
    db.prepare('INSERT INTO llm_providers (id) VALUES (?)').run('provider-1');
    const catalog = createAgentCatalog(db, {
      createId: () => 'custom-reviewer',
      now: () => 20,
    });

    const custom = catalog.createCustom({
      name: 'Evidence Reviewer',
      description: 'Checks claims against local evidence.',
      provider_id: 'provider-1',
      system_prompt: 'Review the supplied evidence.',
      config: { temperature: 0.2 },
    });

    expect(custom).toMatchObject({
      id: 'custom-reviewer',
      role: 'custom',
      name: 'Evidence Reviewer',
      slug: 'evidence-reviewer',
      config: { temperature: 0.2 },
      created_at: 20,
      updated_at: 20,
    });
    expect(custom).not.toHaveProperty('project_id');
    expect(custom).not.toHaveProperty('is_default');
    expect(catalog.listDelegationTargets().map((agent) => agent.slug)).toEqual([
      'general-purpose',
      'evidence-reviewer',
    ]);
  });
});
