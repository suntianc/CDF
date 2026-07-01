import type { ResolvedSkillCatalogEntry } from './skill-sources';

/*
 * Adapted from the SkillsMiddleware prompt formatting in deepagents@1.10.2.
 *
 * MIT License
 * Copyright (c) LangChain, Inc.
 *
 * CDF intentionally keeps only the prompt-rendering subset here. Source
 * scanning, backend adaptation, LangGraph state reducers, and filesystem
 * middleware remain outside this module.
 */

const DEFAULT_SKILL_READ_LINE_LIMIT = 1000;

export interface RenderCdfSkillsPromptOptions {
  preloadSkillNames?: string[];
  readSkill?: (skill: ResolvedSkillCatalogEntry) => string;
}

function renderSkillLine(skill: ResolvedSkillCatalogEntry): string | null {
  if (skill.modelDiscovery === 'hidden') return null;

  const displayName = skill.qualifiedName ?? skill.name;
  if (skill.modelDiscovery === 'name-only') {
    return `- **${displayName}** (name-only)`;
  }

  return [
    `- **${displayName}**: ${skill.description}`,
    `  -> Read \`${skill.skillPath}\` for full instructions`,
  ].join('\n');
}

function renderPreloadedSkills(
  skills: ResolvedSkillCatalogEntry[],
  options: RenderCdfSkillsPromptOptions
): string[] {
  const preloadNames = new Set(options.preloadSkillNames ?? []);
  if (preloadNames.size === 0 || !options.readSkill) return [];

  const sections: string[] = [];
  for (const skill of skills) {
    // Preload only applies to fully model-discoverable `on` Skills. Injecting
    // a `name-only` Skill body here would silently undo its visibility downgrade.
    if (skill.visibility !== 'on' || skill.modelDiscovery !== 'full') continue;
    const displayName = skill.qualifiedName ?? skill.name;
    if (!preloadNames.has(skill.name) && !preloadNames.has(displayName)) continue;
    sections.push([
      `### ${displayName}`,
      `Path: \`${skill.skillPath}\``,
      '',
      options.readSkill(skill),
    ].join('\n'));
  }

  return sections.length > 0
    ? ['## Preloaded Skills', '', ...sections]
    : [];
}

export function renderCdfSkillsPrompt(
  skills: ResolvedSkillCatalogEntry[],
  options: RenderCdfSkillsPromptOptions = {}
): string {
  const renderedSkills = skills
    .map(renderSkillLine)
    .filter((line): line is string => Boolean(line));

  const skillsList = renderedSkills.length > 0
    ? renderedSkills.join('\n')
    : '(No model-discoverable skills available.)';

  return [
    '## Skills System',
    '',
    'You have access to a skills library that provides specialized capabilities and domain knowledge.',
    '',
    '**Available Skills:**',
    '',
    skillsList,
    '',
    '**How to Use Skills (Progressive Disclosure):**',
    '',
    'Skills follow a progressive disclosure pattern. You know model-discoverable skills exist, but you only read full instructions when needed.',
    '',
    '1. Recognize when a skill applies from the available name and description.',
    `2. Read the skill's full instructions with \`read_file\` and \`limit=${DEFAULT_SKILL_READ_LINE_LIMIT}\`.`,
    '3. Follow the instructions in SKILL.md and use supporting files by absolute path.',
    '',
    ...renderPreloadedSkills(skills, options),
  ].join('\n');
}
