import fs from 'fs';
import { renderCdfSkillsPrompt } from './skill-prompt';
import {
  resolveSkillCatalog,
  resolveSkillSourcePlan,
  type ResolvedSkillCatalogEntry,
  type SkillCatalogOptions,
  type SkillSourcePlanOptions,
} from './skill-sources';
import type { SkillAttribution } from '../../../shared/types';

export interface CdfSkillsRuntimeOptions extends SkillSourcePlanOptions, SkillCatalogOptions {
  preloadSkillNames?: string[];
}

export interface CdfSkillsRuntime {
  skills: ResolvedSkillCatalogEntry[];
  prompt: string;
  warnings: string[];
  attributions: SkillAttribution[];
}

function stripSkillFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---', 4);
  return end === -1
    ? content
    : content.slice(end + '\n---'.length).replace(/^\s+/, '');
}

function getSkillDisplayName(skill: ResolvedSkillCatalogEntry): string {
  return skill.qualifiedName ?? skill.name;
}

function getSkillSourceLabel(skill: ResolvedSkillCatalogEntry): string {
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
      return 'Managed Skill';
  }
}

function isPreloadedSkill(skill: ResolvedSkillCatalogEntry, preloadSkillNames: string[] | undefined): boolean {
  const preloadNames = new Set(preloadSkillNames ?? []);
  const displayName = getSkillDisplayName(skill);
  return preloadNames.has(skill.name) || preloadNames.has(displayName);
}

function skillToAttribution(skill: ResolvedSkillCatalogEntry, phase: SkillAttribution['phase']): SkillAttribution {
  return {
    phase,
    name: skill.name,
    qualifiedName: getSkillDisplayName(skill),
    sourceKind: skill.sourceKind,
    sourceLabel: getSkillSourceLabel(skill),
    skillPath: skill.skillPath,
    visibility: skill.visibility,
    modelDiscovery: skill.modelDiscovery,
    userInvocable: skill.userInvocable,
  };
}

function buildSkillAttributions(
  skills: ResolvedSkillCatalogEntry[],
  preloadSkillNames: string[] | undefined
): SkillAttribution[] {
  const attributions: SkillAttribution[] = [];
  for (const skill of skills) {
    if (skill.modelDiscovery !== 'hidden') {
      attributions.push(skillToAttribution(skill, 'model-discovery'));
    }
    if (
      skill.visibility === 'on' &&
      skill.modelDiscovery === 'full' &&
      isPreloadedSkill(skill, preloadSkillNames)
    ) {
      attributions.push(skillToAttribution(skill, 'preload'));
    }
  }
  return attributions;
}

export function buildCdfSkillsRuntime(
  projectPath: string,
  options: CdfSkillsRuntimeOptions = {}
): CdfSkillsRuntime {
  const plan = resolveSkillSourcePlan(projectPath, options);
  const catalog = resolveSkillCatalog(plan, {
    userOverrides: options.userOverrides,
    agentOverrides: options.agentOverrides,
    pathContext: options.pathContext,
    includeNestedProjectSkills: options.includeNestedProjectSkills,
  });
  const prompt = renderCdfSkillsPrompt(catalog.skills, {
    preloadSkillNames: options.preloadSkillNames,
    readSkill: (skill) => stripSkillFrontmatter(fs.readFileSync(skill.skillPath, 'utf-8')),
  });

  return {
    skills: catalog.skills,
    prompt,
    warnings: catalog.warnings,
    attributions: buildSkillAttributions(catalog.skills, options.preloadSkillNames),
  };
}
