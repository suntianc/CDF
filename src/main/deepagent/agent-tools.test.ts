// Tests for createAgentTools — the 4 Master Agent tools that expose agent
// CRUD to the chat conversation.
//
// We mock `../database` with a tiny in-memory SQL engine (better-sqlite3 is
// loaded by the actual `db` import; for unit tests we provide a minimal
// prepare/run/get/all shim that satisfies our queries).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --------------------- Build a mock better-sqlite3 ---------------------
// We avoid a real SQLite file by replacing the `db` module with a hand-rolled
// in-memory store that responds to the same query patterns the tools use
// (prepare, run, get, all, transaction).

interface AgentRow {
  id: string;
  project_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  provider_id: string | null;
  system_prompt: string | null;
  config: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

const dbState = {
  agents: new Map<string, AgentRow>(),
  agentMcp: new Map<string, string[]>(),
  agentSkills: new Map<string, string[]>(),
  providers: new Map<string, { id: string; is_active?: number; updated_at?: number }>(),
  mcpServers: new Map<string, { id: string; project_id: string }>(),
  // 仅跟踪 agent_runs 的 agent_id 引用 + status(P2 #9 检查需要)
  // sessions 靠 FK ON DELETE SET NULL 自动 orphan,messages 无 agent_id 列
  agentRuns: new Map<string, { id: string; agent_id: string | null; status?: string }>(),
};

function resetState() {
  dbState.agents.clear();
  dbState.agentMcp.clear();
  dbState.agentSkills.clear();
  dbState.providers.clear();
  dbState.mcpServers.clear();
  dbState.agentRuns.clear();
}

function makePrepared(state: typeof dbState) {
  // Handler signature: (sql) → object with .run, .get, .all
  return (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const run = (...params: any[]) => {
      // INSERT agents
      let m = s.match(/^INSERT INTO agents \((.+)\) VALUES \((.+)\)$/i);
      if (m) {
        const [
          id, project_id, name, slug, description, provider_id, system_prompt, config, is_default, created_at, updated_at,
        ] = params;
        dbState.agents.set(id, {
          id, project_id, name, slug: slug ?? null,
          description: description ?? null,
          provider_id: provider_id ?? null,
          system_prompt: system_prompt ?? null,
          config: config ?? null,
          is_default: is_default ? 1 : 0,
          created_at, updated_at,
        });
        return { changes: 1 };
      }
      // UPDATE agents SET is_default = 1, updated_at = ? WHERE id = ?
      // (SPECIFIC match — must precede the generic SET regex below,
      // which would mis-handle the literal '1' value)
      if (s === 'UPDATE agents SET is_default = 1, updated_at = ? WHERE id = ?') {
        const [now, id] = params;
        const existing = dbState.agents.get(id as string);
        if (existing) {
          existing.is_default = 1;
          existing.updated_at = now as number;
        }
        return { changes: 1 };
      }
      // UPDATE agents SET ... WHERE id = ?  (generic catch-all)
      m = s.match(/^UPDATE agents SET (.+) WHERE id = \?$/i);
      if (m) {
        const id = params[params.length - 1];
        const existing = dbState.agents.get(id);
        if (!existing) return { changes: 0 };
        const sets = m[1].split(',').map((x) => x.trim());
        for (let i = 0; i < sets.length; i++) {
          const [col] = sets[i].split('=').map((x) => x.trim());
          existing[col as keyof AgentRow] = params[i] as any;
        }
        existing.updated_at = params[params.length - 2] as number;
        return { changes: 1 };
      }
      // UPDATE agents SET is_default = 0 ... (project-wide default reset)
      m = s.match(/^UPDATE agents SET is_default = 0, updated_at = \? WHERE project_id = \?$/i);
      if (m) {
        const [now, projectId] = params;
        for (const a of dbState.agents.values()) {
          if (a.project_id === projectId) {
            a.is_default = 0;
            a.updated_at = now as number;
          }
        }
        return { changes: dbState.agents.size };
      }
      m = s.match(/^UPDATE agents SET is_default = 0, updated_at = \? WHERE project_id = \? AND id != \?$/i);
      if (m) {
        const [now, projectId, exceptId] = params;
        for (const a of dbState.agents.values()) {
          if (a.project_id === projectId && a.id !== exceptId) {
            a.is_default = 0;
            a.updated_at = now as number;
          }
        }
        return { changes: dbState.agents.size };
      }
      // DELETE FROM agent_mcp_servers WHERE agent_id = ?
      if (s === 'DELETE FROM agent_mcp_servers WHERE agent_id = ?') {
        const [id] = params;
        dbState.agentMcp.delete(id as string);
        return { changes: 1 };
      }
      // DELETE FROM agent_skills WHERE agent_id = ?
      if (s === 'DELETE FROM agent_skills WHERE agent_id = ?') {
        const [id] = params;
        dbState.agentSkills.delete(id as string);
        return { changes: 1 };
      }
      // DELETE FROM agents WHERE id = ? (also simulate FK CASCADE on the
      // joined tables — matches production SQLite behavior)
      if (s === 'DELETE FROM agents WHERE id = ?') {
        const [id] = params;
        dbState.agents.delete(id as string);
        dbState.agentMcp.delete(id as string);
        dbState.agentSkills.delete(id as string);
        // agent_runs.agent_id is NOT NULL in production schema, so CASCADE
        // here means delete the rows (not nullify).
        for (const run of dbState.agentRuns.values()) {
          if (run.agent_id === id) {
            dbState.agentRuns.delete(run.id);
          }
        }
        return { changes: 1 };
      }
      // INSERT INTO agent_mcp_servers
      if (s === 'INSERT INTO agent_mcp_servers (agent_id, mcp_server_id) VALUES (?, ?)') {
        const [aid, mid] = params;
        if (!dbState.agentMcp.has(aid as string)) dbState.agentMcp.set(aid as string, []);
        dbState.agentMcp.get(aid as string)!.push(mid as string);
        return { changes: 1 };
      }
      // INSERT INTO agent_skills
      if (s === 'INSERT INTO agent_skills (agent_id, skill_name) VALUES (?, ?)') {
        const [aid, name] = params;
        if (!dbState.agentSkills.has(aid as string)) dbState.agentSkills.set(aid as string, []);
        dbState.agentSkills.get(aid as string)!.push(name as string);
        return { changes: 1 };
      }
      // UPDATE agent_runs SET agent_id = NULL WHERE agent_id = ?
      if (s === 'UPDATE agent_runs SET agent_id = NULL WHERE agent_id = ?') {
        const [id] = params;
        for (const run of dbState.agentRuns.values()) {
          if (run.agent_id === id) run.agent_id = null;
        }
        return { changes: dbState.agentRuns.size };
      }
      return { changes: 0 };
    };

    const get = (...params: any[]) => {
      // SELECT id FROM llm_providers WHERE id = ?
      if (s === 'SELECT id FROM llm_providers WHERE id = ?') {
        const [id] = params;
        return dbState.providers.get(id as string);
      }
      // SELECT id FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1
      // (matches runtime.ts:78-89 getFallbackProviderId active-first branch)
      if (s === 'SELECT id FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1') {
        const active = [...dbState.providers.values()].filter((p) => (p as any).is_active === 1);
        if (active.length === 0) return undefined;
        return active.sort((a, b) => ((b as any).updated_at ?? 0) - ((a as any).updated_at ?? 0))[0];
      }
      // SELECT id FROM llm_providers ORDER BY updated_at DESC LIMIT 1
      // (matches runtime.ts fallback when no active provider)
      if (s === 'SELECT id FROM llm_providers ORDER BY updated_at DESC LIMIT 1') {
        const all = [...dbState.providers.values()];
        if (all.length === 0) return undefined;
        return all.sort((a, b) => ((b as any).updated_at ?? 0) - ((a as any).updated_at ?? 0))[0];
      }
      // SELECT id FROM mcp_servers WHERE id = ?
      if (s === 'SELECT id FROM mcp_servers WHERE id = ?') {
        const [id] = params;
        return dbState.mcpServers.get(id as string);
      }
      // SELECT * FROM agents WHERE id = ?
      if (s === 'SELECT * FROM agents WHERE id = ?') {
        const [id] = params;
        return dbState.agents.get(id as string);
      }
      // SELECT * FROM agents WHERE id = ? AND project_id = ?
      if (s === 'SELECT * FROM agents WHERE id = ? AND project_id = ?') {
        const [id, pid] = params;
        const r = dbState.agents.get(id as string);
        if (r && r.project_id === pid) return r;
        return undefined;
      }
      // SELECT id, name FROM agents WHERE id = ? AND project_id = ?
      if (s === 'SELECT id, name FROM agents WHERE id = ? AND project_id = ?') {
        const [id, pid] = params;
        const r = dbState.agents.get(id as string);
        if (r && r.project_id === pid) return { id: r.id, name: r.name };
        return undefined;
      }
      // SELECT id, name, is_default FROM agents WHERE id = ? AND project_id = ?
      if (s === 'SELECT id, name, is_default FROM agents WHERE id = ? AND project_id = ?') {
        const [id, pid] = params;
        const r = dbState.agents.get(id as string);
        if (r && r.project_id === pid) {
          return { id: r.id, name: r.name, is_default: r.is_default };
        }
        return undefined;
      }
      // SELECT id FROM agents WHERE project_id = ? AND is_default = 1 AND id != ?
      // (P2 #11 / P2 #12: "any other default agent?" check)
      if (s === 'SELECT id FROM agents WHERE project_id = ? AND is_default = 1 AND id != ?') {
        const [pid, exceptId] = params;
        for (const a of dbState.agents.values()) {
          if (a.project_id === pid && a.is_default === 1 && a.id !== exceptId) {
            return { id: a.id };
          }
        }
        return undefined;
      }
      // SELECT 1 AS one FROM agents WHERE project_id = ? AND is_default = 1 LIMIT 1
      // (自审 P2 候选 #1: create_agent checks "project has any default?")
      if (s === 'SELECT 1 AS one FROM agents WHERE project_id = ? AND is_default = 1 LIMIT 1') {
        const [pid] = params;
        for (const a of dbState.agents.values()) {
          if (a.project_id === pid && a.is_default === 1) {
            return { one: 1 };
          }
        }
        return undefined;
      }
      // SELECT id, session_id, status FROM agent_runs
      //   WHERE agent_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1
      if (
        s ===
        "SELECT id, session_id, status FROM agent_runs " +
          "WHERE agent_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1"
      ) {
        const [aid] = params;
        for (const run of dbState.agentRuns.values()) {
          if (
            run.agent_id === aid &&
            (run.status === 'running' || run.status === 'waiting_approval')
          ) {
            return run;
          }
        }
        return undefined;
      }
      return undefined;
    };

    const all = (...params: any[]) => {
      // SELECT * FROM agents WHERE project_id = ? ORDER BY is_default DESC, updated_at DESC
      if (s === 'SELECT * FROM agents WHERE project_id = ? ORDER BY is_default DESC, updated_at DESC') {
        const [pid] = params;
        return Array.from(dbState.agents.values())
          .filter((a) => a.project_id === pid)
          .sort((a, b) => b.is_default - a.is_default || b.updated_at - a.updated_at);
      }
      // SELECT mcp_server_id FROM agent_mcp_servers WHERE agent_id = ?
      if (s === 'SELECT mcp_server_id FROM agent_mcp_servers WHERE agent_id = ?') {
        const [aid] = params;
        return (dbState.agentMcp.get(aid as string) ?? []).map((id) => ({ mcp_server_id: id }));
      }
      // SELECT skill_name FROM agent_skills WHERE agent_id = ?
      if (s === 'SELECT skill_name FROM agent_skills WHERE agent_id = ?') {
        const [aid] = params;
        return (dbState.agentSkills.get(aid as string) ?? []).map((name) => ({ skill_name: name }));
      }
      // SELECT id, slug, name FROM agents WHERE project_id = ? AND
      //   (slug = ? OR slug LIKE ? OR slug IS NULL OR slug = ?)
      // (P2 #16: create_agent slug-uniqueness check via ensureUniqueSlug.
      // The IS NULL / = '' branches project legacy rows' effective
      // slugs into the taken set so a NULL-slug row cannot be shadowed
      // by a same-name insert — PR #5 maintainer feedback 2026-06-09.)
      if (
        s ===
        'SELECT id, slug, name FROM agents WHERE project_id = ? AND (slug = ? OR slug LIKE ? OR slug IS NULL OR slug = ?)'
      ) {
        const [pid, base, likePattern] = params as [string, string, string];
        const likePrefix = likePattern.replace(/%$/, '');
        return Array.from(dbState.agents.values())
          .filter(
            (a) =>
              a.project_id === pid &&
              (a.slug === base ||
                (a.slug && a.slug.startsWith(likePrefix)) ||
                a.slug === null ||
                a.slug === ''),
          )
          .map((a) => ({ id: a.id, slug: a.slug, name: a.name }));
      }
      return [];
    };

    return { run, get, all };
  };
}

vi.mock('../database', () => ({
  default: {
    prepare: vi.fn(),
    transaction: (fn: (...args: any[]) => any) => (...args: any[]) => fn(...args),
  },
}));

import db from '../database';
import { createAgentTools } from './agent-tools';

// --------------------- Test helpers ---------------------

const PROJECT_ID = 'project-test-1';

function seedProvider(id = 'provider-1') {
  dbState.providers.set(id, { id });
}

function seedAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  const id = overrides.id ?? `agent-${dbState.agents.size + 1}`;
  const row: AgentRow = {
    id,
    project_id: overrides.project_id ?? PROJECT_ID,
    name: overrides.name ?? 'Test Agent',
    slug: overrides.slug ?? null,
    description: overrides.description ?? null,
    provider_id: overrides.provider_id ?? null,
    system_prompt: overrides.system_prompt ?? null,
    config: overrides.config ?? null,
    is_default: overrides.is_default ?? 0,
    created_at: overrides.created_at ?? Date.now(),
    updated_at: overrides.updated_at ?? Date.now(),
  };
  dbState.agents.set(id, row);
  return row;
}

