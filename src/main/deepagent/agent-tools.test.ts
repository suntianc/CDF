import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCatalog, CatalogAgent } from '../agent-catalog';

const mocks = vi.hoisted(() => ({
  providers: new Map<string, { id: string; is_active: number; updated_at: number }>(),
  inFlightAgentIds: new Set<string>(),
  catalog: null as unknown as AgentCatalog,
  createAgentCatalog: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../database', () => ({
  default: {
    prepare: vi.fn((sql: string) => ({
      get: (id?: string) => {
        if (sql === 'SELECT id FROM llm_providers WHERE id = ?') return id ? mocks.providers.get(id) : undefined;
        if (sql === 'SELECT id FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1') {
          return [...mocks.providers.values()]
            .filter((provider) => provider.is_active === 1)
            .sort((a, b) => b.updated_at - a.updated_at)[0];
        }
        if (sql === 'SELECT id FROM llm_providers ORDER BY updated_at DESC LIMIT 1') {
          return [...mocks.providers.values()].sort((a, b) => b.updated_at - a.updated_at)[0];
        }
        if (sql.includes('FROM agent_runs')) return id && mocks.inFlightAgentIds.has(id) ? { id: 'run-1' } : undefined;
        return undefined;
      },
      all: () => [],
      run: () => ({ changes: 1 }),
    })),
    transaction: mocks.transaction,
  },
}));

vi.mock('../agent-catalog', () => ({
  createAgentCatalog: mocks.createAgentCatalog,
}));

import { createAgentTools } from './agent-tools';

