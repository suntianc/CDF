import { listPhysicalSkills } from '../../deepagent/skill-manager';
import type { SlashCommand } from '../../../shared/types';

/**
 * Phase 6 Skills collector.
 *
 * - Reuses `listPhysicalSkills(projectPath)` from skill-manager.ts (D-22 same-name
 *   project wins is already enforced by that function).
 * - Maps `scope: 'project' | 'global'` to `source: 'skill:project' | 'skill:global'`.
 * - `target` is `${scope}:${name}` (matches the `id` returned by listPhysicalSkills).
 */
export async function collectSkillCommands(projectPath: string): Promise<SlashCommand[]> {
  const skills = listPhysicalSkills(projectPath);
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    source: skill.scope === 'project' ? 'skill:project' : 'skill:global',
    target: `${skill.scope}:${skill.name}`,
    sourceLabel: `skill:${skill.scope}`,
    badge: `[skill:${skill.scope}]`,
  }));
}
