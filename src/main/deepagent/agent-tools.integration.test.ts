import fs from 'fs';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERAL_PURPOSE_AGENT_ID, MASTER_AGENT_ID } from '../agent-catalog';

const TMP_DIR = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require('node:fs') as typeof import('node:fs');
  const directory = `${os.tmpdir()}/cdf-agent-tools-${process.pid}-${Date.now()}`;
  fsSync.mkdirSync(directory, { recursive: true });
  return directory;
});

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR },
  ipcMain: { handle: () => {} },
}));

import db from '../database';
import { createAgentTools } from './agent-tools';

const PROJECT_ID = 'agent-tools-project';
const PROJECT_PATH = path.join(TMP_DIR, 'project');

const TABLES_IN_DELETE_ORDER = [
  'agent_tool_calls',
  'delegated_tool_actions',
  'delegated_agent_runs',
  'agent_runs',
  'workflow_run_tasks',
  'workflow_stage_gates',
  'workflow_runs',
  'workflows',
  'agent_skills',
  'agent_mcp_exclusions',
  'mcp_servers',
  'messages',
  'sessions',
  'llm_providers',
  'tool_configs',
  'projects',
];

function freshDb() {
  db.pragma('foreign_keys = ON');
  for (const table of TABLES_IN_DELETE_ORDER) db.exec(`DELETE FROM ${table}`);
  // The Agent Catalog owns the protected system identities. Tests may reset
  // Custom data but must never remove Master or General-purpose rows.
  db.exec("DELETE FROM agents WHERE role = 'custom'");
  db.prepare(`INSERT INTO projects (id, name, path, scene, created_at, updated_at) VALUES (?, ?, ?, 'general', 0, 0)`)
    .run(PROJECT_ID, 'Agent tools test', PROJECT_PATH);
}

function seedProvider(id: string, isActive: number, updatedAt: number) {
  db.prepare(`
    INSERT INTO llm_providers
      (id, name, provider_type, api_key, api_url, default_model, context_limit, is_active, created_at, updated_at)
    VALUES (?, ?, 'openai', NULL, 'https://example.test', 'model', 8192, ?, 0, ?)
  `).run(id, id, isActive, updatedAt);
}

function seedMcpServer(id: string) {
  db.prepare(`INSERT INTO mcp_servers (id, name, server_type, config, is_connected, created_at, updated_at)
    VALUES (?, ?, 'stdio', NULL, 0, 0, 0)`).run(id, id);
}

