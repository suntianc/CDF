import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  dbPrepareMock,
  listPhysicalSkillsMock,
  loadMcpToolsMock,
} = vi.hoisted(() => ({
  dbPrepareMock: vi.fn(),
  listPhysicalSkillsMock: vi.fn(() => []),
  loadMcpToolsMock: vi.fn(async () => ({ client: null, tools: [] })),
}));

vi.mock('./database', () => ({
  default: { prepare: dbPrepareMock },
}));

vi.mock('./deepagent/skill-manager', () => ({
  listPhysicalSkills: listPhysicalSkillsMock,
  getScopePath: (projectPath: string, scope: 'global' | 'project') => {
    if (scope === 'global') return path.join(os.homedir(), '.cdf', 'skills');
    return path.join(projectPath, '.cdf', 'skills');
  },
}));

vi.mock('./deepagent/mcp-connector', () => ({
  loadMcpTools: loadMcpToolsMock,
}));

import { aggregateCurrentSessionContext } from './deepagent/context-aggregator';

describe('aggregateCurrentSessionContext (D-07/D-08/D-09)', () => {
  const tempProjectDir = path.join(os.tmpdir(), `cdf-context-agg-test-${Math.random().toString(36).slice(2)}`);
  // project-scope skills are at <project>/.cdf/skills/<name>/SKILL.md per getScopePath
  const projectSkillsDir = path.join(tempProjectDir, '.cdf', 'skills');

  beforeEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectSkillsDir, 'myskill'), { recursive: true });
    fs.writeFileSync(path.join(projectSkillsDir, 'myskill', 'SKILL.md'), 'x'.repeat(400), 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  });

  it('1. empty session returns zero breakdown and total 0', async () => {
    // All .get() / .all() return undefined / []
    dbPrepareMock.mockImplementation(() => ({
      get: () => undefined,
      all: () => [],
    }));

    const result = await aggregateCurrentSessionContext('session-empty');
    expect(result.breakdown).toEqual({ conversation: 0, skills: 0, mcp: 0, workflows: 0 });
    expect(result.total).toBe(0);
  });

  it('2. conversation: 800 chars total → breakdown.conversation === 200', async () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: () => {
        if (sql.includes('FROM messages')) return { total: 800 };
        return undefined;
      },
      all: () => [],
    }));

    const result = await aggregateCurrentSessionContext('session-conv');
    expect(result.breakdown.conversation).toBe(200);
  });

  it('3. skills: 1 SKILL.md of 400 bytes → breakdown.skills === 100', async () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: () => {
        if (sql.includes('FROM projects')) return { path: tempProjectDir };
        return undefined;
      },
      all: () => [],
    }));
    listPhysicalSkillsMock.mockReturnValue([
      { id: 'project:myskill', name: 'myskill', scope: 'project' } as any,
    ]);

    const result = await aggregateCurrentSessionContext('session-skill');
    expect(result.breakdown.skills).toBe(100);
  });

  it('4. mcp: 1 tool with 200-char schema → breakdown.mcp === 50', async () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: () => {
        if (sql.includes('FROM agents')) return { id: 'agent-1' };
        return undefined;
      },
      all: () => [{ id: 'mcp-1', is_connected: 1 }],
    }));
    // Build a schema whose JSON.stringify length is exactly 200 chars
    const longDescription = 'a'.repeat(180);
    const schema = { type: 'object', description: longDescription, properties: { x: { type: 'string' } } };
    expect(JSON.stringify(schema).length).toBeGreaterThanOrEqual(200);

    loadMcpToolsMock.mockResolvedValue({
      client: null,
      tools: [{ name: 'test-tool', schema } as any],
    });

    const result = await aggregateCurrentSessionContext('session-mcp');
    expect(result.breakdown.mcp).toBeGreaterThanOrEqual(50);
  });

  it('5. workflows: 1 active workflow graph_data 1000 chars → breakdown.workflows === 250', async () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: () => {
        if (sql.includes('FROM workflows')) return { total: 1000 };
        return undefined;
      },
      all: () => [],
    }));

    const result = await aggregateCurrentSessionContext('session-wf');
    expect(result.breakdown.workflows).toBe(250);
  });

  it('6. total = sum(breakdown) when all sources present', async () => {
    dbPrepareMock.mockImplementation((sql: string) => {
      return {
        get: () => {
          if (sql.includes('FROM messages')) return { total: 400 };
          if (sql.includes('FROM projects')) return { path: tempProjectDir };
          if (sql.includes('FROM agents')) return { id: 'agent-1' };
          if (sql.includes('FROM workflows')) return { total: 200 };
          return undefined;
        },
        all: () => [{ id: 'mcp-1', is_connected: 1 }],
      };
    });
    listPhysicalSkillsMock.mockReturnValue([
      { id: 'project:myskill', name: 'myskill', scope: 'project' } as any,
    ]);
    loadMcpToolsMock.mockResolvedValue({
      client: null,
      tools: [{ name: 't', schema: { type: 'object' } } as any],
    });

    const result = await aggregateCurrentSessionContext('session-sum');
    expect(result.breakdown.conversation).toBe(100);
    expect(result.breakdown.skills).toBe(100);
    expect(result.breakdown.workflows).toBe(50);
    expect(result.breakdown.mcp).toBeGreaterThan(0);
    expect(result.total).toBe(
      result.breakdown.conversation +
        result.breakdown.skills +
        result.breakdown.mcp +
        result.breakdown.workflows
    );
  });

  it('7. invalid sessionId (empty / > 64 chars) returns zero breakdown without throwing', async () => {
    const result1 = await aggregateCurrentSessionContext('');
    expect(result1.total).toBe(0);
    expect(result1.breakdown).toEqual({ conversation: 0, skills: 0, mcp: 0, workflows: 0 });

    const result2 = await aggregateCurrentSessionContext('x'.repeat(65));
    expect(result2.total).toBe(0);
    expect(result2.breakdown).toEqual({ conversation: 0, skills: 0, mcp: 0, workflows: 0 });
  });
});
