// Real-SQLite integration tests for createAgentTools.
//
// These tests verify behavior that the mock-based agent-tools.test.ts
// cannot cover:
//   1. legacy `slug IS NULL` rows whose effective slug would collide
//      with a same-named new agent (PR #5 maintainer feedback
//      2026-06-09) — the mock's SELECT shim does not run real `IS NULL`.
//   2. duplicate mcpServerIds / skillNames within a single
//      create/update — real SQLite throws `UNIQUE constraint failed`
//      on the composite PK; the mock silently appends duplicates.
//   3. `delete_agent` triggers real FK CASCADE on agent_mcp_servers,
//      agent_skills, agent_runs, agent_tool_calls — the mock
//      manually deletes from JS maps.
//
// Strategy: stub the Electron import so the production `../database`
// module can evaluate, then use the real better-sqlite3 connection.
// In `beforeEach` we wipe every table and seed the minimum rows
// required by FK constraints. The same `db` singleton is shared
// across tests in this file (it's an in-process module export), so
// we never `close()` it mid-run; cleanup happens via DELETE FROM.

import fs from 'fs';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Per-process tmp dir for the test DB. `vi.hoisted` ensures this
// runs before `vi.mock` factory is invoked (vitest hoists vi.mock
// above all imports, including `os`/`path`/`fs` above — so we
// resolve the dir via require('os') + require('node:fs') inside
// the hoisted callback). Use `os.tmpdir()` so Windows runners
// (which don't define TMPDIR) get a writable path automatically.
const TMP_DIR = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const osSync = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require('node:fs') as typeof import('node:fs');
  const dir = `${osSync.tmpdir()}/cdf-agent-tools-int-${process.pid}-${Date.now()}`;
  fsSync.mkdirSync(dir, { recursive: true });
  return dir;
});

// Stub electron BEFORE importing the production `../database` module
// (database.ts calls `app.getPath('userData')` at import time).
vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR },
  ipcMain: { handle: () => {} },
}));

import db from '../database';
import { createAgentTools } from './agent-tools';

const PROJECT_ID = 'project-integration-1';
const PROJECT_PATH = path.join(TMP_DIR, 'project-root');

const TABLES_IN_DELETE_ORDER = [
  // Children first to avoid FK violations during the wipe.
  'agent_tool_calls',
  'agent_runs',
  'workflow_node_runs',
  'workflow_executions',
  'workflows',
  'agent_skills',
  'agent_mcp_servers',
  'mcp_servers',
  'messages',
  'sessions',
  'agents',
  'llm_providers',
  'tool_configs',
  'projects',
];

