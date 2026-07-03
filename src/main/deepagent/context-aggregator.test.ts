// 08.2 P4 Task 1: context-aggregator 11-category extension test
// Per Issue 1 (CONTEXT.md §C2-01): 7 of 11 categories are real, 4 are
// v1.1 placeholders (systemPrompt / systemTools / customAgents / memoryFiles).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { aggregateCurrentSessionContext, BUILTIN_TOOL_CHARS } from './context-aggregator';

// Mock the database + mcp-connector so we don't need a real
// SQLite DB / MCP servers. Each test composes its own row set / behavior.
//
const {
  getScopePathMock,
  getBuiltInSkillDirsMock,
  resolveAgentSkillConfigOptionsMock,
  storeGetMock,
} = vi.hoisted(() => {
  const path = require('path');
  const os = require('os');
  return {
    getScopePathMock: vi.fn((_p: string, scope: string) =>
      scope === 'global'
        ? path.join(os.tmpdir(), 'cdf-ctx-agg-empty-global-skills')
        : path.join(_p, '.cdf', 'skills')
    ),
    getBuiltInSkillDirsMock: vi.fn((): string[] => []),
    resolveAgentSkillConfigOptionsMock: vi.fn((): any => ({ options: undefined, warnings: [] })),
    storeGetMock: vi.fn(() => ({})),
  };
});

vi.mock('../database', () => ({
  default: {
    prepare: vi.fn(),
  },
}));

vi.mock('./skill-manager', () => ({
  getScopePath: getScopePathMock,
  getBuiltInSkillDirs: getBuiltInSkillDirsMock,
  resolveAgentSkillConfigOptions: resolveAgentSkillConfigOptionsMock,
}));

vi.mock('./mcp-connector', () => ({
  loadMcpTools: vi.fn(async () => ({ client: null, tools: [] })),
}));

vi.mock('../store', () => ({
  default: {
    get: storeGetMock,
  },
}));

import db from '../database';
import { loadMcpTools } from './mcp-connector';

const tempProjectPath = path.join(
  os.tmpdir(),
  `cdf-ctx-agg-test-${Math.random().toString(36).slice(2)}`
);

interface FakeQueryPlan {
  // sessionId → rows (object[] for .all(), or a single object for .get())
  sessionRows?: Record<string, unknown[]>;
  // sessionId → single row
  sessionSingle?: Record<string, Record<string, unknown> | undefined>;
  // default row for any key not in sessionRows / sessionSingle
  defaultRows?: Record<string, unknown>[];
  defaultSingle?: Record<string, unknown>;
  // 08.2 polish: dedicated row for the provider lookup
  // (SELECT ... FROM agents a JOIN sessions s JOIN llm_providers p).
  // Used when the test wants to control modelName / system_prompt
  // independently of the project lookup row.
  agentRow?: Record<string, unknown>;
  agentSkillRows?: Array<{ skill_name: string }>;
  // 08.2 polish: dedicated row for the project lookup
  // (SELECT p.name, p.path FROM projects p JOIN sessions s). Used for
  // sizing systemPrompt via buildProjectContext.
  projectsRow?: Record<string, unknown>;
}

