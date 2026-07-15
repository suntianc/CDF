import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';

// Mock dependencies before importing
const {
  registerHarnessProfileMock,
  storeGetMock,
  buildCdfSkillsRuntimeMock,
  getProviderMock,
  normalizeProviderIdMock,
  createLangChainModelMock,
} = vi.hoisted(() => ({
  registerHarnessProfileMock: vi.fn(),
  storeGetMock: vi.fn(),
  buildCdfSkillsRuntimeMock: vi.fn((..._args: unknown[]): { skills: unknown[]; prompt: string; warnings: string[]; attributions?: unknown[] } => ({
    skills: [],
    prompt: '## Skills System\n\nCDF-owned skills prompt',
    warnings: [],
  })),
  getProviderMock: vi.fn((): {
    id: string;
    provider_type: string;
    api_key: string | null;
    api_url: string | null;
    default_model: string;
    context_limit: number | null;
  } => ({
    id: 'provider-1',
    provider_type: 'ollama',
    api_key: null,
    api_url: null,
    default_model: 'llama3',
    context_limit: null,
  })),
  normalizeProviderIdMock: vi.fn((v: string | null | undefined) => v ?? null),
  createLangChainModelMock: vi.fn((config: object) => ({ ...config, mockModel: true })),
}))


vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/cdf-test-user-data'),
  },
  net: {
    request: vi.fn(),
  },
}));

vi.mock('deepagents', () => ({
  registerHarnessProfile: registerHarnessProfileMock,
}));

vi.mock('../store', () => ({
  default: {
    get: storeGetMock,
  },
}));

vi.mock('./skills-runtime/cdf-skills-runtime', () => ({
  buildCdfSkillsRuntime: buildCdfSkillsRuntimeMock,
}));

vi.mock('../database', () => ({
  default: {
    prepare: vi.fn(),
  },
}));

vi.mock('../security', () => ({
  decryptApiKey: vi.fn((val: string) => val),
}));

vi.mock('../ai-subscription-runtime', () => ({
  prepareAISubscriptionRuntimeModel: vi.fn(),
}));

vi.mock('./mcp-connector', () => ({
  loadMcpTools: vi.fn(async () => ({ client: null, tools: [] })),
}));


vi.mock('./shared-infra', () => ({
  getProvider: getProviderMock,
  normalizeProviderId: normalizeProviderIdMock,
}));

vi.mock('./llm-adapter', () => ({
  createLangChainModel: createLangChainModelMock,
}));



import {
  assembleDeepAgentRuntime,
  extractPathMentionContext,
  appendRuntimePrompt,
  buildProjectContext,
  buildCdfCapabilityToolsPrompt,
  getPreloadSkillNames,
  registerCdfHarnessProfile,
  buildCdfSkillsRuntimeAssembly,
  type DeepAgentAssemblyResult,
} from './runtime-assembly';
import { skillReferencesToPreloadNames } from '../../shared/skill-identifiers';

// =============================================================================
// resolveRuntimeProviderModelConfig — tested via runtime.test.ts integration
// (avoid DB-requiring unit tests; the function is covered by runtime.test.ts)
// =============================================================================

