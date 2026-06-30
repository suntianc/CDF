import { describe, expect, it, vi } from 'vitest';

// Mock DB and security before importing shared-infra
const { dbPrepareMock, decryptApiKeyMock } = vi.hoisted(() => ({
  dbPrepareMock: vi.fn(),
  decryptApiKeyMock: vi.fn((value: string) => `decrypted:${value}`),
}));

vi.mock('../database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

vi.mock('../security', () => ({
  decryptApiKey: decryptApiKeyMock,
}));

vi.mock('./file-tools', () => ({
  createDeleteFileTool: vi.fn(() => ({ name: 'delete_file' })),
}));

vi.mock('./bash-tool', () => ({
  createBashTool: vi.fn(() => ({ name: 'bash' })),
}));

vi.mock('./fetch-tool', () => ({
  createFetchTool: vi.fn(() => ({ name: 'fetch' })),
}));

vi.mock('./obscura-tool', () => ({
  createObscuraBrowserTool: vi.fn(() => ({ name: 'obscura_browse' })),
  createObscuraCliRunner: vi.fn(() => ({ browse: vi.fn() })),
}));

vi.mock('./search-tools', () => ({
  createTavilyTool: vi.fn(() => ({ name: 'tavily' })),
  createAnysearchTool: vi.fn(() => ({ name: 'anysearch' })),
}));

vi.mock('./arxiv-tool', () => ({
  createArxivTool: vi.fn(() => ({ name: 'arxiv' })),
}));

vi.mock('./mcp-connector', () => ({
  loadMcpTools: vi.fn(async () => ({ client: null, tools: [] })),
}));

import {
  normalizeProviderId,
  resolveInterruptOn,
  createSpanId,
  createChildSpan,
  DEFAULT_INTERRUPT_ON,
  createBuiltInTools,
} from './shared-infra';

// ===== normalizeProviderId =====

describe('normalizeProviderId', () => {
  it('returns null for null', () => {
    expect(normalizeProviderId(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeProviderId(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeProviderId('')).toBeNull();
  });

  it('returns null for the string "undefined"', () => {
    expect(normalizeProviderId('undefined')).toBeNull();
  });

  it('returns null for the string "null"', () => {
    expect(normalizeProviderId('null')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(normalizeProviderId('  ')).toBeNull();
  });

  it('returns trimmed value for valid id with surrounding spaces', () => {
    expect(normalizeProviderId('  valid-id  ')).toBe('valid-id');
  });

  it('returns value as-is for a clean valid id', () => {
    expect(normalizeProviderId('provider-123')).toBe('provider-123');
  });
});

// ===== resolveInterruptOn =====

describe('resolveInterruptOn', () => {
  it('returns empty object for bypass mode', () => {
    expect(resolveInterruptOn('bypass')).toEqual({});
  });

  it('returns DEFAULT_INTERRUPT_ON for strict mode', () => {
    const result = resolveInterruptOn('strict');
    expect(result).toHaveProperty('write_file');
    expect(result).toHaveProperty('edit_file');
    expect(result).toHaveProperty('delete_file');
    expect(result).toHaveProperty('delete_agent');
    expect(result).toHaveProperty('update_agent');
    expect(result).toHaveProperty('create_agent');
  });

  it('returns DEFAULT_INTERRUPT_ON for agent_decides mode', () => {
    const strict = resolveInterruptOn('strict');
    const agentDecides = resolveInterruptOn('agent_decides');
    expect(agentDecides).toEqual(strict);
  });
});

// ===== DEFAULT_INTERRUPT_ON =====

describe('DEFAULT_INTERRUPT_ON', () => {
  it('contains exactly 6 keys', () => {
    expect(Object.keys(DEFAULT_INTERRUPT_ON)).toHaveLength(6);
  });

  it('has all required tool keys', () => {
    const keys = Object.keys(DEFAULT_INTERRUPT_ON);
    expect(keys).toContain('write_file');
    expect(keys).toContain('edit_file');
    expect(keys).toContain('delete_file');
    expect(keys).toContain('delete_agent');
    expect(keys).toContain('update_agent');
    expect(keys).toContain('create_agent');
  });
});

// ===== createSpanId =====

describe('createSpanId', () => {
  it('returns an 8-character hex string', () => {
    const id = createSpanId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns a unique value on each call', () => {
    const a = createSpanId();
    const b = createSpanId();
    expect(a).not.toBe(b);
  });
});

// ===== createChildSpan =====

describe('createChildSpan', () => {
  it('returns an object with a new spanId and the given parentSpanId', () => {
    const parentId = 'abcd1234';
    const child = createChildSpan(parentId);
    expect(child).toHaveProperty('spanId');
    expect(child).toHaveProperty('parentSpanId', parentId);
    expect(child.spanId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('child spanId is different from parentSpanId', () => {
    const parentId = 'ffffffff';
    const child = createChildSpan(parentId);
    expect(child.spanId).not.toBe(parentId);
  });
});

// ===== createBuiltInTools =====

describe('createBuiltInTools', () => {
  it('returns the built-in Agent Tools', () => {
    const tools = createBuiltInTools('/tmp/workspace');
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.map((tool) => tool.name)).toEqual([
      'delete_file',
      'bash',
      'fetch',
      'obscura_browse',
    ]);
  });
});