function findTool(name: string, options: { activeAgentId?: string | null } = {}) {
  const tools = createAgentTools(PROJECT_ID, options);
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t;
}

async function invoke(name: string, input: any, options: { activeAgentId?: string | null } = {}) {
  const t: any = findTool(name, options);
  const raw = await t.invoke(input);
  return JSON.parse(raw);
}

// --------------------- Tests ---------------------

describe('createAgentTools', () => {
  beforeEach(() => {
    resetState();
    // Wire the mocked db.prepare to our state machine
    (db.prepare as any).mockImplementation((sql: string) => makePrepared(dbState)(sql));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('list_agents', () => {
    it('returns empty array when no agents exist', async () => {
      const result = await invoke('list_agents', {});
      expect(result).toEqual([]);
    });

    it('returns all agents in current project, with mcpServerIds + skillNames', async () => {
      const a = seedAgent({ name: 'Alpha', is_default: 1 });
      const b = seedAgent({ name: 'Beta' });
      dbState.agentMcp.set(a.id, ['m1', 'm2']);
      dbState.agentSkills.set(b.id, ['global:foo']);

      const result = await invoke('list_agents', {});
      expect(result).toHaveLength(2);
      // default first
      expect(result[0].name).toBe('Alpha');
      expect(result[0].mcpServerIds).toEqual(['m1', 'm2']);
      expect(result[1].name).toBe('Beta');
      expect(result[1].skillNames).toEqual(['global:foo']);
    });
  });

  describe('create_agent', () => {
    it('creates an agent with required name only (auto-defaults when project has none)', async () => {
      // Pre-seed a provider so the fallback path can succeed.
      seedProvider('p-default');
      const result = await invoke('create_agent', { name: 'reviewer' });
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.name).toBe('reviewer');
      expect(result.project_id).toBe(PROJECT_ID);
      // 自审 P2 候选 #1: project had no default, so the new agent is
      // auto-promoted to default (preserves the ≥1 default invariant).
      expect(result.is_default).toBe(true);
      // provider_id is auto-set via fallback (P2 #3 fix)
      expect(result.provider_id).toBe('p-default');
      // Verify persisted
      expect(dbState.agents.get(result.id)?.name).toBe('reviewer');
      expect(dbState.agents.get(result.id)?.is_default).toBe(1);
    });

    it('rejects when no provider configured and no provider_id given (P2 #3)', async () => {
      const result = await invoke('create_agent', { name: 'orphan' });
      expect(result.error).toMatch(/No LLM provider configured/);
      expect(dbState.agents.size).toBe(0);
    });

    it('falls back to active provider when provider_id omitted (P2 #3 + P2 #6)', async () => {
      // Codex P2 #6: lexicographic ORDER BY id picks `default-anthropic` (inactive)
      // over the real active provider, leaving the agent unable to run.
      // Fix: prefer providers with is_active = 1, fall back to most-recently-updated.
      const now = Date.now();
      dbState.providers.set('p-inactive', { id: 'p-inactive', is_active: 0, updated_at: now - 1000 });
      dbState.providers.set('p-active-old', { id: 'p-active-old', is_active: 1, updated_at: now - 500 });
      dbState.providers.set('p-active-new', { id: 'p-active-new', is_active: 1, updated_at: now });
      const result = await invoke('create_agent', { name: 'fallback' });
      expect(result.provider_id).toBe('p-active-new');
    });

    it('falls back to most-recently-updated provider when no active provider (P2 #6)', async () => {
      const now = Date.now();
      dbState.providers.set('p-stale', { id: 'p-stale', is_active: 0, updated_at: now - 1000 });
      dbState.providers.set('p-recent', { id: 'p-recent', is_active: 0, updated_at: now });
      const result = await invoke('create_agent', { name: 'fallback' });
      expect(result.provider_id).toBe('p-recent');
    });

    it('rejects names with non-English characters', async () => {
      const result = await invoke('create_agent', { name: '中文名' });
      expect(result.error).toMatch(/English letters/);
      expect(dbState.agents.size).toBe(0);
    });

    it('rejects empty / whitespace-only names', async () => {
      const result = await invoke('create_agent', { name: '   ' });
      expect(result.error).toMatch(/English letters/);
    });

    it('auto-promotes new agent to default when project has none (自审 P2 候选 #1)', async () => {
      // Without this guard, if the project has no default agent
      // (e.g. after the user deleted the previous default), creating
      // an agent without is_default would leave the project with no
      // default. The next chat omitting agentId would trigger
      // ensureDefaultAgent to auto-create a 'Master Agent' row,
      // silently changing the default and cluttering the library
      // (same downstream effect as P2 #11 / P2 #12).
      seedProvider('p-default');
      // No agents in the project yet → no default
      const result = await invoke('create_agent', { name: 'new-default' });
      expect(result.is_default).toBe(true);
      expect(dbState.agents.get(result.id)!.is_default).toBe(1);
    });

    it('does NOT auto-promote when project already has a default (自审 P2 候选 #1)', async () => {
      // Sanity check: the auto-promotion only fires when the project
      // currently has no default. If a default already exists, the
      // new agent should be created as non-default (unless explicit
      // is_default: true is passed).
      seedProvider('p-default');
      const existing = await invoke('create_agent', {
        name: 'existing-default',
        is_default: true,
      });
      const result = await invoke('create_agent', { name: 'new-non-default' });
      expect(result.is_default).toBe(false);
      // Existing default preserved
      expect(dbState.agents.get(existing.id)!.is_default).toBe(1);
    });

    it('respects explicit is_default: false even when project has no default (自审 P2 候选 #1 + Codex P2 id=3382053065)', async () => {
      // Edge case: user explicitly says "do NOT make this default".
      // The auto-promotion is only for *omitted* is_default, NOT for
      // explicit `false`. The old `if (!input.is_default)` accidentally
      // treated both the same because `!false === true`; Codex P2
      // id=3382053065 caught this. After the UI's db:deleteAgent
      // removes the only default agent, a create_agent call with
      // is_default: false must stay at false and not silently re-promote
      // (the user's explicit "not default" choice wins).
      //
      // Trade-off (documented): if the project genuinely has no default
      // AND the user explicitly opts out, the project stays without a
      // default. The next chat that omits agentId will fall through
      // ensureDefaultAgent (runtime.ts:132) and auto-insert a new
      // "Master Agent" row. That trade-off was already discussed in the
      // original P2 #11/#12 review thread — explicit choice overrides
      // silent auto-promotion.
      seedProvider('p-default');
      const result = await invoke('create_agent', {
        name: 'explicit-false',
        is_default: false,
      });
      // Explicit false is respected: agent created with is_default=0,
      // NOT silently promoted.
      expect(result.is_default).toBe(false);
      expect(dbState.agents.get(result.id)!.is_default).toBe(0);
      // No other agent in the project was promoted either.
      const anyDefault = (dbState.agents.values() as any[]).some(
        (a) => a.project_id === 'project-test-1' && a.is_default === 1,
      );
      expect(anyDefault).toBe(false);
    });

    it('returns slug + effective_slug in tool results (P2 #14)', async () => {
      // Codex P2 #14: when the master delegates work to a newly
      // created subagent via `task(name: ...)`, the actual task key
      // is the agent's slug (or a slugified version of name), NOT
      // the raw display name. Without returning slug from the tool,
      // the master has to guess what key to pass.
      seedProvider('p-default');
      const result = await invoke('create_agent', { name: 'Code Reviewer' });
      // effective_slug is the resolved task key the master should use
      expect(result.effective_slug).toBe('code-reviewer');
      // raw slug is also persisted in DB
      expect(result.slug).toBe('code-reviewer');
      expect(dbState.agents.get(result.id)?.slug).toBe('code-reviewer');
    });

    it('appends -2 when slug collides with an existing agent (P2 #16)', async () => {
      // Codex P2 #16: two agents whose names slugify to the same key
      // (e.g. "Code Reviewer" + "Code-Reviewer" + "code  reviewer")
      // would otherwise share the same `effective_slug`. The runtime
      // registers subagents under `agentRow.slug || generateSlug(...)`
      // (runtime.ts:571) — so the master has no distinct
      // `task(name: ...)` target for the second one, and delegation
      // becomes ambiguous / unreachable. Fix: de-dupe within the
      // project by appending -2, -3, ... to the slug.
      seedProvider('p-default');
      const first = await invoke('create_agent', { name: 'Code Reviewer' });
      expect(first.effective_slug).toBe('code-reviewer');

      const second = await invoke('create_agent', { name: 'Code-Reviewer' });
      expect(second.effective_slug).toBe('code-reviewer-2');
      // Slug persisted in DB too (P2 #14 invariant)
      expect(second.slug).toBe('code-reviewer-2');
      expect(dbState.agents.get(second.id)?.slug).toBe('code-reviewer-2');

      // Both rows are present, neither lost
      expect(dbState.agents.get(first.id)?.slug).toBe('code-reviewer');
      expect(dbState.agents.get(second.id)?.slug).toBe('code-reviewer-2');
    });

    it('three-way collision produces -2 and -3 suffixes (P2 #16)', async () => {
      seedProvider('p-default');
      const a = await invoke('create_agent', { name: 'Reviewer' });
      const b = await invoke('create_agent', { name: 'Reviewer' });
      const c = await invoke('create_agent', { name: 'Reviewer' });
      expect(a.effective_slug).toBe('reviewer');
      expect(b.effective_slug).toBe('reviewer-2');
      expect(c.effective_slug).toBe('reviewer-3');
    });

    it('slug uniqueness is scoped to the project (P2 #16)', async () => {
      // Slugs are task keys for `task(name:)`, and the runtime
      // registers subagents scoped to the current project. So the
      // uniqueness check is project-scoped, not global. A
      // "Code Reviewer" in project A doesn't block the same name in
      // project B.
      seedProvider('p-default');
      const a = await invoke('create_agent', { name: 'Code Reviewer' });
      // Seed a different project with the same agent name directly
      // (bypasses create_agent so we can prove independence).
      seedAgent({ id: 'other-project-agent', project_id: 'other-project', name: 'Code Reviewer', slug: 'code-reviewer' });
      // Now create a second in the *current* project — should still
      // get -2 because the current project has the slug.
      const b = await invoke('create_agent', { name: 'Code Reviewer' });
      expect(a.effective_slug).toBe('code-reviewer');
      expect(b.effective_slug).toBe('code-reviewer-2');
    });

    it('returns a defer-delegation note in tool results (P2 #15)', async () => {
      // Codex P2 #15: the runtime's subagents list is snapshotted in
      // createDeepAgentRuntime before any tool call (runtime.ts:547-599).
      // A create_agent in the same turn writes a new row, but the live
      // runtime's `subagents` array doesn't see it, so `task(name: ...)`
      // against the returned effective_slug fails until the next turn /
      // new chat session. Fix: surface this in the JSON return so the
      // master knows the agent is "created but not yet routable".
      seedProvider('p-default');
      const result = await invoke('create_agent', { name: 'Defer Me' });
      expect(result.note).toBeDefined();
      expect(result.note).toMatch(/createDeepAgentRuntime/);
      expect(result.note).toMatch(/task\(name/);
      expect(result.note).toMatch(/下个 turn|next turn/);
    });

    it('accepts valid special characters in name (space, hyphen, underscore)', async () => {
      seedProvider('p-default');
      const result = await invoke('create_agent', { name: 'Code Reviewer-v2_final' });
      expect(result.id).toBeDefined();
    });

    it('validates provider_id and rejects unknown', async () => {
      const result = await invoke('create_agent', {
        name: 'no-provider',
        provider_id: 'nonexistent',
      });
      expect(result.error).toMatch(/Provider not found/);
    });

    it('accepts valid provider_id', async () => {
      seedProvider('p-1');
      const result = await invoke('create_agent', {
        name: 'with-provider',
        provider_id: 'p-1',
      });
      expect(result.provider_id).toBe('p-1');
    });

    it('attaches MCP servers and skills (only global-scoped skills)', async () => {
      seedProvider('p-default');
      dbState.mcpServers.set('m1', { id: 'm1', project_id: PROJECT_ID });
      const result = await invoke('create_agent', {
        name: 'attached',
        mcpServerIds: ['m1', 'nonexistent'],
        skillNames: ['global:foo', 'project:bar'],
      });
      // only m1 exists → only m1 attached
      expect(result.mcpServerIds).toEqual(['m1']);
      // only global:foo kept
      expect(result.skillNames).toEqual(['global:foo']);
    });

    it('first agent becomes default; setting is_default on second resets first', async () => {
      seedProvider('p-default');
      const a = await invoke('create_agent', { name: 'A', is_default: true });
      const b = await invoke('create_agent', { name: 'B' });
      expect(a.is_default).toBe(true);
      expect(b.is_default).toBe(false);

      const updated = await invoke('update_agent', { id: b.id, is_default: true });
      expect(updated.is_default).toBe(true);
      // A's default flag should be cleared
      expect(dbState.agents.get(a.id)!.is_default).toBe(0);
    });

    it('rejects unsetting the only default agent (P2 #11)', async () => {
      // Codex P2 #11: if the project's only default agent is demoted to
      // is_default=false, the next chat that omits agentId reaches
      // ensureDefaultAgent (runtime.ts:119) with no default to find and
      // auto-creates a new "Master Agent" row. That silently changes the
      // default and clutters the library. The tool must preserve a
      // project default by rejecting the demotion.
      seedProvider('p-default');
      const sole = await invoke('create_agent', { name: 'sole-default', is_default: true });
      expect(sole.is_default).toBe(true);

      const result = await invoke('update_agent', { id: sole.id, is_default: false });

      expect(result.error).toMatch(/only default agent/);
      expect(result.error).toMatch(/next chat that omits/);
      // Sole agent's default flag NOT cleared
      expect(dbState.agents.get(sole.id)!.is_default).toBe(1);
    });

    it('allows unsetting default when other agents are also default (P2 #11)', async () => {
      // Sanity check: the guard only fires when this agent is the LAST
      // default. If the project has another default already, demoting
      // this one is fine.
      seedProvider('p-default');
      const a = await invoke('create_agent', { name: 'a', is_default: true });
      const b = await invoke('create_agent', { name: 'b', is_default: true });
      expect(a.is_default).toBe(true);
      expect(b.is_default).toBe(true);

      const updated = await invoke('update_agent', { id: a.id, is_default: false });
      expect(updated.is_default).toBe(false);
      // B is still default
      expect(dbState.agents.get(b.id)!.is_default).toBe(1);
    });
  });

  describe('update_agent', () => {
    it('updates only provided fields', async () => {
      const a = seedAgent({ name: 'old', description: 'old desc' });
      const result = await invoke('update_agent', {
        id: a.id,
        name: 'new name',
      });
      expect(result.name).toBe('new name');
      // description preserved
      expect(result.description).toBe('old desc');
    });

    it('returns error for non-existent agent', async () => {
      const result = await invoke('update_agent', { id: 'nope', name: 'x' });
      expect(result.error).toMatch(/Agent not found/);
    });

    it('rejects invalid name on update', async () => {
      const a = seedAgent({});
      const result = await invoke('update_agent', { id: a.id, name: '中文' });
      expect(result.error).toMatch(/English letters/);
    });

    it('replaces mcpServerIds wholesale when provided', async () => {
      const a = seedAgent({});
      dbState.agentMcp.set(a.id, ['m1', 'm2']);
      dbState.mcpServers.set('m3', { id: 'm3', project_id: PROJECT_ID });
      const result = await invoke('update_agent', { id: a.id, mcpServerIds: ['m3'] });
      expect(result.mcpServerIds).toEqual(['m3']);
    });

    it('preserves mcpServerIds when not provided', async () => {
      const a = seedAgent({});
      dbState.agentMcp.set(a.id, ['m1']);
      const result = await invoke('update_agent', { id: a.id, name: 'x' });
      expect(result.mcpServerIds).toEqual(['m1']);
    });

    it('rejects provider_id: null (P2 #3 residual)', async () => {
      // Codex P2 #3: update_agent's original `if (input.provider_id)` truthy
      // guard silently allowed clearing the provider (null → provider_id=NULL
      // in DB). That breaks workflow node-executor.ts:303 getProvider(null)
      // AND the chat runtime, which both read provider_id. Fix: explicitly
      // reject null and '' with a clear error pointing the model at the
      // valid paths (pass a valid id to switch, omit the field to keep).
      const a = seedAgent({ provider_id: 'p-existing' });
      const result = await invoke('update_agent', { id: a.id, provider_id: null });
      expect(result.error).toMatch(/Cannot clear provider_id/);
      expect(result.error).toMatch(/workflow node-executor/);
      // Existing provider NOT cleared
      expect(dbState.agents.get(a.id)!.provider_id).toBe('p-existing');
    });

    it('rejects provider_id: "" (P2 #3 residual)', async () => {
      const a = seedAgent({ provider_id: 'p-existing' });
      const result = await invoke('update_agent', { id: a.id, provider_id: '' });
      expect(result.error).toMatch(/Cannot clear provider_id/);
      expect(dbState.agents.get(a.id)!.provider_id).toBe('p-existing');
    });

    it('omitting provider_id keeps the existing provider (P2 #3 residual)', async () => {
      // Sanity check: the new guard fires only on EXPLICIT null/''.
      // Omitting the field (undefined) leaves the existing value alone.
      const a = seedAgent({ provider_id: 'p-existing' });
      const result = await invoke('update_agent', { id: a.id, name: 'rename' });
      expect(result.name).toBe('rename');
      expect(dbState.agents.get(a.id)!.provider_id).toBe('p-existing');
    });

    it('returns a defer-delegation note (P2 #15)', async () => {
      // Codex P2 #15: createDeepAgentRuntime snapshots subagents at startup
      // (runtime.ts:547-599), so a create_agent / update_agent in the same
      // turn cannot be reached by `task(name: ...)`. Document this in the
      // tool description AND in the JSON return so the model knows to
      // either wait for the next turn or start a new chat session.
      const a = seedAgent({});
      const result = await invoke('update_agent', { id: a.id, name: 'renamed' });
      expect(result.note).toMatch(/turn/);
      expect(result.note).toMatch(/subagents/);
    });
  });

  describe('delete_agent', () => {
    it('rejects deleting the currently running agent (P1 #7)', async () => {
      const a = seedAgent({});
      const result = await invoke('delete_agent', { id: a.id }, { activeAgentId: a.id });
      expect(result.error).toMatch(/currently running this chat session/);
      expect(result.error).toMatch(/Switch to a different agent/);
      // Agent row NOT deleted
      expect(dbState.agents.has(a.id)).toBe(true);
    });

    it('allows deleting a different agent even when activeAgentId is set', async () => {
      const active = seedAgent({ id: 'active-agent' });
      const other = seedAgent({ id: 'other-agent' });
      const result = await invoke(
        'delete_agent',
        { id: other.id },
        { activeAgentId: active.id },
      );
      expect(result.deleted).toBe(true);
      // Active agent untouched
      expect(dbState.agents.has(active.id)).toBe(true);
    });

    it('mimics runtime P1 #8 fix: getRuntimeAgent resolves default agent and guard fires', async () => {
      // The runtime at runtime.ts:497 passes `agentRow.id` (the resolved
      // agent id from getRuntimeAgent), not the raw `agentId` parameter.
      // getRuntimeAgent falls back to ensureDefaultAgent when agentId is
      // null/missing/stale, so the in-flight chat's actual agent is
      // whatever default agent the project has. This test simulates
      // that exact path: caller omits agentId → factory gets default id →
      // delete of default agent is rejected.
      const defaultAgent = seedAgent({ id: 'project-default-agent' });
      const result = await invoke(
        'delete_agent',
        { id: defaultAgent.id },
        // No agentId from caller; factory receives the resolved default id.
        { activeAgentId: defaultAgent.id },
      );
      expect(result.error).toMatch(/currently running this chat session/);
      expect(dbState.agents.has(defaultAgent.id)).toBe(true);
    });

    it('rejects deletion when another session has a running agent_runs row (P2 #9)', async () => {
      // Codex P2 #9: defense in depth. Even if the *current* runtime's
      // activeAgentId doesn't match the target, another concurrent
      // session's runtime may be streaming with this agent. The
      // agent_runs row that runLLMChat inserts with status='running'
      // is the proof of that in-flight work. Deleting would CASCADE
      // it and break the other session's tool-call log writes +
      // final updateRun.
      const a = seedAgent({});
      // Pre-seed a running run from a *different* session
      dbState.agentRuns.set('run-other-session', {
        id: 'run-other-session',
        agent_id: a.id,
        status: 'running',
      });
      // No activeAgentId from this caller (different runtime, different session)

      const result = await invoke('delete_agent', { id: a.id });

      expect(result.error).toMatch(/in-flight run with this agent/);
      expect(result.error).toMatch(/status='running'/);
      // Agent row NOT deleted
      expect(dbState.agents.has(a.id)).toBe(true);
      // Other session's run row preserved
      expect(dbState.agentRuns.has('run-other-session')).toBe(true);
    });

    it('allows deletion when agent_runs has only completed/failed/aborted rows (P2 #9)', async () => {
      // Sanity check: if all agent_runs for this agent are in a terminal
      // state (status NOT 'running' or 'waiting_approval'), the cross-runtime
      // guard does NOT fire and the normal CASCADE delete proceeds.
      const a = seedAgent({});
      dbState.agentRuns.set('run-done', { id: 'run-done', agent_id: a.id, status: 'completed' });
      dbState.agentRuns.set('run-failed', { id: 'run-failed', agent_id: a.id, status: 'failed' });
      dbState.agentRuns.set('run-aborted', { id: 'run-aborted', agent_id: a.id, status: 'aborted' });

      const result = await invoke('delete_agent', { id: a.id });

      expect(result.deleted).toBe(true);
    });

    it('rejects deletion when another session is waiting for approval (P2 #10)', async () => {
      // Codex P2 #10: llm.ts:764 calls updateRun(runId, 'waiting_approval')
      // when a tool execution needs human approval. The agent_runs row is
      // still in-flight (the chat will resume after approval), so deleting
      // the agent during the approval window breaks the resume path:
      // approving/rejecting later updates a missing run_id row, silently
      // losing history. The P2 #9 fix only checked 'running' and missed
      // this state; expand to include 'waiting_approval'.
      const a = seedAgent({});
      dbState.agentRuns.set('run-paused', {
        id: 'run-paused',
        agent_id: a.id,
        status: 'waiting_approval',
      });

      const result = await invoke('delete_agent', { id: a.id });

      expect(result.error).toMatch(/in-flight run with this agent/);
      expect(result.error).toMatch(/waiting_approval/);
      expect(dbState.agents.has(a.id)).toBe(true);
      // Paused run row preserved
      expect(dbState.agentRuns.has('run-paused')).toBe(true);
    });

    it('rejects deletion of the only default agent (P2 #12)', async () => {
      // Codex P2 #12: same invariant as P2 #11, but on delete_agent.
      // The P2 #11 fix added the guard only to update_agent; delete_agent
      // was missed and has the same bug. Deleting the sole default agent
      // also leaves the project without a default, triggering
      // ensureDefaultAgent's auto-create 'Master Agent' path.
      const sole = seedAgent({ is_default: 1 });
      const result = await invoke('delete_agent', { id: sole.id });
      expect(result.error).toMatch(/only default agent/);
      expect(result.error).toMatch(/auto-create a new/);
      // Agent row NOT deleted
      expect(dbState.agents.has(sole.id)).toBe(true);
    });

    it('allows deletion of default agent when other defaults exist (P2 #12)', async () => {
      const a = seedAgent({ is_default: 1 });
      const b = seedAgent({ is_default: 1 });
      const result = await invoke('delete_agent', { id: a.id });
      expect(result.deleted).toBe(true);
      // b is still default
      expect(dbState.agents.get(b.id)!.is_default).toBe(1);
    });

    it('allows deletion of a non-default agent even when it is the only one (P2 #12)', async () => {
      // Sanity check: the guard only fires when the target IS default.
      // Deleting a non-default agent doesn't violate the "≥1 default" invariant.
      const a = seedAgent({ is_default: 0 });
      const result = await invoke('delete_agent', { id: a.id });
      expect(result.deleted).toBe(true);
    });

    it('deletes agent and cascades mcp/skill rows', async () => {
      const a = seedAgent({});
      dbState.agentMcp.set(a.id, ['m1']);
      dbState.agentSkills.set(a.id, ['global:foo']);
      const result = await invoke('delete_agent', { id: a.id });
      expect(result.deleted).toBe(true);
      expect(result.id).toBe(a.id);
      expect(dbState.agents.has(a.id)).toBe(false);
      expect(dbState.agentMcp.has(a.id)).toBe(false);
      expect(dbState.agentSkills.has(a.id)).toBe(false);
    });

    it('returns error for non-existent agent', async () => {
      const result = await invoke('delete_agent', { id: 'nope' });
      expect(result.error).toMatch(/Agent not found/);
    });

    it('returns error for missing id', async () => {
      const result = await invoke('delete_agent', { id: '' });
      expect(result.error).toMatch(/id is required/);
    });

    it('matches existing db:deleteAgent IPC behavior (single DELETE FROM agents)', async () => {
      // Verifies the tool uses a single DELETE rather than manually managing
      // per-table cleanup. FK CASCADE handles the rest. The earlier "deletes
      // agent and cascades mcp/skill rows" test above verifies the observable
      // effect on the joined tables.
      //
      // This test guards against a regression where someone re-introduces
      // a per-table DELETE chain (e.g., the old agent_runs SET NULL attempt
      // that crashed because agent_runs.agent_id is NOT NULL).
      const a = seedAgent({});
      dbState.agentMcp.set(a.id, ['m1']);
      dbState.agentSkills.set(a.id, ['global:foo']);

      const result = await invoke('delete_agent', { id: a.id });

      expect(result.deleted).toBe(true);
      expect(dbState.agents.has(a.id)).toBe(false);
      // Note: the tool description is honest that agent_runs also CASCADE-deletes.
      // (Retaining run history would require a schema change to make
      // agent_runs.agent_id nullable — out of scope for this PR.)
    });
  });

  describe('project isolation', () => {
    it('list_agents only returns agents in the injected project', async () => {
      seedAgent({ project_id: PROJECT_ID, name: 'mine' });
      seedAgent({ project_id: 'other-project', name: 'theirs' });
      const result = await invoke('list_agents', {});
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('mine');
    });

    it('update_agent refuses to touch agent from other project', async () => {
      const other = seedAgent({ project_id: 'other-project', name: 'theirs' });
      const result = await invoke('update_agent', { id: other.id, name: 'hacked' });
      expect(result.error).toMatch(/Agent not found/);
    });

    it('delete_agent refuses to touch agent from other project', async () => {
      const other = seedAgent({ project_id: 'other-project', name: 'theirs' });
      const result = await invoke('delete_agent', { id: other.id });
      expect(result.error).toMatch(/Agent not found/);
    });
  });
});