describe('extractPathMentionContext', () => {
  it('extracts simple path mentions', () => {
    expect(extractPathMentionContext('deploy @apps/web/src/App.tsx')).toEqual([
      'apps/web/src/App.tsx',
    ]);
  });

  it('extracts multiple path mentions from a single string', () => {
    const result = extractPathMentionContext('fix @src/foo.ts and @src/bar.ts');
    expect(result).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('handles backtick-wrapped paths without polluting — the core regression test', () => {
    const result = extractPathMentionContext('see `@src/main/llm.ts` for details');
    // Backtick is in the regex exclusion set, so path should be clean
    expect(result).toEqual(['src/main/llm.ts']);
    expect(result).not.toContain('src/main/llm.ts`');
    expect(result).not.toContain('`src/main/llm.ts');
  });

  it('handles angle-bracket wrapped paths', () => {
    const result = extractPathMentionContext('<@src/main/llm.ts>');
    expect(result).toEqual(['src/main/llm.ts']);
  });

  it('handles single-quote wrapped paths', () => {
    const result = extractPathMentionContext("'@src/main/llm.ts'");
    expect(result).toEqual(['src/main/llm.ts']);
  });

  it('handles double-quote wrapped paths', () => {
    const result = extractPathMentionContext('"@src/main/llm.ts"');
    expect(result).toEqual(['src/main/llm.ts']);
  });

  it('strips trailing brackets and braces', () => {
    const result = extractPathMentionContext('@src/main/llm.ts] and @lib/utils.ts}');
    expect(result).toEqual(['src/main/llm.ts', 'lib/utils.ts']);
  });

  it('strips trailing Chinese punctuation when it ends the word', () => {
    // 逗号/分号后无空格时仍被捕获，但尾部只留 punct
    const result = extractPathMentionContext('看看 @src/main/llm.ts，然后 @lib/utils.ts；');
    // ， then 然后 is not whitespace so it stays in the match; only ； at word-end is stripped
    expect(result).toEqual(['src/main/llm.ts，然后', 'lib/utils.ts']);
  });

  it('strips trailing Chinese punctuation at end of string', () => {
    const result = extractPathMentionContext('看看 @src/main/llm.ts，');
    expect(result).toEqual(['src/main/llm.ts']);
  });

  it('strips trailing Chinese period', () => {
    const result = extractPathMentionContext('看看 @src/main/llm.ts。');
    expect(result).toEqual(['src/main/llm.ts']);
  });

  it('handles multi-value arguments', () => {
    const result = extractPathMentionContext(
      'deploy @apps/web',
      JSON.stringify({ task: 'fix @core/lib' }),
    );
    expect(result).toContain('apps/web');
    expect(result).toContain('core/lib');
  });

  it('deduplicates identical paths', () => {
    const result = extractPathMentionContext('@src/foo.ts and @src/foo.ts');
    expect(result).toEqual(['src/foo.ts']);
  });

  it('normalizes backslashes to forward slashes', () => {
    const result = extractPathMentionContext('@src\\foo\\bar.ts');
    expect(result).toEqual(['src/foo/bar.ts']);
  });

  it('removes leading ./', () => {
    const result = extractPathMentionContext('@./src/foo.ts');
    expect(result).toEqual(['src/foo.ts']);
  });

  it('normalizes leading slashes', () => {
    const result = extractPathMentionContext('@//src/foo.ts');
    expect(result).toEqual(['src/foo.ts']);
  });

  it('handles null and undefined without throwing', () => {
    expect(extractPathMentionContext(null, undefined)).toEqual([]);
  });

  it('handles empty strings', () => {
    expect(extractPathMentionContext('')).toEqual([]);
  });

  it('extracts path from JSON-stringified object values', () => {
    const result = extractPathMentionContext(
      JSON.stringify({ path: '@apps/web/src/App.tsx' }),
    );
    expect(result).toEqual(['apps/web/src/App.tsx']);
  });
});

// =============================================================================
// appendRuntimePrompt
// =============================================================================

describe('appendRuntimePrompt', () => {
  it('appends runtime prompt with separator', () => {
    expect(appendRuntimePrompt('base', 'extra')).toBe('base\n\nextra');
  });

  it('returns base prompt when runtime prompt is empty', () => {
    expect(appendRuntimePrompt('base', '')).toBe('base');
  });

  it('trims runtime prompt', () => {
    expect(appendRuntimePrompt('base', '  extra  ')).toBe('base\n\nextra');
  });
});

// =============================================================================
// buildProjectContext
// =============================================================================

describe('buildProjectContext', () => {
  it('includes project name and path', () => {
    const result = buildProjectContext({ name: 'MyProject', path: '/home/user/project' });
    expect(result).toContain('MyProject');
    expect(result).toContain('/home/user/project');
    expect(result).toContain('所有文件工具');
  });

  it('mentions absolute path convention', () => {
    const result = buildProjectContext({ name: 'Test', path: '/tmp/test' });
    expect(result).toContain('`/tmp/test/src/main.ts`');
  });
});

// =============================================================================
// buildCdfCapabilityToolsPrompt
// =============================================================================

describe('buildCdfCapabilityToolsPrompt', () => {
  it('returns empty when no CDF tools in list', () => {
    expect(buildCdfCapabilityToolsPrompt(['bash', 'read_file'])).toBe('');
  });

  it('describes generate_image when present', () => {
    const result = buildCdfCapabilityToolsPrompt(['generate_image']);
    expect(result).toContain('Text-to-image or image-to-image');
    expect(result).toContain('generate_image');
  });

  it('describes synthesize_speech when present', () => {
    const result = buildCdfCapabilityToolsPrompt(['synthesize_speech']);
    expect(result).toContain('Text-to-speech');
  });

  it('describes generate_music when present', () => {
    const result = buildCdfCapabilityToolsPrompt(['generate_music']);
    expect(result).toContain('Generate songs');
  });

  it('describes all when all present', () => {
    const result = buildCdfCapabilityToolsPrompt([
      'generate_image',
      'synthesize_speech',
      'generate_music',
    ]);
    expect(result).toContain('Text-to-image');
    expect(result).toContain('Text-to-speech');
    expect(result).toContain('Generate songs');
  });
});

// =============================================================================
// getPreloadSkillNames
// =============================================================================

describe('getPreloadSkillNames', () => {
  it('delegates to skillReferencesToPreloadNames', () => {
    const result = getPreloadSkillNames(['project:test-skill']);
    expect(result).toEqual(['test-skill']);
  });

  it('returns empty for empty input', () => {
    expect(getPreloadSkillNames([])).toEqual([]);
  });
});

// =============================================================================
// registerCdfHarnessProfile
// =============================================================================

describe('registerCdfHarnessProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers model name and provider type for non-special providers', () => {
    registerCdfHarnessProfile('openai', 'gpt-4');
    expect(registerHarnessProfileMock).toHaveBeenCalledWith('gpt-4', expect.any(Object));
    expect(registerHarnessProfileMock).toHaveBeenCalledWith('openai', expect.any(Object));
    expect(registerHarnessProfileMock).toHaveBeenCalledWith('openai:gpt-4', expect.any(Object));
  });

  it('handles ollama provider (no openai/anthropic registration)', () => {
    registerCdfHarnessProfile('ollama', 'llama3');
    expect(registerHarnessProfileMock).toHaveBeenCalledTimes(1);
    expect(registerHarnessProfileMock).toHaveBeenCalledWith('llama3', expect.any(Object));
  });

  it('handles anthropic with specific model', () => {
    registerCdfHarnessProfile('anthropic', 'claude-3-5-sonnet-20241022');
    expect(registerHarnessProfileMock).toHaveBeenCalledWith(
      'claude-3-5-sonnet-20241022',
      expect.any(Object),
    );
    expect(registerHarnessProfileMock).toHaveBeenCalledWith('anthropic', expect.any(Object));
    expect(registerHarnessProfileMock).toHaveBeenCalledWith(
      'anthropic:claude-3-5-sonnet-20241022',
      expect.any(Object),
    );
  });

  // ChatAnthropic-backed providers (minimax/deepseek/zhipu/…) resolve harness profiles via
  // getModelProvider(model) === "anthropic". If we only register openai:* keys, the GP
  // subagent stays enabled, shares the master model instance, and concurrent task() calls
  // surface as TypeError: terminated → UI "UNKNOWN terminated".
  it('registers anthropic keys for MiniMax so general-purpose stays disabled', () => {
    registerCdfHarnessProfile('minimax', 'MiniMax-M3');
    expect(registerHarnessProfileMock).toHaveBeenCalledWith(
      'MiniMax-M3',
      expect.objectContaining({ generalPurposeSubagent: { enabled: false } }),
    );
    expect(registerHarnessProfileMock).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({ generalPurposeSubagent: { enabled: false } }),
    );
    expect(registerHarnessProfileMock).toHaveBeenCalledWith(
      'anthropic:MiniMax-M3',
      expect.objectContaining({ generalPurposeSubagent: { enabled: false } }),
    );
  });

  it('registers anthropic keys for other ChatAnthropic-backed providers', () => {
    for (const providerType of ['minimax-overseas', 'deepseek', 'zhipu', 'glm-overseas'] as const) {
      registerHarnessProfileMock.mockClear();
      registerCdfHarnessProfile(providerType, 'some-model');
      expect(registerHarnessProfileMock).toHaveBeenCalledWith('anthropic', expect.any(Object));
      expect(registerHarnessProfileMock).toHaveBeenCalledWith(
        'anthropic:some-model',
        expect.any(Object),
      );
    }
  });

  it('skips registration when overrides.modelSource is ai_subscription', () => {
    registerCdfHarnessProfile('openai', 'gpt-4', { modelSource: 'ai_subscription' } as any);
    expect(registerHarnessProfileMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// buildCdfSkillsRuntimeAssembly
// =============================================================================

describe('buildCdfSkillsRuntimeAssembly', () => {
  const projectPath = path.join(os.tmpdir(), 'cdf-assembly-test');

  beforeEach(() => {
    vi.clearAllMocks();
    storeGetMock.mockReturnValue({});
    buildCdfSkillsRuntimeMock.mockReturnValue({
      skills: [],
      prompt: '## Skills System\n\nCDF-owned skills prompt',
      warnings: [],
    });
  });

  it('returns permissions and skillsRuntime', () => {
    const result = buildCdfSkillsRuntimeAssembly(projectPath, ['project:test-skill'], null, [
      'apps/web/src/App.tsx',
    ]);
    expect(result.permissions).toBeDefined();
    expect(result.skillsRuntime).toBeDefined();
    expect(result.skillsRuntime.prompt).toContain('Skills System');
    expect(buildCdfSkillsRuntimeMock).toHaveBeenCalledWith(
      projectPath,
      expect.objectContaining({
        preloadSkillNames: ['test-skill'],
        pathContext: ['apps/web/src/App.tsx'],
      }),
    );
  });

  it('passes the current Project Scene and persisted Global exposure filter into the catalog', () => {
    storeGetMock.mockImplementation((key: string) => key === 'sceneSkillExposures'
      ? { 'built-in:paper-search': { general: false, research: true } }
      : {});

    buildCdfSkillsRuntimeAssembly(projectPath, [], null, [], 'research');

    const options = buildCdfSkillsRuntimeMock.mock.calls.at(-1)?.[1] as unknown as {
      sceneId: string;
      isGlobalSkillExposed: (skill: { sourceKind: 'built-in' | 'user'; name: string }) => boolean;
    };
    expect(options.sceneId).toBe('research');
    expect(options.isGlobalSkillExposed({ sourceKind: 'built-in', name: 'paper-search' })).toBe(true);
    expect(options.isGlobalSkillExposed({ sourceKind: 'user', name: 'personal-review' })).toBe(true);

    buildCdfSkillsRuntimeAssembly(projectPath, [], null, [], 'general');
    const generalOptions = buildCdfSkillsRuntimeMock.mock.calls.at(-1)?.[1] as unknown as typeof options;
    expect(generalOptions.isGlobalSkillExposed({ sourceKind: 'built-in', name: 'paper-search' })).toBe(false);
  });

  it('includes warnings from both config resolution and skills runtime', () => {
    buildCdfSkillsRuntimeMock.mockReturnValueOnce({
      skills: [],
      prompt: '',
      warnings: ['Skill not found: missing-skill'],
    });
    const result = buildCdfSkillsRuntimeAssembly(
      projectPath,
      ['project:missing-skill'],
      null,
      [],
    );
    expect(result.warnings).toContain('Skill not found: missing-skill');
  });

});

// =============================================================================
// assembleDeepAgentRuntime
// =============================================================================

describe('assembleDeepAgentRuntime', () => {
  const project = { name: 'TestProject', path: '/tmp/test-project' };
  const agentRow = {
    id: 'agent-1',
    provider_id: 'provider-1',
    system_prompt: 'You are a test agent.',
    config: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    buildCdfSkillsRuntimeMock.mockReturnValue({
      skills: [],
      prompt: '## Skills System\n\nCDF-owned skills prompt',
      warnings: [],
    });
  });

  it('resolves provider model config with contextLimit and creates model', async () => {
    const result = await assembleDeepAgentRuntime(
      agentRow,
      null,
      project,
      ['project:test-skill'],
      [],
      ['generate_image'],
    );

    expect(getProviderMock).toHaveBeenCalledWith('provider-1');
    expect(createLangChainModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'ollama',
        defaultModel: 'llama3',
        contextLimit: undefined,
      }),
    );
    expect(result.model).toBeDefined();
  });

  it('applies runtime provider and model overrides through the unified assembly', async () => {
    await assembleDeepAgentRuntime(
      agentRow,
      null,
      project,
      ['project:test-skill'],
      [],
      [],
      { providerId: 'override-provider', model: 'override-model' },
    );

    expect(getProviderMock).toHaveBeenCalledWith('override-provider');
    expect(createLangChainModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'override-model' }),
    );
  });

  it('uses fallbackProviderId when agentRow.provider_id is null', async () => {
    await assembleDeepAgentRuntime(
      { ...agentRow, provider_id: null },
      'fallback-provider',
      project,
      ['project:test-skill'],
      [],
      [],
    );

    expect(getProviderMock).toHaveBeenCalledWith('fallback-provider');
  });

  it('registers harness profile for the resolved model', async () => {
    await assembleDeepAgentRuntime(
      agentRow,
      null,
      project,
      ['project:test-skill'],
      [],
      [],
    );

    expect(registerHarnessProfileMock).toHaveBeenCalledWith(
      'llama3',
      expect.objectContaining({
        generalPurposeSubagent: { enabled: false },
        excludedTools: [],
      }),
    );
  });

  it('builds skills assembly with correct skill names and path context', async () => {
    const result = await assembleDeepAgentRuntime(
      agentRow,
      null,
      project,
      ['project:docs:review', 'project:test-skill'],
      ['src/main.ts', 'src/utils.ts'],
      [],
    );

    expect(buildCdfSkillsRuntimeMock).toHaveBeenCalledWith(
      project.path,
      expect.objectContaining({
        preloadSkillNames: expect.arrayContaining(['docs:review', 'test-skill']),
        pathContext: ['src/main.ts', 'src/utils.ts'],
      }),
    );
    expect(result.permissions).toBeDefined();
    expect(result.skillsRuntime).toBeDefined();
  });

  it('constructs full system prompt with project context, skills prompt, and capability tools', async () => {
    const result = await assembleDeepAgentRuntime(
      agentRow,
      null,
      project,
      ['project:test-skill'],
      [],
      ['generate_image'],
    );

    expect(result.systemPrompt).toContain('You are a test agent.');
    expect(result.systemPrompt).toContain('TestProject');
    expect(result.systemPrompt).toContain('/tmp/test-project');
    expect(result.systemPrompt).toContain('CDF-owned skills prompt');
    expect(result.systemPrompt).toContain('Text-to-image or image-to-image');
    expect(result.systemPrompt).toContain('所有文件工具（ls、read_file、write_file、edit_file、glob、grep、delete_file）请使用绝对路径');
  });

  it('excludes capability tools prompt when no CDF tools are in use', async () => {
    const result = await assembleDeepAgentRuntime(
      agentRow,
      null,
      project,
      ['project:test-skill'],
      [],
      ['bash', 'read_file'],
    );

    expect(result.systemPrompt).toContain('You are a test agent.');
    expect(result.systemPrompt).toContain('CDF-owned skills prompt');
    expect(result.systemPrompt).not.toContain('CDF media capability tools');
  });

  it('returns assembly warnings from skills runtime', async () => {
    buildCdfSkillsRuntimeMock.mockReturnValueOnce({
      skills: [],
      prompt: '',
      warnings: ['Skill not found: missing-skill'],
    });

    const result = await assembleDeepAgentRuntime(
      agentRow,
      null,
      project,
      ['project:missing-skill'],
      [],
      [],
    );

    expect(result.assemblyWarnings).toContain('Skill not found: missing-skill');
  });

  it('returns provider info in result', async () => {
    const result = await assembleDeepAgentRuntime(
      agentRow,
      null,
      project,
      ['project:test-skill'],
      [],
      [],
    );

    expect(result.provider).toBeDefined();
    expect(result.provider.id).toBe('provider-1');
  });
});
