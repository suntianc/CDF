/**
 * runtime-assembly.ts — Chat 路径与 Workflow/parallel 路径的运行时装配统一模块
 *
 * Issue #108: 抽取统一模块消除 runtime.ts / parallel-task-tool.ts 的重复代码。
 * 提供：Provider 模型配置解析、Skill 流水线装配、系统提示词构造、路径提取工具。
 */

import { registerHarnessProfile, type FilesystemPermission } from 'deepagents';
import {
  getProvider,
  normalizeProviderId,
  type ProviderRow,
} from './shared-infra';
import { createLangChainModel, type RuntimeProviderModelConfig } from './llm-adapter';
import { prepareAISubscriptionRuntimeModel } from '../ai-subscription-runtime';
import {
  getBuiltInSkillDirs,
  getScopePath,
  resolveConversationSkillSnapshotConfig,
} from './skill-manager';
import { buildCdfSkillsRuntime } from './skills-runtime/cdf-skills-runtime';
import { skillReferencesToPreloadNames } from '../../shared/skill-identifiers';
import type { ChatRuntimeOverrides, ProjectScene } from '../../shared/types';
import { createGlobalSkillSceneExposureFilter } from '../global-skill-scene-exposure';
import type { ConversationSkillSnapshotEntry } from '../../shared/skills';
import type { ResolvedSkillCatalogEntry } from './skills-runtime/skill-sources';

// =============================================================================
// Provider 模型配置解析
// =============================================================================

/**
 * 根据 Agent 行与运行时覆盖参数解析 RuntimeProviderModelConfig。
 * ai_subscription 走订阅路由，否则用普通 Provider。
 */
export async function resolveRuntimeProviderModelConfig(
  agentRow: { provider_id?: string | null },
  overrides?: ChatRuntimeOverrides,
  fallbackProviderId?: string | null,
): Promise<{ config: RuntimeProviderModelConfig; fallbackProvider: ProviderRow }> {
  if (overrides?.modelSource === 'ai_subscription') {
    return {
      config: await prepareAISubscriptionRuntimeModel(
        overrides.sourceId || overrides.providerId,
        overrides.model,
        undefined,
        overrides.reasoningEffort,
      ),
      fallbackProvider: getProvider(normalizeProviderId(agentRow.provider_id) || fallbackProviderId),
    };
  }

  const provider = getProvider(
    normalizeProviderId(overrides?.sourceId || overrides?.providerId)
      || normalizeProviderId(agentRow.provider_id)
      || fallbackProviderId,
  );
  const modelName = overrides?.model || provider.default_model;
  return {
    config: {
      apiKey: provider.api_key ?? undefined,
      apiUrl: provider.api_url ?? undefined,
      defaultModel: provider.default_model,
      providerType: provider.provider_type as RuntimeProviderModelConfig['providerType'],
      model: modelName,
      contextLimit: provider.context_limit ?? undefined,
    },
    fallbackProvider: provider,
  };
}

// =============================================================================
// Harness 模板注册
// =============================================================================

/**
 * 注册 DeepAgents harness 模板。
 * 当 overrides.modelSource === 'ai_subscription' 时跳过注册。
 */
export function registerCdfHarnessProfile(
  providerType: string,
  modelName: string,
  overrides?: ChatRuntimeOverrides,
): void {
  // 订阅路由模型不注册 harness 模板（由 deepagents 自行发现）
  if (overrides?.modelSource === 'ai_subscription') return;

  const profile = {
    generalPurposeSubagent: { enabled: false },
    excludedTools: [] as string[],
  };

  const registerSafely = (key: string | null | undefined) => {
    const trimmed = key?.trim();
    if (!trimmed || trimmed.split(':').length > 2) return;
    try {
      registerHarnessProfile(trimmed, profile);
    } catch (error) {
      console.warn(`Failed to register DeepAgents harness profile for "${trimmed}":`, error);
    }
  };

  registerSafely(modelName);

  // deepagents resolveHarnessProfile uses getModelProvider(model instance):
  // ChatAnthropic → "anthropic", ChatOpenAI → "openai". Several CDF provider
  // types construct ChatAnthropic (minimax, deepseek, zhipu, …). Registering
  // only openai:* leaves GP subagent enabled for those models, which then
  // shares the master model instance and dies as TypeError: terminated.
  const usesChatAnthropic =
    providerType === 'anthropic'
    || providerType === 'minimax'
    || providerType === 'minimax-overseas'
    || providerType === 'deepseek'
    || providerType === 'zhipu'
    || providerType === 'glm-overseas';

  if (usesChatAnthropic) {
    registerSafely('anthropic');
    if (modelName && !modelName.includes(':')) registerSafely(`anthropic:${modelName}`);
    return;
  }

  if (providerType !== 'ollama') {
    registerSafely('openai');
    if (modelName && !modelName.includes(':')) registerSafely(`openai:${modelName}`);
  }
}

// =============================================================================
// Skill 名称预加载
// =============================================================================