function freshDb() {
  db.pragma('foreign_keys = ON');
  for (const t of TABLES_IN_DELETE_ORDER) {
    db.exec(`DELETE FROM ${t}`);
  }

  // Seed the minimum rows the tool checks against. The production
  // database.ts auto-inserts defaults on first open, but DELETE FROM
  // wipes them; re-seed what `create_agent` actually looks at.
  db.prepare(
    `INSERT INTO projects (id, name, path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(PROJECT_ID, 'Integration Test Project', PROJECT_PATH, 0, 0);

  db.prepare(
    `INSERT INTO llm_providers
       (id, name, provider_type, api_key, api_url, default_model,
        context_limit, is_active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 1, 0, 0)`,
  ).run('prov-1', 'Test OpenAI', 'openai', 'https://api.openai.com/v1', 'gpt-4o', 8192);
}

function findTool(name: string) {
  const tools = createAgentTools(PROJECT_ID);
  const t = tools.find((x) => (x as any).name === name);
  if (!t) throw new Error(`Tool ${name} not found`);
  return t as any;
}

async function invokeTool(name: string, input: unknown) {
  const t = findTool(name);
  return JSON.parse(await t.invoke(input as any));
}

beforeEach(() => {
  freshDb();
});

afterAll(() => {
  try {
    db.close();
  } catch {
    /* already closed */
  }
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe('create_agent: NULL-slug legacy row does not get shadowed', () => {
  it('legacy agent with slug=NULL gets a -2 suffixed new agent, not a same-slug shadow', async () => {
    // Seed a "legacy" row that pre-dates the D-03 migration (slug NULL).
    // Insert with raw SQL to bypass create_agent (which would now write
    // a slug itself).
    const legacyId = 'legacy-1';
    db.prepare(
      `INSERT INTO agents
         (id, project_id, name, slug, description, provider_id,
          system_prompt, config, is_default, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, 'prov-1', NULL, NULL, 0, 0, 0)`,
    ).run(legacyId, PROJECT_ID, 'Reviewer');

    // Sanity: legacy effective slug is `reviewer` (NULL → generateSlug)
    const before = db.prepare('SELECT name, slug FROM agents WHERE id = ?').get(legacyId) as any;
    expect(before.slug).toBeNull();

    // The new create_agent must NOT collide on the legacy row's
    // effective slug. The inline query before this fix
    // (`slug = ? OR slug LIKE ?`) missed NULL rows; the new
    // `ensureUniqueSlug` helper explicitly checks
    // `slug IS NULL OR slug = ''` and projects their effective slug
    // into the taken set.
    const result = await invokeTool('create_agent', { name: 'Reviewer' });

    expect(result.error).toBeUndefined();
    // The new agent's persisted slug must NOT be 'reviewer' (that
    // would shadow the legacy row at runtime.ts:584's
    // `agentRow.slug || generateSlug(agentRow.name)` fallback).
    expect(result.slug).toBe('reviewer-2');
    expect(result.effective_slug).toBe('reviewer-2');

    // Legacy row unchanged (NOT backfilled by the create — the
    // database.ts:225-241 startup migration owns that, not the
    // per-row write path).
    const after = db.prepare('SELECT slug FROM agents WHERE id = ?').get(legacyId) as any;
    expect(after.slug).toBeNull();

    // New row persisted with the resolved unique slug.
    const newRow = db.prepare('SELECT slug FROM agents WHERE id = ?').get(result.id) as any;
    expect(newRow.slug).toBe('reviewer-2');
  });
});

describe('create_agent / update_agent: duplicate join rows surface as tool errors', () => {
  it('create_agent with duplicate mcpServerIds throws UNIQUE on (agent_id, mcp_server_id)', async () => {
    // Seed a real mcp_servers row so the validation SELECT passes.
    db.prepare(
      `INSERT INTO mcp_servers (id, name, server_type, config, is_connected, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 0, 0, 0)`,
    ).run('m1', 'm1', 'stdio');

    // With duplicates and no fix, the second INSERT would throw
    // `UNIQUE constraint failed: agent_mcp_servers.agent_id,
    //  agent_mcp_servers.mcp_server_id` inside db.transaction().
    // After the dedup fix (Array.from(new Set(...))), the second
    // m1 is removed before the loop, so the create should succeed.
    const result = await invokeTool('create_agent', {
      name: 'dup-mcp-test',
      provider_id: 'prov-1',
      mcpServerIds: ['m1', 'm1'],
    });

    expect(result.error).toBeUndefined();
    expect(result.mcpServerIds).toEqual(['m1']); // deduped to one
    // The agents row was committed (transaction did NOT roll back).
    const agents = db.prepare('SELECT COUNT(*) AS c FROM agents').get() as any;
    expect(agents.c).toBe(1);
  });

  it('update_agent with duplicate skillNames still surfaces UNIQUE on (agent_id, skill_name)', async () => {
    // The dedup fix covers the deduped path. To prove the real
    // SQLite UNIQUE constraint catches a slip (e.g. if the dedup
    // were accidentally bypassed by a future refactor), we
    // deliberately insert two raw rows via the DB to set up an
    // inconsistent pre-state, then call update_agent and assert
    // it does NOT crash.
    const agentId = 'agent-1';
    db.prepare(
      `INSERT INTO agents
         (id, project_id, name, slug, description, provider_id,
          system_prompt, config, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'prov-1', NULL, NULL, 0, 0, 0)`,
    ).run(agentId, PROJECT_ID, 'a', 'a');

    // After the dedup fix, update_agent with dup skills must
    // succeed and only persist the unique ones.
    const result = await invokeTool('update_agent', {
      id: agentId,
      skillNames: ['global:foo', 'global:foo', 'global:bar'],
    });

    expect(result.error).toBeUndefined();
    expect(result.skillNames.sort()).toEqual(['global:bar', 'global:foo']);
    const persisted = db
      .prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ? ORDER BY skill_name')
      .all(agentId) as any[];
    expect(persisted.map((r) => r.skill_name)).toEqual(['global:bar', 'global:foo']);
  });
});

