import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureConversationSkillSnapshot,
  isGlobalSkillSourceKind,
  resolveProjectSkillCatalog,
} from './skill-catalog';

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function createProjectWithSkill(name: string): string {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-skill-catalog-'));
  cleanupPaths.push(projectPath);
  const skillDir = path.join(projectPath, '.cdf', 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Project-owned skill\n---\n\nInstructions\n`,
  );
  return projectPath;
}

describe('Skill Catalog', () => {
  it('never routes Project Skills through the Scene exposure predicate', () => {
    const projectPath = createProjectWithSkill('project-only-skill');

    const catalog = resolveProjectSkillCatalog(projectPath, {
      isGlobalSkillExposed: () => false,
    });

    expect(catalog.skills.map((skill) => skill.name)).toContain('project-only-skill');
    expect(catalog.skills.some((skill) => isGlobalSkillSourceKind(skill.sourceKind))).toBe(false);
  });

  it('applies both the includeSkill filter and the Scene exposure predicate', () => {
    const projectPath = createProjectWithSkill('filtered-project-skill');

    const catalog = resolveProjectSkillCatalog(projectPath, {
      includeSkill: (_source, skillName) => skillName !== 'filtered-project-skill',
      isGlobalSkillExposed: () => false,
    });

    expect(catalog.skills).toEqual([]);
  });

  it('captures a Conversation Skill Snapshot with only exposed sources', () => {
    const projectPath = createProjectWithSkill('snapshot-skill');

    const snapshot = captureConversationSkillSnapshot({
      projectPath,
      isGlobalSkillExposed: () => false,
    });

    expect(snapshot.map((skill) => skill.name)).toEqual(['snapshot-skill']);
    expect(snapshot[0]).toMatchObject({
      sourceKind: 'project',
      skillPath: path.join(projectPath, '.cdf', 'skills', 'snapshot-skill', 'SKILL.md'),
      userInvocable: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain('Instructions');
  });
});