/**
 * 将 Skill 引用 ID（如 'project:docs:review'）转换为预加载名（'docs:review'）。
 */
export function getPreloadSkillNames(skillIds: string[]): string[] {
  return skillReferencesToPreloadNames(skillIds);
}

// =============================================================================
// 路径提取（提及上下文）
// =============================================================================

/**
 * 从字符串值中提取 `@路径` 形式的路径提及上下文。
 *
 * 以 node-executor.ts 版为规范：
 * - 正则 `@([^\s"'`<>]+)` 严格边界，不截入反引号
 * - 尾部剥除 `]` / `}` / 英文/中文闭括号与引号
 * - 处理多值参数，每个值独立 JSON.stringify 再匹配
 *
 * 例如：
 * - `@src/foo.ts`        → `['src/foo.ts']`
 * - `@apps/web/src/App.tsx` → `['apps/web/src/App.tsx']`
 * - `` @src/main/llm.ts `` → `['src/main/llm.ts']`（反引号不污染）
 */
export function extractPathMentionContext(...values: unknown[]): string[] {
  const seen = new Set<string>();

  for (const value of values) {
    let content: string;
    if (typeof value === 'string') {
      content = value;
    } else if (value === null || value === undefined) {
      continue;
    } else {
      try {
        content = JSON.stringify(value);
      } catch {
        continue;
      }
    }

    for (const match of content.matchAll(/@([^\s"'`<>]+)/g)) {
      const normalized = match[1]
        .trim()
        .replace(/[\]),.;:，。；：）}"']+$/g, '')
        .replace(/\\/g, '/')
        .replace(/^\.\//g, '')
        .replace(/^\/+/g, '');
      if (normalized) seen.add(normalized);
    }
  }

  return Array.from(seen);
}

// =============================================================================
// 提示词拼接
// =============================================================================

/**
 * 将运行时生成的提示词片段拼接到 base prompt 之后，用空行分隔。
 */
export function appendRuntimePrompt(basePrompt: string, runtimePrompt: string): string {
  const trimmedRuntimePrompt = runtimePrompt.trim();
  if (!trimmedRuntimePrompt) return basePrompt;
  return `${basePrompt}\n\n${trimmedRuntimePrompt}`;
}

// =============================================================================
// 项目上下文提示词
// =============================================================================

/**
 * 构造项目上下文字段，插入系统提示词。
 */
export function buildProjectContext(project: { name: string; path: string }): string {
  return `\n\n[项目上下文]\n当前选中项目名称: ${project.name}\n项目根目录: ${project.path}\n所有文件工具（ls、read_file、write_file、edit_file、glob、grep、delete_file）请使用绝对路径，例如 \`${project.path}/src/main.ts\`。\nbash 工具也使用绝对路径，当前工作目录为项目根目录。\n\n## Skills 创建规范\n- 创建项目级 Skill 时，请写入 \`${project.path}/.cdf/skills/{skill名称}/SKILL.md\`（项目级 skills 对该项目所有 Agent 自动可见）\n- SKILL.md 格式：以 \`---\` 开头的前置元数据，包含 \`name\` 和 \`description\` 字段，随后是 Markdown 正文\n- 全局 Skill 写入 \`~/.cdf/skills/{skill名称}/SKILL.md\`（对所有项目默认可见）\n- Agent 选择 Skill 只表示预加载或强调，不表示访问授权\n当你需要查看、确认、搜索或继续分析项目时，必须在当前轮次继续调用合适的文件工具；不要只回复"我先看看/我再确认/继续搜索"就结束。`;
}

// =============================================================================
// CDF 媒体能力工具提示词
// =============================================================================

/**
 * deepagents base prompt only documents filesystem tools. Models often claim
 * those are the only tools. Explicitly list CDF media tools so bindTools
 * and the system prompt stay consistent.
 */
export function buildCdfCapabilityToolsPrompt(toolNames: string[]): string {
  const lines: string[] = [
    '## CDF media capability tools',
    'In addition to filesystem tools, you have these CDF tools (use them by name when needed):',
  ];
  const catalog: Record<string, string> = {
    generate_image:
      'Text-to-image or image-to-image via MiniMax Token Plan or Codex OAuth. After success, display with ![alt](path).',
    synthesize_speech:
      'Text-to-speech (Speech 2.8 only: speech-2.8-hd / speech-2.8-turbo). Link audio as [label](path).',
    generate_music:
      'Generate songs (music-2.6 only). Needs lyrics unless instrumental/lyrics_optimizer. Link as [title](path).',
  };
  let any = false;
  for (const [name, desc] of Object.entries(catalog)) {
    if (!toolNames.includes(name)) continue;
    any = true;
    lines.push(`- \`${name}\`: ${desc}`);
  }
  if (!any) return '';
  lines.push(
    'These tools require a connected subscription route with the matching capability enabled.',
  );
  return lines.join('\n');
}

// =============================================================================
// 全装配：Skill 流水线（Scene Skill Set / Conversation Skill Snapshot → preload）
// =============================================================================

interface CdfSkillsAssemblyResult {
  permissions: FilesystemPermission[];
  skillsRuntime: ReturnType<typeof buildCdfSkillsRuntime>;
  warnings: string[];
}

/**
 * Skill 全装配流水线：解析 Scene Skill Set 或 Conversation Skill Snapshot，并构造 Skills Runtime。
 *
 * @param projectPath - 项目根目录
 * @param skillNames - Agent 的 Skill 引用 ID 列表（调用方自行获取 getAgentSkillNames）
 * @param config - Agent 行 config 字段（JSON 或 null/undefined）
 * @param pathContext - 路径提及上下文（调用方自行提取）
 * @returns 权限、skillsRuntime、拼接警告
 */
export function buildCdfSkillsRuntimeAssembly(
  projectPath: string,
  skillNames: string[],
  config: string | null | undefined,
  pathContext: string[],
  sceneId: ProjectScene = 'general',
  skillSnapshot?: readonly ConversationSkillSnapshotEntry[] | null,
): CdfSkillsAssemblyResult {
  // Legacy agent config remains readable by old rows, but no longer affects
  // visibility. Only Scene Skill Set (or the immutable Conversation snapshot)
  // can determine which Skills are available for preload or discovery.
  void config;
  const skillsRuntime = buildCdfSkillsRuntime(projectPath, {
    builtInSkillDirs: getBuiltInSkillDirs(),
    userSkillsDir: getScopePath(projectPath, 'global'),
    preloadSkillNames: getPreloadSkillNames(skillNames),
    pathContext,
    sceneId,
    isGlobalSkillExposed: createGlobalSkillSceneExposureFilter(sceneId),
    includeNestedProjectSkills: true,
    catalog: skillSnapshot ? skillSnapshot.map((skill) => ({ ...skill })) as ResolvedSkillCatalogEntry[] : undefined,
  });
  const { permissions } = resolveConversationSkillSnapshotConfig(
    projectPath,
    skillSnapshot ?? skillsRuntime.skills,
  );

  return { permissions, skillsRuntime, warnings: skillsRuntime.warnings };
}
// =============================================================================
// 统一 DeepAgent 运行时装配：provider/model/Harness → Skills → 系统提示词
// =============================================================================

export interface DeepAgentAssemblyResult {
  model: ReturnType<typeof createLangChainModel>;
  provider: ProviderRow;
  permissions: FilesystemPermission[];
  systemPrompt: string;
  skillsRuntime: ReturnType<typeof buildCdfSkillsRuntime>;
  assemblyWarnings: string[];
}

/**
 * 统一 DeepAgent 运行时装配，适用于 main Agent、delegated subagent、parallel worker
 * 三条路径。涵盖：
 *  - Provider 模型解析（含 contextLimit）
 *  - Harness 模板注册
 *  - LangChain 模型创建
 *  - Skills 全装配（预加载 → 覆盖 → buildCdfSkillsRuntime）
 *  - 系统提示词拼接（Agent system_prompt + 项目上下文 + Skills prompt + 媒体能力 prompt）
 *
 * @param agentRow - Agent 数据库行（需要 id、provider_id、system_prompt、config）
 * @param fallbackProviderId - 当 agentRow.provider_id 无值时回落至的 provider ID
 * @param project - 项目 { name, path }
 * @param skillNames - Agent 的 Skill 引用 ID 列表
 * @param pathContext - 路径提及上下文
 * @param capabilityToolNames - 内建工具名列表（用于 buildCdfCapabilityToolsPrompt）
 */
export async function assembleDeepAgentRuntime(
  agentRow: {
    id: string;
    provider_id?: string | null;
    system_prompt?: string | null;
    config?: string | null;
  },
  fallbackProviderId: string | null | undefined,
  project: { name: string; path: string; scene?: ProjectScene },
  skillNames: string[],
  pathContext: string[],
  capabilityToolNames: string[],
  overrides?: ChatRuntimeOverrides,
  skillSnapshot?: readonly ConversationSkillSnapshotEntry[] | null,
): Promise<DeepAgentAssemblyResult> {
  const { config: modelConfig, fallbackProvider: provider } =
    await resolveRuntimeProviderModelConfig(agentRow, overrides, fallbackProviderId);
  registerCdfHarnessProfile(
    modelConfig.providerType,
    modelConfig.model || modelConfig.defaultModel,
    overrides,
  );
  const model = createLangChainModel(modelConfig);

  const { permissions, skillsRuntime, warnings: assemblyWarnings } = buildCdfSkillsRuntimeAssembly(
    project.path,
    skillNames,
    agentRow.config,
    pathContext,
    project.scene ?? 'general',
    skillSnapshot,
  );

  const systemPrompt = appendRuntimePrompt(
    appendRuntimePrompt(
      (agentRow.system_prompt || '') + buildProjectContext(project),
      skillsRuntime.prompt,
    ),
    buildCdfCapabilityToolsPrompt(capabilityToolNames),
  );

  return { model, provider, permissions, systemPrompt, skillsRuntime, assemblyWarnings };
}
