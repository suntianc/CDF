import { getBuiltInSkillDirs, getScopePath } from '../../deepagent/skill-manager';
import {
  resolveSkillCatalog,
  resolveSkillSourcePlan,
  type SkillCatalogOptions,
  type ResolvedSkillCatalogEntry,
} from '../../deepagent/skills-runtime/skill-sources';
import type { CommandSource, SkillCommandSourceKind, SlashCommand } from '../../../shared/types';

/**
 * Skills collector for Claude Code-style explicit Skill invocation.
 *
 * The command name is the user-invocable Skill name without a leading `/`.
 * Root Skills use the short name; later nested/plugin Skills can supply
 * qualified names while retaining the same attribution fields.
 */
export async function collectSkillCommands(
  projectPath: string,
  options: SkillCatalogOptions = {}
): Promise<SlashCommand[]> {
  const plan = resolveSkillSourcePlan(projectPath, {
    builtInSkillDirs: getBuiltInSkillDirs(),
    userSkillsDir: getScopePath(projectPath, 'global'),
    includeNestedProjectSkills: options.includeNestedProjectSkills,
  });
  const catalog = resolveSkillCatalog(plan, options);

  return catalog.skills
    .filter((skill) => skill.userInvocable)
    .map(skillToCommand);
}

function skillToCommand(skill: ResolvedSkillCatalogEntry): SlashCommand {
  const source = getCommandSource(skill.sourceKind);
  const qualifiedName = skill.qualifiedName ?? skill.name;
  return {
    name: qualifiedName,
    qualifiedName,
    skillName: skill.name,
    skillSourceKind: skill.sourceKind as SkillCommandSourceKind,
    sourcePath: skill.sourcePath,
    skillPath: skill.skillPath,
    skillVisibility: skill.visibility,
    modelDiscovery: skill.modelDiscovery,
    userInvocable: skill.userInvocable,
    description: skill.description,
    source,
    target: `${getTargetScope(skill.sourceKind)}:${qualifiedName}`,
    sourceLabel: getSourceLabel(skill),
    badge: `[${source}]`,
  };
}

function getCommandSource(sourceKind: ResolvedSkillCatalogEntry['sourceKind']): CommandSource {
  switch (sourceKind) {
    case 'project':
    case 'project-nested':
    case 'project-additional':
      return 'skill:project';
    case 'built-in':
    case 'user':
    case 'enterprise':
      return 'skill:global';
  }
}

function getTargetScope(sourceKind: ResolvedSkillCatalogEntry['sourceKind']): string {
  switch (sourceKind) {
    case 'built-in':
      return 'built-in';
    case 'project':
      return 'project';
    case 'project-nested':
      return 'project-nested';
    case 'project-additional':
      return 'project';
    case 'user':
      return 'global';
    case 'enterprise':
      return 'enterprise';
  }
}

function getSourceLabel(skill: ResolvedSkillCatalogEntry): string {
  switch (skill.sourceKind) {
    case 'built-in':
      return 'Built-in Skill';
    case 'project':
      return 'Project Skill';
    case 'project-nested':
      return skill.qualifier ? `Nested Project Skill: ${skill.qualifier}` : 'Nested Project Skill';
    case 'project-additional':
      return skill.qualifier ? `Project Skill: ${skill.qualifier}` : 'Project Skill';
    case 'user':
      return 'Global Skill';
    case 'enterprise':
      return 'Enterprise Skill';
  }
}
