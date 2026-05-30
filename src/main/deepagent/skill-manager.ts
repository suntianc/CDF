import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSkills, type FilesystemPermission } from 'deepagents';

type SkillScope = 'global' | 'project';

interface PhysicalSkillInput {
  name: string;
  description?: string;
}

interface PhysicalSkillView {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  resourceFiles: string[];
  created_at: number;
  updated_at: number;
}

function toPosix(inputPath: string): string {
  return inputPath.split(path.sep).join(path.posix.sep);
}

function toVirtualPath(projectPath: string, targetPath: string): string {
  const relative = toPosix(path.relative(projectPath, targetPath));
  const clean = relative.startsWith('/') ? relative : `/${relative}`;
  return `/workspace${clean}`;
}

function ensureDir(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

function parseFrontmatter(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.startsWith('---\n')) return {};

  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};

  const frontmatter = content.slice(4, end).split('\n');
  const result: Record<string, string> = {};
  for (const line of frontmatter) {
    const [rawKey, ...rawValue] = line.split(':');
    if (!rawKey || rawValue.length === 0) continue;
    result[rawKey.trim()] = rawValue.join(':').trim();
  }
  return result;
}

function getSkillDir(projectPath: string, scope: SkillScope, skillName: string): string {
  return path.join(getScopePath(projectPath, scope), skillName);
}

function listResourceFiles(skillDir: string): string[] {
  if (!fs.existsSync(skillDir)) return [];
  return fs
    .readdirSync(skillDir)
    .filter((file) => file !== 'SKILL.md')
    .sort();
}

function buildSkillMarkdown(skill: PhysicalSkillInput): string {
  const lines = ['---', `name: ${skill.name}`, `description: ${skill.description || ''}`, '---', '', `# ${skill.name}`, '', skill.description || ''];
  return `${lines.join('\n')}\n`;
}

function buildPhysicalSkillView(projectPath: string, scope: SkillScope, skillName: string): PhysicalSkillView {
  const skillDir = getSkillDir(projectPath, scope, skillName);
  const stat = fs.statSync(skillDir);
  const frontmatter = parseFrontmatter(path.join(skillDir, 'SKILL.md'));

  return {
    id: `${scope}:${skillName}`,
    name: frontmatter.name || skillName,
    description: frontmatter.description || '',
    scope,
    resourceFiles: listResourceFiles(skillDir),
    created_at: stat.birthtimeMs || stat.ctimeMs,
    updated_at: stat.mtimeMs,
  };
}

export function getScopePath(projectPath: string, scope: SkillScope): string {
  switch (scope) {
    case 'global':
      return path.join(os.homedir(), '.cdf', 'skills');
    case 'project':
      return path.join(projectPath, '.cdf', 'skills');
  }
}

export function listPhysicalSkills(projectPath: string): PhysicalSkillView[] {
  const globalSkillsDir = getScopePath(projectPath, 'global');
  const projectSkillsDir = getScopePath(projectPath, 'project');
  const merged = listSkills({
    userSkillsDir: fs.existsSync(globalSkillsDir) ? globalSkillsDir : null,
    projectSkillsDir: fs.existsSync(projectSkillsDir) ? projectSkillsDir : null,
  });

  return merged.map((skill) =>
    buildPhysicalSkillView(
      projectPath,
      skill.source === 'project' ? 'project' : 'global',
      skill.name
    )
  );
}

export function savePhysicalSkill(projectPath: string, scope: SkillScope, skill: PhysicalSkillInput): PhysicalSkillView {
  const baseDir = getScopePath(projectPath, scope);
  const skillDir = getSkillDir(projectPath, scope, skill.name);
  ensureDir(baseDir);
  ensureDir(skillDir);

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), buildSkillMarkdown(skill), 'utf-8');
  return buildPhysicalSkillView(projectPath, scope, skill.name);
}

export function importPhysicalSkillDirectory(sourceDir: string): PhysicalSkillView {
  if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
    throw new Error('所选目录中未找到 SKILL.md 文件，请选择包含 SKILL.md 的 Skill 目录');
  }

  const skillName = path.basename(sourceDir);
  const scopeDir = path.join(os.homedir(), '.cdf', 'skills');
  const targetDir = path.join(scopeDir, skillName);

  ensureDir(scopeDir);

  if (fs.existsSync(targetDir)) {
    throw new Error(`Skill "${skillName}" already exists`);
  }

  fs.cpSync(sourceDir, targetDir, { recursive: true });
  return buildPhysicalSkillView(path.join(os.homedir(), '.cdf'), 'global', skillName);
}

export function deletePhysicalSkill(projectPath: string, scope: SkillScope, name: string): void {
  const skillDir = getSkillDir(projectPath, scope, name);
  if (fs.existsSync(skillDir)) {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
}

function mirrorGlobalSkillsIntoProject(projectPath: string): string | null {
  const globalSkillsDir = getScopePath(projectPath, 'global');
  if (!fs.existsSync(globalSkillsDir)) return null;

  const runtimeDir = path.join(projectPath, '.cdf', '.runtime', 'global-skills');
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  ensureDir(path.dirname(runtimeDir));
  fs.cpSync(globalSkillsDir, runtimeDir, { recursive: true });
  return runtimeDir;
}

export function resolveAgentSkillsConfig(projectPath: string, enabledSkillIds?: string[]): { skillsSources: string[]; permissions: FilesystemPermission[] } {
  const projectSkillsDir = getScopePath(projectPath, 'project');
  const mirroredGlobalDir = mirrorGlobalSkillsIntoProject(projectPath);
  const sources: string[] = [];
  const enabled = Array.isArray(enabledSkillIds) && enabledSkillIds.length > 0 ? new Set(enabledSkillIds) : null;

  if (enabled) {
    for (const skillId of enabled) {
      const [scope, skillName] = skillId.includes(':') ? skillId.split(':', 2) : ['project', skillId];
      const baseDir = scope === 'global' ? mirroredGlobalDir : projectSkillsDir;
      if (baseDir && skillName && fs.existsSync(path.join(baseDir, skillName))) {
        sources.push(toVirtualPath(projectPath, path.join(baseDir, skillName)));
      }
    }
  } else if (mirroredGlobalDir && fs.existsSync(mirroredGlobalDir)) {
    sources.push(toVirtualPath(projectPath, mirroredGlobalDir));
  }

  if (!enabled && fs.existsSync(projectSkillsDir)) {
    sources.push(toVirtualPath(projectPath, projectSkillsDir));
  }

  return {
    skillsSources: sources,
    permissions: [
      { operations: ['read', 'write'] as const, paths: ['/workspace/.env', '/workspace/.env*', '/workspace/.git/*', '/workspace/.git/**/*', '/workspace/node_modules/*', '/workspace/node_modules/**/*', '/workspace/out/*', '/workspace/out/**/*', '/workspace/dist/*', '/workspace/dist/**/*', '/Users/*', '/Users/**/*', '/home/*', '/home/**/*', '/private/*', '/private/**/*', '/tmp/*', '/tmp/**/*', '/var/*', '/var/**/*'], mode: 'deny' },
      { operations: ['read', 'write'] as const, paths: ['/workspace/*', '/workspace/**/*'] },
      { operations: ['read', 'write'] as const, paths: ['/workspace/.cdf/.runtime/*', '/workspace/.cdf/.runtime/**/*'] },
    ],
  };
}