function agent(overrides: Partial<CatalogAgent> = {}): CatalogAgent {
  return {
    id: 'custom-1',
    role: 'custom',
    name: 'Reviewer',
    slug: 'reviewer',
    description: null,
    provider_id: 'provider-1',
    system_prompt: null,
    config: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function catalog(overrides: Partial<AgentCatalog> = {}): AgentCatalog {
  return {
    list: vi.fn(),
    get: vi.fn(),
    resolveMaster: vi.fn(),
    listDelegationTargets: vi.fn(),
    createCustom: vi.fn(),
    updateGeneralPurpose: vi.fn(),
    updateCustom: vi.fn(),
    deleteCustom: vi.fn(),
    getMasterPrompt: vi.fn(),
    getSceneDefaultPrompt: vi.fn(),
    saveMasterPrompts: vi.fn(),
    saveMasterPrompt: vi.fn(),
    resetMasterPrompt: vi.fn(),
    ...overrides,
  } as AgentCatalog;
}

function findTool(name: string, options: { activeAgentId?: string | null } = {}) {
  const result = createAgentTools('project-is-ignored', options).find((candidate) => candidate.name === name);
  if (!result) throw new Error(`Tool not found: ${name}`);
  return result;
}

async function invoke(name: string, input: unknown, options: { activeAgentId?: string | null } = {}) {
  const tool = findTool(name, options) as { invoke(input: unknown): Promise<string> };
  return JSON.parse(await tool.invoke(input));
}

describe('createAgentTools', () => {
  beforeEach(() => {
    mocks.providers.clear();
    mocks.inFlightAgentIds.clear();
    mocks.transaction.mockImplementation((callback: () => unknown) => callback);
    mocks.catalog = catalog();
    mocks.createAgentCatalog.mockReset().mockReturnValue(mocks.catalog);
  });

  it('lists the global Catalog delegation targets and retains their delegation keys', async () => {
    const generalPurpose = agent({ id: 'system-general-purpose-agent', role: 'general-purpose', name: 'General-purpose', slug: 'general-purpose' });
    const custom = agent();
    vi.mocked(mocks.catalog.listDelegationTargets).mockReturnValue([generalPurpose, custom]);

    const result = await invoke('list_agents', {});

    expect(result).toMatchObject([
      { id: generalPurpose.id, role: 'general-purpose', effective_slug: 'general-purpose' },
      { id: custom.id, role: 'custom', effective_slug: 'reviewer' },
    ]);
    expect(mocks.createAgentCatalog).toHaveBeenCalledWith(expect.anything(), { initializeSchema: false });
  });

  it('creates only through the Catalog and prefers the newest active provider', async () => {
    mocks.providers.set('inactive-new', { id: 'inactive-new', is_active: 0, updated_at: 30 });
    mocks.providers.set('active-old', { id: 'active-old', is_active: 1, updated_at: 10 });
    mocks.providers.set('active-new', { id: 'active-new', is_active: 1, updated_at: 20 });
    vi.mocked(mocks.catalog.createCustom).mockReturnValue(agent({ provider_id: 'active-new' }));

    const result = await invoke('create_agent', { name: 'Reviewer' });

    expect(result.provider_id).toBe('active-new');
    expect(mocks.catalog.createCustom).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Reviewer',
      provider_id: 'active-new',
    }));
    expect(mocks.transaction).toHaveBeenCalled();
  });

  it('falls back to the most recently updated provider when none is active', async () => {
    mocks.providers.set('old', { id: 'old', is_active: 0, updated_at: 1 });
    mocks.providers.set('recent', { id: 'recent', is_active: 0, updated_at: 2 });
    vi.mocked(mocks.catalog.createCustom).mockReturnValue(agent({ provider_id: 'recent' }));

    await invoke('create_agent', { name: 'Reviewer' });

    expect(mocks.catalog.createCustom).toHaveBeenCalledWith(expect.objectContaining({ provider_id: 'recent' }));
  });

  it('returns actionable errors for missing or unknown create providers without writing a Catalog Agent', async () => {
    expect((await invoke('create_agent', { name: 'Reviewer' })).error).toMatch(/No LLM provider is configured/);
    expect((await invoke('create_agent', { name: 'Reviewer', provider_id: 'missing' })).error).toBe('Provider not found: missing');
    expect(mocks.catalog.createCustom).not.toHaveBeenCalled();
  });

  it('surfaces Catalog identity conflicts instead of generating a suffixed delegation key', async () => {
    mocks.providers.set('provider-1', { id: 'provider-1', is_active: 1, updated_at: 1 });
    vi.mocked(mocks.catalog.createCustom).mockImplementation(() => {
      throw new Error('Agent delegation key conflicts with an existing Agent');
    });

    const result = await invoke('create_agent', { name: 'Reviewer' });

    expect(result.error).toBe('Agent delegation key conflicts with an existing Agent');
  });

  it('rejects system Agents before update and only passes Custom updates through the Catalog', async () => {
    vi.mocked(mocks.catalog.get)
      .mockReturnValueOnce(agent({ id: 'system-master-agent', role: 'master', name: 'Master Agent' }))
      .mockReturnValueOnce(agent({ id: 'system-general-purpose-agent', role: 'general-purpose', name: 'General-purpose' }))
      .mockReturnValueOnce(agent());
    vi.mocked(mocks.catalog.updateCustom).mockReturnValue(agent({ name: 'Renamed' }));

    expect((await invoke('update_agent', { id: 'system-master-agent', name: 'Changed' })).error).toMatch(/protected/);
    expect((await invoke('update_agent', { id: 'system-general-purpose-agent', name: 'Changed' })).error).toMatch(/protected/);
    const updated = await invoke('update_agent', { id: 'custom-1', name: 'Renamed' });

    expect(updated.name).toBe('Renamed');
    expect(mocks.catalog.updateGeneralPurpose).not.toHaveBeenCalled();
    expect(mocks.catalog.updateCustom).toHaveBeenCalledWith('custom-1', expect.objectContaining({ name: 'Renamed' }));
  });

  it('keeps an omitted update provider, but rejects clearing or replacing it with an unknown provider', async () => {
    vi.mocked(mocks.catalog.get).mockReturnValue(agent());
    vi.mocked(mocks.catalog.updateCustom).mockReturnValue(agent({ name: 'Renamed' }));

    await invoke('update_agent', { id: 'custom-1', name: 'Renamed' });
    expect(mocks.catalog.updateCustom).toHaveBeenCalledTimes(1);
    expect((await invoke('update_agent', { id: 'custom-1', provider_id: null })).error).toMatch(/Cannot clear provider_id/);
    expect((await invoke('update_agent', { id: 'custom-1', provider_id: 'missing' })).error).toBe('Provider not found: missing');
    expect(mocks.catalog.updateCustom).toHaveBeenCalledTimes(1);
  });

  it('blocks deletion of the active or in-flight Custom Agent before calling the Catalog', async () => {
    vi.mocked(mocks.catalog.get).mockReturnValue(agent());

    expect((await invoke('delete_agent', { id: 'custom-1' }, { activeAgentId: 'custom-1' })).error).toMatch(/currently running/);
    mocks.inFlightAgentIds.add('custom-1');
    expect((await invoke('delete_agent', { id: 'custom-1' })).error).toMatch(/in-flight run/);
    expect(mocks.catalog.deleteCustom).not.toHaveBeenCalled();
  });

  it('requires a delete id and delegates permitted deletion to the Catalog', async () => {
    vi.mocked(mocks.catalog.get).mockReturnValue(agent());

    expect((await invoke('delete_agent', { id: '' })).error).toBe('Agent id is required.');
    const result = await invoke('delete_agent', { id: 'custom-1' });

    expect(result).toEqual({ deleted: true, id: 'custom-1', name: 'Reviewer' });
    expect(mocks.catalog.deleteCustom).toHaveBeenCalledWith('custom-1');
  });
});