function findTool(name: string, _projectId = PROJECT_ID, options: { activeAgentId?: string | null } = {}) {
  const tool = createAgentTools(options).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool ${name} was not registered`);
  return tool;
}

async function invoke(name: string, input: unknown, projectId = PROJECT_ID, options: { activeAgentId?: string | null } = {}) {
  const tool = findTool(name, projectId, options) as { invoke(input: unknown): Promise<string> };
  return JSON.parse(await tool.invoke(input));
}

async function createCustom(name = 'Reviewer') {
  const result = await invoke('create_agent', { name });
  expect(result.error).toBeUndefined();
  return result as { id: string; name: string; provider_id: string };
}

beforeEach(() => {
  freshDb();
});

afterAll(() => {
  db.close();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('Agent tools with the global Catalog schema', () => {
  it('lists General-purpose and Custom delegation targets globally, never Master', async () => {
    seedProvider('provider-1', 1, 1);
    const custom = await createCustom('Cross Project Reviewer');

    const result = await invoke('list_agents', {}, 'another-project');

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: GENERAL_PURPOSE_AGENT_ID, role: 'general-purpose' }),
      expect.objectContaining({ id: custom.id, role: 'custom', effective_slug: 'cross-project-reviewer' }),
    ]));
    expect(result.some((agent: { id: string }) => agent.id === MASTER_AGENT_ID)).toBe(false);
  });

  it('uses active-then-recent provider fallback and validates explicit provider selection', async () => {
    expect((await invoke('create_agent', { name: 'No Provider' })).error).toMatch(/No LLM provider is configured/);

    seedProvider('inactive-recent', 0, 30);
    seedProvider('active-old', 1, 10);
    seedProvider('active-new', 1, 20);
    expect((await createCustom('Active Fallback') as { provider_id: string }).provider_id).toBe('active-new');
    expect((await invoke('create_agent', { name: 'Null Provider Fallback', provider_id: null })).provider_id).toBe('active-new');
    expect((await invoke('create_agent', { name: 'Missing Provider', provider_id: 'missing' })).error).toBe('Provider not found: missing');

    db.exec("UPDATE llm_providers SET is_active = 0");
    expect((await createCustom('Recent Fallback') as { provider_id: string }).provider_id).toBe('inactive-recent');
  });

  it('surfaces global Catalog name and delegation-key conflicts without suffixing', async () => {
    seedProvider('provider-1', 1, 1);
    await createCustom('Global Reviewer');
    expect((await invoke('create_agent', { name: 'Global Reviewer' }, 'other-project')).error)
      .toMatch(/name conflicts/i);

    const sharedKey = 'a'.repeat(50);
    await createCustom(`${sharedKey}x`);
    const keyConflict = await invoke('create_agent', { name: `${sharedKey}y` }, 'yet-another-project');
    expect(keyConflict.error).toMatch(/delegation key conflicts/i);
    expect(keyConflict.effective_slug).toBeUndefined();
  });

  it('rejects Master and General-purpose updates and deletions', async () => {
    for (const id of [MASTER_AGENT_ID, GENERAL_PURPOSE_AGENT_ID]) {
      expect((await invoke('update_agent', { id, name: 'Changed' })).error).toMatch(/protected/i);
      expect((await invoke('delete_agent', { id })).error).toMatch(/Only Custom Agents/i);
    }
  });

  it('replaces supplied MCP exclusions and skills, deduping values and ignoring unknown MCP ids', async () => {
    seedProvider('provider-1', 1, 1);
    seedMcpServer('mcp-1');
    seedMcpServer('mcp-2');
    const created = await invoke('create_agent', {
      name: 'Relations',
      mcpServerExclusionIds: ['mcp-1', 'missing', 'mcp-1'],
      skillNames: ['built-in:knowledge-base', ' built-in:knowledge-base '],
    });

    expect(created.mcpServerExclusionIds).toEqual(['mcp-1']);
    expect(created.skillNames.sort()).toEqual(['built-in:knowledge-base']);

    const updated = await invoke('update_agent', {
      id: created.id,
      mcpServerExclusionIds: ['mcp-2', 'mcp-2'],
      skillNames: ['built-in:paper-search', 'built-in:paper-search'],
    });
    expect(updated.mcpServerExclusionIds).toEqual(['mcp-2']);
    expect(updated.skillNames).toEqual(['built-in:paper-search']);
    expect((db.prepare('SELECT mcp_server_id FROM agent_mcp_exclusions WHERE agent_id = ?').all(created.id) as Array<{ mcp_server_id: string }>))
      .toEqual([{ mcp_server_id: 'mcp-2' }]);
  });

  it('rolls back a Custom definition update when a relationship write fails', async () => {
    seedProvider('provider-1', 1, 1);
    const custom = await createCustom('Transactional');
    db.exec(`CREATE TRIGGER reject_agent_skill BEFORE INSERT ON agent_skills
      WHEN NEW.skill_name = 'built-in:knowledge-base'
      BEGIN SELECT RAISE(ABORT, 'relationship rejected'); END;`);

    const result = await invoke('update_agent', {
      id: custom.id,
      description: 'must not persist',
      skillNames: ['built-in:knowledge-base'],
    });

    expect(result.error).toMatch(/relationship rejected/);
    expect(db.prepare('SELECT description FROM agents WHERE id = ?').get(custom.id)).toEqual({ description: null });
    db.exec('DROP TRIGGER reject_agent_skill');
  });

  it('cascades a deleted Custom Agent through its relationships and completed run history', async () => {
    seedProvider('provider-1', 1, 1);
    seedMcpServer('mcp-1');
    const custom = await invoke('create_agent', {
      name: 'Cascade', provider_id: 'provider-1', mcpServerExclusionIds: ['mcp-1'], skillNames: ['built-in:knowledge-base'],
    });
    db.prepare(`INSERT INTO sessions (id, project_id, name, agent_id, summary, created_at, updated_at)
      VALUES ('session-1', ?, 'Session', NULL, NULL, 0, 0)`).run(PROJECT_ID);
    db.prepare(`INSERT INTO agent_runs (id, session_id, agent_id, request_id, status, started_at, aborted)
      VALUES ('run-1', 'session-1', ?, 'request-1', 'completed', 0, 0)`).run(custom.id);
    db.prepare(`INSERT INTO agent_tool_calls (id, run_id, tool_name, status, started_at)
      VALUES ('call-1', 'run-1', 'tool', 'success', 0)`).run();

    expect(await invoke('delete_agent', { id: custom.id })).toMatchObject({ deleted: true, id: custom.id });
    for (const table of ['agents', 'agent_mcp_exclusions', 'agent_skills', 'agent_runs', 'agent_tool_calls']) {
      expect((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'agents' ? 'id' : table === 'agent_runs' ? 'agent_id' : table === 'agent_tool_calls' ? 'run_id' : 'agent_id'} = ?`)
        .get(table === 'agent_tool_calls' ? 'run-1' : custom.id) as { count: number }).count).toBe(0);
    }
  });

  it.each(['running', 'waiting_approval'])('refuses to delete a Custom Agent with a %s run', async (status) => {
    seedProvider('provider-1', 1, 1);
    const custom = await createCustom(`In Flight ${status}`);
    db.prepare(`INSERT INTO sessions (id, project_id, name, agent_id, summary, created_at, updated_at)
      VALUES ('session-1', ?, 'Session', NULL, NULL, 0, 0)`).run(PROJECT_ID);
    db.prepare(`INSERT INTO agent_runs (id, session_id, agent_id, request_id, status, started_at, aborted)
      VALUES ('run-1', 'session-1', ?, 'request-1', ?, 0, 0)`).run(custom.id, status);

    expect((await invoke('delete_agent', { id: custom.id })).error).toMatch(/in-flight run/);
    expect(db.prepare('SELECT id FROM agents WHERE id = ?').get(custom.id)).toBeDefined();
  });

  it('refuses to delete the Agent active in this chat and requires a non-empty id', async () => {
    seedProvider('provider-1', 1, 1);
    const custom = await createCustom('Active');

    expect((await invoke('delete_agent', { id: '' })).error).toBe('Agent id is required.');
    expect((await invoke('delete_agent', { id: custom.id }, PROJECT_ID, { activeAgentId: custom.id })).error).toMatch(/currently running/);
  });
});
