import fs from 'fs';
import { renderCdfSkillsPrompt } from './skill-prompt';
import {
  resolveSkillCatalog,
  resolveSkillSourcePlan,
  type ResolvedSkillCatalogEntry,
  type SkillCatalogOptions,
  type SkillSourcePlanOptions,
} from './skill-sources';

export interface CdfSkillsRuntimeOptions extends SkillSourcePlanOptions, SkillCatalogOptions {
  preloadSkillNames?: string[];
}

export interface CdfSkillsRuntime {
  skills: ResolvedSkillCatalogEntry[];
  prompt: string;
  warnings: string[];
}

function stripSkillFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---', 4);
  return end === -1
    ? content
    : content.slice(end + '\n---'.length).replace(/^\s+/, '');
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
  });
  const prompt = renderCdfSkillsPrompt(catalog.skills, {
    preloadSkillNames: options.preloadSkillNames,
    readSkill: (skill) => stripSkillFrontmatter(fs.readFileSync(skill.skillPath, 'utf-8')),
  });

  return {
    skills: catalog.skills,
    prompt,
    warnings: catalog.warnings,
  };
}
