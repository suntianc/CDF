import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSkills, type FilesystemPermission } from 'deepagents';

type SkillScope = 'global' | 'project';
type ScriptType = 'bash' | 'python' | 'javascript';

interface PhysicalSkillInput {
  name: string;
  description?: string;
  script_content?: string;
  script_type?: ScriptType;
  module?: string;
}

interface PhysicalSkillView {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  module?: string;
  entryScript: string | null;
  resourceFiles: string[];
  script_content: string;
  script_type: ScriptType;
  created_at: number;
  updated_at: number;
}

const SCRIPT_EXTENSIONS: Record<ScriptType, string> = {
  bash: 'sh',
  javascript: 'js',
  python: 'py',
};

function toPosix(inputPath: string): string {
  return inputPath.split(path.sep).join(path.posix.sep);
}

function toVirtualPath(projectPath: string, targetPath: string): string {
  const relative = toPosix(path.relative(projectPath, targetPath));
  return relative.startsWith('/') ? relative : `/${relative}`;
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

function detectEntryScriptName(skillDir: string, frontmatterModule?: string): string | null {
  if (frontmatterModule && fs.existsSync(path.join(skillDir, frontmatterModule))) {
    return frontmatterModule;
  }

  const candidates = ['main.ts', 'main.js', 'main.py', 'main.sh', 'index.ts', 'index.js', 'index.py', 'index.sh'];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(skillDir, candidate))) {
      return candidate;
    }
  }

  const resourceFile = listResourceFiles(skillDir).find((file) => /\.(ts|js|py|sh)$/i.test(file));
  return resourceFile || null;
}

function detectScriptTypeFromFile(fileName: string | null): ScriptType {
  if (!fileName) return 'bash';
  if (fileName.endsWith('.py')) return 'python';
  if (fileName.endsWith('.js') || fileName.endsWith('.ts')) return 'javascript';
  return 'bash';
}

function readScriptContent(skillDir: string, fileName: string | null): string {
  if (!fileName) return '';
  const scriptPath = path.join(skillDir, fileName);
  if (!fs.existsSync(scriptPath)) return '';
  return fs.readFileSync(scriptPath, 'utf-8');
}

function buildSkillMarkdown(skill: PhysicalSkillInput, entryScriptName: string | null): string {
  const lines = ['---', `name: ${skill.name}`, `description: ${skill.description || ''}`];
  if (skill.module) {
    lines.push(`module: ${skill.module}`);
  }
  lines.push('---', `# ${skill.name}`, '', skill.description || 'CDF Skill');

  if (entryScriptName) {
    lines.push('', `使用同目录下的 \`${entryScriptName}\` 资源文件完成该技能。`);
  }

  return `${lines.join('\n')}\n`;
}

function buildPhysicalSkillView(projectPath: string, scope: SkillScope, skillName: string): PhysicalSkillView {
  const skillDir = getSkillDir(projectPath, scope, skillName);
  const stat = fs.statSync(skillDir);
  const frontmatter = parseFrontmatter(path.join(skillDir, 'SKILL.md'));
  const entryScript = detectEntryScriptName(skillDir, frontmatter.module);

  return {
    id: `${scope}:${skillName}`,
    name: frontmatter.name || skillName,
    description: frontmatter.description || '',
    scope,
    module: frontmatter.module,
    entryScript,
    resourceFiles: listResourceFiles(skillDir),
    script_content: readScriptContent(skillDir, entryScript),
    script_type: detectScriptTypeFromFile(entryScript),
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

  const extension = SCRIPT_EXTENSIONS[skill.script_type || 'bash'];
  const entryScriptName = skill.script_content ? `main.${extension}` : null;

  if (entryScriptName && skill.script_content !== undefined) {
    fs.writeFileSync(path.join(skillDir, entryScriptName), skill.script_content, 'utf-8');
    if (extension === 'sh' && process.platform !== 'win32') {
      fs.chmodSync(path.join(skillDir, entryScriptName), 0o755);
    }
  }

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), buildSkillMarkdown(skill, entryScriptName), 'utf-8');
  return buildPhysicalSkillView(projectPath, scope, skill.name);
}

export function deletePhysicalSkill(projectPath: string, scope: SkillScope, name: string): void {
  const skillDir = getSkillDir(projectPath, scope, name);
  if (fs.existsSync(skillDir)) {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
}

export function mirrorGlobalSkillsIntoProject(projectPath: string): string | null {
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
  const enabled = Array.isArray(enabledSkillIds) ? new Set(enabledSkillIds) : null;

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
      { operations: ['read', 'write'] as const, paths: ['/.env', '/.env*', '/.git/*', '/.git/**/*', '/node_modules/*', '/node_modules/**/*', '/out/*', '/out/**/*', '/dist/*', '/dist/**/*', '/Users/*', '/Users/**/*', '/home/*', '/home/**/*', '/private/*', '/private/**/*', '/tmp/*', '/tmp/**/*', '/var/*', '/var/**/*'], mode: 'deny' },
      { operations: ['read', 'write'] as const, paths: ['/*', '/**/*'] },
      { operations: ['read', 'write'] as const, paths: ['/.cdf/.runtime/*', '/.cdf/.runtime/**/*'] },
    ],
  };
}
