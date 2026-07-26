import {
  deletePhysicalSkill,
  getBuiltInSkillDirs,
  getBuiltInSkillRegistrations,
  getScopePath,
  importPhysicalSkillDirectory,
  listGlobalSkillViews,
  listPhysicalSkills,
  listResolvedSkillViews,
  resolveAgentSkillsConfig,
  resolveConversationSkillSnapshotConfig,
  savePhysicalSkill,
} from './skill-manager';
import {
  getSkillDisplayName,
  getSkillSourceLabel,
  isGlobalSkillSourceKind,
  resolveSkillCatalog,
  resolveSkillSourcePlan,
  type ResolvedSkillCatalog,
  type ResolvedSkillCatalogEntry,
  type SkillCatalogOptions,
  type SkillSourceEntry,
} from './skills-runtime/skill-sources';
import {
  buildCdfSkillsRuntime,
  type CdfSkillsRuntime,
  type CdfSkillsRuntimeOptions,
} from './skills-runtime/cdf-skills-runtime';
import type {
  ConversationSkillSnapshotEntry,
  GlobalSkillSourceKind,
} from '../../shared/skills';

/**
 * Skill Catalog——"存在哪些 Skill、对谁可见"的唯一回答者。
 *
 * 深模块入口：discovery（source plan）、resolution（目录解析 + 遮蔽 +
 * Scene 曝光过滤）、Conversation Skill Snapshot 捕获、Settings 视图、
 * 物理 Skill CRUD 与运行时 prompt 视图统一从这里出。skill-manager 与
 * skills-runtime/* 是实现文件，skill 家族之外的消费方不应再直接导入它们。
 *
 * Scene Skill Exposure 策略保持在曝光策略模块（ADR-0069），以
 * `isGlobalSkillExposed` 谓词注入；Project Skill 永远不经过该谓词。
 */

export {
  deletePhysicalSkill,
  getBuiltInSkillRegistrations,
  importPhysicalSkillDirectory,
  listGlobalSkillViews,
  listPhysicalSkills,
  listResolvedSkillViews,
  resolveAgentSkillsConfig,
  resolveConversationSkillSnapshotConfig,
  savePhysicalSkill,
};
export { getSkillDisplayName, getSkillSourceLabel, isGlobalSkillSourceKind };
export type {
  CdfSkillsRuntime,
  CdfSkillsRuntimeOptions,
  ResolvedSkillCatalog,
  ResolvedSkillCatalogEntry,
  SkillCatalogOptions,
};

export type GlobalSkillExposurePredicate = (
  skill: { sourceKind: GlobalSkillSourceKind; name: string }
) => boolean;

export interface ResolveProjectSkillCatalogOptions extends SkillCatalogOptions {
  /** Scene 曝光策略谓词，只作用于 Global（built-in / user）来源。 */
  isGlobalSkillExposed?: GlobalSkillExposurePredicate;
}

function composeIncludeSkill(
  isGlobalSkillExposed: GlobalSkillExposurePredicate | undefined,
  includeSkill: SkillCatalogOptions['includeSkill'],
): SkillCatalogOptions['includeSkill'] {
  if (!isGlobalSkillExposed) return includeSkill;
  return (source: SkillSourceEntry, skillName: string) => {
    if (includeSkill && !includeSkill(source, skillName)) return false;
    return !isGlobalSkillSourceKind(source.kind)
      || isGlobalSkillExposed({ sourceKind: source.kind, name: skillName });
  };
}

/**
 * 项目 Skill 目录的规范解析：Built-in 目录与用户 Global 目录默认铺入
 * source plan，消费方不再自行拼装 plan → catalog 两步。
 */
export function resolveProjectSkillCatalog(
  projectPath: string,
  options: ResolveProjectSkillCatalogOptions = {}
): ResolvedSkillCatalog {
  const { isGlobalSkillExposed, includeSkill, ...catalogOptions } = options;
  const plan = resolveSkillSourcePlan(projectPath, {
    builtInSkillDirs: getBuiltInSkillDirs(),
    userSkillsDir: getScopePath(projectPath, 'global'),
    includeNestedProjectSkills: options.includeNestedProjectSkills,
  });
  return resolveSkillCatalog(plan, {
    ...catalogOptions,
    includeSkill: composeIncludeSkill(isGlobalSkillExposed, includeSkill),
  });
}

function toConversationSkillSnapshotEntry(
  skill: ResolvedSkillCatalogEntry
): ConversationSkillSnapshotEntry {
  return {
    name: skill.name,
    qualifiedName: skill.qualifiedName,
    qualifier: skill.qualifier,
    description: skill.description,
    argumentHint: skill.argumentHint,
    allowedTools: skill.allowedTools,
    whenToUse: skill.whenToUse,
    arguments: skill.arguments,
    sourceKind: skill.sourceKind,
    sourcePath: skill.sourcePath,
    skillPath: skill.skillPath,
    modelDiscovery: skill.modelDiscovery,
    userInvocable: skill.userInvocable,
  };
}

/**
 * 捕获 Conversation Skill Snapshot：Conversation 创建时冻结的 Skill 身份与
 * 发现元数据集合。持久化（sessions 表读写）由快照持久化模块负责。
 */
export function captureConversationSkillSnapshot(input: {
  projectPath: string;
  isGlobalSkillExposed: GlobalSkillExposurePredicate;
}): ConversationSkillSnapshotEntry[] {
  const catalog = resolveProjectSkillCatalog(input.projectPath, {
    includeNestedProjectSkills: true,
    isGlobalSkillExposed: input.isGlobalSkillExposed,
  });
  return catalog.skills.map(toConversationSkillSnapshotEntry);
}

/**
 * 运行时 Skill 视图（已解析集合 + prompt + attributions），Built-in 与用户
 * Global 目录默认铺入；传入 `catalog`（冻结快照）时不做磁盘发现。
 */
export function buildProjectSkillsRuntime(
  projectPath: string,
  options: CdfSkillsRuntimeOptions = {}
): CdfSkillsRuntime {
  return buildCdfSkillsRuntime(projectPath, {
    builtInSkillDirs: getBuiltInSkillDirs(),
    userSkillsDir: getScopePath(projectPath, 'global'),
    ...options,
  });
}