function installFakeDb(plan: FakeQueryPlan): void {
  // Each .prepare(sql) returns a prepared statement whose .get()/.all() reads
  // are routed by the SQL string. We only need to discriminate the few
  // distinct SELECT patterns the aggregator uses.
  (db.prepare as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
    // Provider lookup (08.2 P4 NEW): SELECT ... FROM agents a JOIN sessions s JOIN llm_providers p
    // Must come FIRST because the agent-only SQL also contains "FROM agents a JOIN sessions s".
    //
    // Note: the actual SQL starts with `FROM agents a` (not `JOIN agents a`).
    // The `JOIN llm_providers` token is the discriminator between this query
    // and the agent-only lookup below.
    if (/FROM agents a/.test(sql) && /JOIN llm_providers/.test(sql)) {
      return {
        get: (sessionId: string) => {
          if (plan.agentRow !== undefined) return plan.agentRow;
          if (plan.sessionSingle && sessionId in plan.sessionSingle) {
            return plan.sessionSingle[sessionId];
          }
          if (plan.defaultSingle !== undefined) return plan.defaultSingle;
          return undefined;
        },
        all: () => [],
      };
    }
    // Project lookup (skills + projectCommandBodies + systemPrompt context):
    // SELECT p.path FROM projects p JOIN sessions s
    if (/FROM projects p/.test(sql) || (/JOIN projects p/.test(sql) && /JOIN sessions s/.test(sql))) {
      return {
        get: (sessionId: string) => {
          if (plan.projectsRow !== undefined) return plan.projectsRow;
          if (plan.sessionSingle && sessionId in plan.sessionSingle) {
            return plan.sessionSingle[sessionId];
          }
          if (plan.defaultSingle !== undefined) return plan.defaultSingle;
          return undefined;
        },
        all: () => [],
      };
    }
    // Agent-only lookup (MCP block): SELECT a.id FROM agents a JOIN sessions s
    if (/FROM agents a/.test(sql) && /JOIN sessions s/.test(sql)) {
      return {
        get: (sessionId: string) => {
          if (plan.sessionSingle && sessionId in plan.sessionSingle) {
            return plan.sessionSingle[sessionId];
          }
          if (plan.defaultSingle !== undefined) return plan.defaultSingle;
          return undefined;
        },
        all: () => [],
      };
    }
    if (/FROM agent_skills/.test(sql)) {
      return {
        get: () => undefined,
        all: () => plan.agentSkillRows ?? [],
      };
    }
    if (/FROM messages/.test(sql)) {
      return {
        get: (sessionId: string) => {
          if (plan.sessionSingle && sessionId in plan.sessionSingle) {
            return plan.sessionSingle[sessionId];
          }
          if (plan.defaultSingle !== undefined) return plan.defaultSingle;
          return { total: 0 };
        },
        all: () => [],
      };
    }
    if (/FROM workflows/.test(sql)) {
      return {
        get: (sessionId: string) => {
          if (plan.sessionSingle && sessionId in plan.sessionSingle) {
            return plan.sessionSingle[sessionId];
          }
          if (plan.defaultSingle !== undefined) return plan.defaultSingle;
          return { total: 0 };
        },
        all: () => [],
      };
    }
    return {
      get: () => undefined,
      all: () => {
        if (/FROM mcp_servers/.test(sql)) {
          if (plan.defaultRows) return plan.defaultRows;
          return [];
        }
        return [];
      },
    };
  });
}

beforeEach(() => {
  fs.rmSync(tempProjectPath, { recursive: true, force: true });
  fs.mkdirSync(tempProjectPath, { recursive: true });
  vi.clearAllMocks();
  getScopePathMock.mockImplementation((_p: string, scope: string) =>
    scope === 'global'
      ? path.join(os.tmpdir(), 'cdf-ctx-agg-empty-global-skills')
      : path.join(_p, '.cdf', 'skills')
  );
  getBuiltInSkillDirsMock.mockReturnValue([]);
  resolveAgentSkillConfigOptionsMock.mockReturnValue({ options: undefined, warnings: [] });
  storeGetMock.mockReturnValue({});
});

afterEach(() => {
  fs.rmSync(tempProjectPath, { recursive: true, force: true });
});