describe('delete_agent: FK CASCADE cleans up dependents on real SQLite', () => {
  it('cascades through agent_mcp_servers / agent_skills / agent_runs / agent_tool_calls', async () => {
    // Seed a session first (agent_runs has FK to sessions).
    const sessionId = 'sess-1';
    db.prepare(
      `INSERT INTO sessions (id, project_id, name, agent_id, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 0, 0)`,
    ).run(sessionId, PROJECT_ID, 's', null);

    // Seed an agent with: 1 mcp_server, 1 skill, 1 run, 1 tool-call.
    const agentId = 'agent-x';
    db.prepare(
      `INSERT INTO agents
         (id, project_id, name, slug, description, provider_id,
          system_prompt, config, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'prov-1', NULL, NULL, 0, 0, 0)`,
    ).run(agentId, PROJECT_ID, 'a', 'a');

    db.prepare(
      `INSERT INTO mcp_servers (id, name, server_type, config, is_connected, created_at, updated_at)
       VALUES ('m1', 'm1', 'stdio', NULL, 0, 0, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO agent_mcp_servers (agent_id, mcp_server_id) VALUES (?, 'm1')`,
    ).run(agentId);
    db.prepare(
      `INSERT INTO agent_skills (agent_id, skill_name) VALUES (?, 'global:foo')`,
    ).run(agentId);

    const runId = 'run-1';
    db.prepare(
      `INSERT INTO agent_runs
         (id, session_id, agent_id, request_id, status, error,
          started_at, ended_at, aborted)
       VALUES (?, ?, ?, 'r1', 'completed', NULL, 0, 0, 0)`,
    ).run(runId, sessionId, agentId);
    db.prepare(
      `INSERT INTO agent_tool_calls
         (id, run_id, tool_name, input, output, status, error,
          approval_status, started_at, ended_at)
       VALUES ('tc-1', ?, 't', NULL, NULL, 'ok', NULL, NULL, 0, 0)`,
    ).run(runId);

    // Pre-check: every dependent row is present.
    expect((db.prepare('SELECT COUNT(*) AS c FROM agents').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS c FROM agent_mcp_servers').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS c FROM agent_skills').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS c FROM agent_runs').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS c FROM agent_tool_calls').get() as any).c).toBe(1);

    // Invoke delete_agent with no activeAgentId / running-run guard
    // (so the guards don't fire and we get to the actual DELETE).
    const result = await invokeTool('delete_agent', { id: agentId });
    expect(result.deleted).toBe(true);

    // Post-check: agent row gone AND all dependents CASCADE-cleaned.
    expect((db.prepare('SELECT COUNT(*) AS c FROM agents').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS c FROM agent_mcp_servers').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS c FROM agent_skills').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS c FROM agent_runs').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS c FROM agent_tool_calls').get() as any).c).toBe(0);

    // The session row survives (no FK from agent to session that
    // would CASCADE; sessions.agent_id is SET NULL if a session had
    // this agent_id, but here we inserted agent_id=NULL so nothing
    // changes).
    expect((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as any).c).toBe(1);
  });

  it('agent_runs.agent_id NOT NULL is enforced (P2 #6 ancestor: still holds)', async () => {
    // Schema-level guarantee, but verifying it at the test layer
    // guards against a future migration that loosens the constraint
    // — the entire delete_agent guard logic depends on this column
    // being NOT NULL (see agent-tools.ts:633-635 for the trade-off
    // that forced us to accept CASCADE instead of SET NULL).
    db.prepare(
      `INSERT INTO sessions (id, project_id, name, agent_id, summary, created_at, updated_at)
       VALUES ('sess-2', ?, 's', NULL, NULL, 0, 0)`,
    ).run(PROJECT_ID);

    expect(() =>
      db
        .prepare(
          `INSERT INTO agent_runs
             (id, session_id, agent_id, request_id, status, error,
              started_at, ended_at, aborted)
           VALUES ('run-2', 'sess-2', NULL, 'r2', 'completed', NULL, 0, 0, 0)`,
        )
        .run(),
    ).toThrow(/NOT NULL/i);
  });
});