describe('context-aggregator — 08.2 P4 11-category extension', () => {
  it('returns 11 categories in breakdown (excluding mcpPerTool array)', async () => {
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });

    const result = await aggregateCurrentSessionContext('session-1');
    // 11 scalar fields + 5 array fields (mcpPerTool, skillsPerSkill,
    // workflowsPerWorkflow, systemToolsPerTool, projectCommandsPerFile) = 16.
    // (08.2 polish added 4 per-source breakdowns on top of mcpPerTool.)
    const fields = Object.keys(result.breakdown);
    expect(fields).toContain('conversation');
    expect(fields).toContain('skills');
    expect(fields).toContain('mcp');
    expect(fields).toContain('workflows');
    expect(fields).toContain('systemPrompt');
    expect(fields).toContain('systemTools');
    expect(fields).toContain('customAgents');
    expect(fields).toContain('memoryFiles');
    expect(fields).toContain('messages');
    expect(fields).toContain('projectCommandBodies');
    expect(fields).toContain('freeSpace');
    expect(fields).toContain('autocompactBuffer');
    expect(fields).toContain('mcpPerTool');
    expect(fields).toContain('skillsPerSkill');
    expect(fields).toContain('workflowsPerWorkflow');
    expect(fields).toContain('systemToolsPerTool');
    expect(fields).toContain('projectCommandsPerFile');
    expect(fields).toHaveLength(17);
  });

  it('autocompactBuffer === Math.ceil(contextLimit * 0.15)', async () => {
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });
    const result = await aggregateCurrentSessionContext('session-1', 100_000);
    expect(result.contextLimit).toBe(100_000);
    expect(result.breakdown.autocompactBuffer).toBe(15_000);
  });

  it('skills tokens count only the description field, not the full SKILL.md (LLM-visible cost)', async () => {
    // 08.2 polish: deepagent injects name + description + path for each
    // skill. Reading a 30KB SKILL.md shouldn't cost 7.5k tokens in the
    // breakdown — the LLM only sees the description field at start.
    //
    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', 'big-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const tinyDesc = 'Create things.';
    const bigBody = '\n\n# Big Skill\n' + 'x'.repeat(30_000);
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: big-skill\ndescription: ${tinyDesc}\n---\n${bigBody}\n`,
      'utf-8'
    );
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });
    const result = await aggregateCurrentSessionContext('session-1');
    const bigSkillRow = result.breakdown.skillsPerSkill.find(
      (s) => s.name === 'big-skill'
    );
    expect(bigSkillRow).toBeDefined();
    // The resolved prompt counts visible metadata + read path, not the 30KB body.
    expect(bigSkillRow!.tokens).toBeLessThan(100);
  });

  it('skills tokens do not include packaged scripts or resources in the always-on discovery cost', async () => {
    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', 'resource-heavy-skill');
    fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: resource-heavy-skill',
        'description: Resource-heavy description.',
        '---',
        '',
        '# Resource Heavy Skill',
      ].join('\n'),
      'utf-8'
    );
    fs.writeFileSync(path.join(skillDir, 'scripts', 'main.js'), 'x'.repeat(30_000), 'utf-8');
    fs.writeFileSync(path.join(skillDir, 'entrypoints.json'), JSON.stringify({ data: 'y'.repeat(30_000) }), 'utf-8');
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });

    const result = await aggregateCurrentSessionContext('session-1');
    const skillRow = result.breakdown.skillsPerSkill.find(
      (s) => s.name === 'resource-heavy-skill'
    );

    expect(skillRow).toBeDefined();
    expect(skillRow!.tokens).toBeLessThan(100);
  });

  it('skills tokens use the shared Skill metadata description limit', async () => {
    const skillName = 'long-description';
    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        `name: ${skillName}`,
        `description: ${'x'.repeat(1100)}`,
        '---',
        '',
        '# Long Description',
      ].join('\n'),
      'utf-8'
    );
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });

    const result = await aggregateCurrentSessionContext('session-1');
    const skillRow = result.breakdown.skillsPerSkill.find((s) => s.name === skillName);

    expect(skillRow?.tokens).toBeGreaterThan(Math.ceil(1024 * 0.25));
    expect(skillRow?.tokens).toBeLessThan(Math.ceil(1300 * 0.25));
  });

  it('skips malformed Skills through the resolved catalog without breaking accounting', async () => {
    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', 'malformed-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const body = 'no frontmatter here, just body text\n'.repeat(100);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body, 'utf-8');
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });
    const result = await aggregateCurrentSessionContext('session-1');
    const malformedRow = result.breakdown.skillsPerSkill.find(
      (s) => s.name === 'malformed-skill'
    );
    expect(malformedRow).toBeUndefined();
  });

  it('accounts Skill visibility states and preloaded full instructions from the resolved catalog', async () => {
    const writeSkill = (name: string, description: string, body = '') => {
      const skillDir = path.join(tempProjectPath, '.cdf', 'skills', name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n${body}`,
        'utf-8'
      );
    };
    writeSkill('visible-skill', 'Visible description');
    writeSkill('name-skill', 'Hidden name-only description');
    writeSkill('manual-skill', 'Manual description');
    writeSkill('off-skill', 'Off description');
    writeSkill('preloaded-skill', 'Preloaded description', 'P'.repeat(1000));
    fs.mkdirSync(path.join(tempProjectPath, '.cdf'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({
        version: 1,
        overrides: {
          'name-skill': 'name-only',
          'manual-skill': 'user-invocable-only',
          'off-skill': 'off',
        },
        additionalSkillDirectories: [],
      }),
      'utf-8'
    );
    installFakeDb({
      agentRow: { id: 'agent-1', system_prompt: '', provider_id: 'provider-1', model_name: 'test', context_limit: 200_000 },
      projectsRow: { name: 'CDF', path: tempProjectPath },
      agentSkillRows: [{ skill_name: 'project:preloaded-skill' }],
    });

    const result = await aggregateCurrentSessionContext('session-1');
    const byName = new Map(result.breakdown.skillsPerSkill.map((row) => [row.name, row]));

    expect(byName.get('visible-skill')).toMatchObject({ visibility: 'on', preloaded: false });
    expect(byName.get('name-skill')).toMatchObject({ visibility: 'name-only', preloaded: false });
    expect(byName.get('manual-skill')).toBeUndefined();
    expect(byName.get('off-skill')).toBeUndefined();
    expect(byName.get('preloaded-skill')).toMatchObject({ visibility: 'on', preloaded: true });
    expect(byName.get('preloaded-skill')!.tokens).toBeGreaterThan(byName.get('visible-skill')!.tokens);
  });

  it('freeSpace = max(0, contextLimit - total - autocompactBuffer)', async () => {
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });
    // 200_000 limit → 30_000 buffer.
    // total = conversation(0) + skills(0) + mcp(0) + workflows(0) +
    //         projectCommandBodies(0) + systemPrompt(0) + systemTools(BUILTIN_CHARS/4) +
    //         customAgents(0) + memoryFiles(0) + messages(0)
    // 08.2 polish: systemTools is now a real calculation (built-in tool
    // schemas) and counts toward the total, so the expected freeSpace
    // reflects that.
    const result = await aggregateCurrentSessionContext('session-1', 200_000);
    const expectedSystemTools = Math.ceil(BUILTIN_TOOL_CHARS / 4);
    const expectedTotal = expectedSystemTools;
    expect(result.breakdown.freeSpace).toBe(200_000 - expectedTotal - 30_000);
    // Sanity: confirm we actually computed the BUILTIN_TOOL_CHARS total
    expect(result.breakdown.systemTools).toBe(expectedSystemTools);
    expect(result.breakdown.systemToolsPerTool.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(['parse_pdf', 'pdf_parse_status', 'pdf_parse_cancel']),
    );
  });

  it('freeSpace clamps to 0 when total exceeds limit', async () => {
    // session-1 has 1MB of message content → conversation = 250_000 tokens
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });
    (db.prepare as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => ({
      get: () => {
        if (/FROM messages/.test(sql)) {
          return { total: 1_000_000 };
        }
        if (/JOIN projects p.*JOIN sessions s/.test(sql)) {
          return { path: tempProjectPath };
        }
        if (/JOIN agents a.*JOIN sessions s/.test(sql)) {
          return { id: 'agent-1' };
        }
        return undefined;
      },
      all: () => [],
    }));
    const result = await aggregateCurrentSessionContext('session-1', 100_000);
    expect(result.breakdown.freeSpace).toBe(0);
  });

  it('usedPct clamps to 100 max', async () => {
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });
    (db.prepare as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => ({
      get: () => {
        if (/FROM messages/.test(sql)) return { total: 10_000_000 };
        if (/JOIN projects p.*JOIN sessions s/.test(sql)) return { path: tempProjectPath };
        if (/JOIN agents a.*JOIN sessions s/.test(sql)) return { id: 'agent-1' };
        return undefined;
      },
      all: () => [],
    }));
    const result = await aggregateCurrentSessionContext('session-1', 100_000);
    expect(result.usedPct).toBe(100);
  });

  it('projectCommandBodies sums all .md files in .cdf/commands (v1.1 real)', async () => {
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });
    // Create 3 .md files in .cdf/commands with known sizes
    const cmdsDir = path.join(tempProjectPath, '.cdf', 'commands');
    fs.mkdirSync(cmdsDir, { recursive: true });
    fs.writeFileSync(path.join(cmdsDir, 'a.md'), 'A'.repeat(100));   // 100 bytes
    fs.writeFileSync(path.join(cmdsDir, 'b.md'), 'B'.repeat(200));   // 200 bytes
    fs.writeFileSync(path.join(cmdsDir, 'c.md'), 'C'.repeat(400));   // 400 bytes
    fs.writeFileSync(path.join(cmdsDir, 'd.txt'), 'should skip');   // ignored
    // Total: 700 bytes → 700 * 0.25 = 175 tokens
    const result = await aggregateCurrentSessionContext('session-1');
    expect(result.breakdown.projectCommandBodies).toBe(Math.ceil(700 * 0.25));
  });

  it('mcpPerTool returns array of { tool, server, tokens } (v1.1 real)', async () => {
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
      defaultRows: [
        { id: 'srv-1', name: 'arxiv', server_type: 'stdio', config: '{}', is_connected: 1 },
      ],
    });
    (loadMcpTools as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      client: null,
      tools: [
        { name: 'mcp__arxiv__search', schema: { description: 'search arxiv', inputSchema: { type: 'object' } } },
        { name: 'mcp__arxiv__summarize', schema: { description: 'summarize', inputSchema: { type: 'object' } } },
      ],
    });
    const result = await aggregateCurrentSessionContext('session-1');
    expect(result.mcpPerTool).toHaveLength(2);
    expect(result.mcpPerTool[0]).toHaveProperty('tool');
    expect(result.mcpPerTool[0]).toHaveProperty('server');
    expect(result.mcpPerTool[0]).toHaveProperty('tokens');
    expect(result.mcpPerTool[0].server).toBe('arxiv');
    // mcp (aggregate) = sum of both tools' token estimates
    expect(result.breakdown.mcp).toBeGreaterThan(0);
  });

  it('category failure isolation: throwing in conversation does NOT break others', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (db.prepare as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => ({
      get: () => {
        if (/FROM messages/.test(sql)) {
          throw new Error('messages table broken');
        }
        if (/JOIN projects p.*JOIN sessions s/.test(sql)) {
          return { path: tempProjectPath };
        }
        if (/JOIN agents a.*JOIN sessions s/.test(sql)) {
          return { id: 'agent-1' };
        }
        return undefined;
      },
      all: () => [],
    }));
    const result = await aggregateCurrentSessionContext('session-1');
    // conversation fell to 0; other categories still compute
    expect(result.breakdown.conversation).toBe(0);
    expect(result.breakdown.workflows).toBe(0); // default, no error
    expect(result.breakdown.projectCommandBodies).toBe(0);
    // But the function still returns a valid aggregate
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('breakdown');
    warnSpy.mockRestore();
  });

  it('systemPrompt + systemTools now report real values (08.2 polish promoted placeholders to real calculations)', async () => {
    // 08.2 polish: systemPrompt now reads agents.system_prompt + the static
    // buildProjectContext template, and systemTools now sums the mirrored built-in
    // tool schemas.
    // Both should be > 0 for a session backed by a real agent row.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFakeDb({
      agentRow: {
        id: 'agent-1',
        system_prompt: '你是该项目的默认 Master Agent，负责综合使用 Skills、MCP 工具和项目上下文帮助用户完成开发任务。',
        provider_id: 'provider-1',
        model_name: 'MiniMax-M3',
        context_limit: 200_000,
      },
      projectsRow: { name: 'CDF', path: tempProjectPath },
    });
    const result = await aggregateCurrentSessionContext('session-1');
    // systemPrompt = safeMath(agent prompt chars + project context template)
    expect(result.breakdown.systemPrompt).toBeGreaterThan(0);
    // systemTools = safeMath(mirrored built-in tool schemas)
    expect(result.breakdown.systemTools).toBeGreaterThan(0);
    // The new SQL column selected default_model; expect the real model name.
    expect(result.modelName).toBe('MiniMax-M3');
    // No console.warn spam for the promoted fields (WR-02 follow-up).
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[0] || ''));
    expect(warnMessages.some((m) => m.includes('systemPrompt 估算未实现'))).toBe(false);
    expect(warnMessages.some((m) => m.includes('systemTools 估算未实现'))).toBe(false);
    warnSpy.mockRestore();
  });

  it('customAgents + memoryFiles still return 0 (v1.1 placeholder, v1.2 推)', async () => {
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });
    const result = await aggregateCurrentSessionContext('session-1');
    expect(result.breakdown.customAgents).toBe(0);
    expect(result.breakdown.memoryFiles).toBe(0);
  });

  it('modelName resolves from llm_providers.default_model (not a.model which does not exist)', async () => {
    // Regression: agents table has no `model` column. Previously the query
    // selected `a.model` which silently returned undefined → modelName=''
    // → modal rendered "(未知)". The 08.2 polish query selects
    // `p.default_model AS model_name` instead.
    installFakeDb({
      agentRow: {
        id: 'agent-1',
        system_prompt: '...',
        provider_id: 'provider-1',
        model_name: 'deepseek-v4-flash',
        context_limit: 200_000,
      },
    });
    const result = await aggregateCurrentSessionContext('session-1');
    expect(result.modelName).toBe('deepseek-v4-flash');
  });

  it('modelName falls back to "" (modal shows "未知") when no active provider joined', async () => {
    // Defensive: if the JOIN to llm_providers on is_active=1 yields no row,
    // modelName should be empty (not throw). The current renderer maps '' to
    // "(未知)" via the ContextModal fallback copy.
    installFakeDb({
      agentRow: undefined,
      defaultSingle: undefined,
    });
    const result = await aggregateCurrentSessionContext('session-1');
    expect(result.modelName).toBe('');
  });

  it('mcp failure does NOT break other categories (per-category try-catch)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFakeDb({
      defaultSingle: { path: tempProjectPath, id: 'agent-1' },
    });
    (loadMcpTools as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('MCP connector crashed')
    );
    const result = await aggregateCurrentSessionContext('session-1');
    expect(result.breakdown.mcp).toBe(0);
    expect(result.mcpPerTool).toEqual([]);
    // Other categories still compute
    expect(result.breakdown.workflows).toBe(0);
    expect(result.breakdown.projectCommandBodies).toBe(0);
    expect(result.breakdown.freeSpace).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });

  it('overriddenModelName overrides model_name from agent row', async () => {
    installFakeDb({
      agentRow: {
        id: 'agent-1',
        system_prompt: 'some-prompt',
        provider_id: 'provider-1',
        context_limit: 200_000,
        model_name: 'database-model-name',
        provider_name: 'provider-1',
      },
    });
    const result = await aggregateCurrentSessionContext('session-1', undefined, 'my-overridden-model');
    expect(result.modelName).toBe('my-overridden-model');
  });
});
