import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSkills, type FilesystemPermission } from 'deepagents';
import type { ParsedFrontmatter } from '../../shared/types';

type SkillScope = 'global' | 'project';

interface PhysicalSkillInput {
  name: string;
  description?: string;
  script_type?: string;
  script_content?: string;
}

interface PhysicalSkillView {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  resourceFiles: string[];
  script_type?: string;
  entryScript?: string;
  script_content?: string;
  created_at: number;
  updated_at: number;
  /** 08.2 P4 D-09: pre-parsed frontmatter; consumers can read
   *  `frontmatter.disableModelInvocation` to gate LLM exposure. */
  frontmatter?: ParsedFrontmatter;
}

function ensureDir(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

/**
 * Parse the YAML frontmatter from a skill's SKILL.md. 08.2 P4 D-09 extends
 * the legacy hand-rolled parser to also pick up the 4 Claude Code-aligned
 * fields. Returns a partial `ParsedFrontmatter` (camelCase keys) — consumers
 * apply D-10 defaults themselves.
 *
 * We intentionally keep the simple hand-rolled parser here (vs pulling in
 * `yaml@2.9.0`) because:
 *   1. The skill frontmatter is human-authored and tiny (typically 3-5 lines).
 *   2. Boolean values default to undefined when absent (matches D-10: "absence
 *      means false"); we don't need YAML's typed coercion.
 *   3. Avoids a transitive dep edge from a `deepagent/*` file to project-commands
 *      which is currently in the slash-command subsystem.
 */
function parseFrontmatter(filePath: string): ParsedFrontmatter & { name?: string; description?: string } {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.startsWith('---\n')) return {};

  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};

  const lines = content.slice(4, end).split('\n');
  const result: Record<string, string> = {};
  for (const line of lines) {
    const [rawKey, ...rawValue] = line.split(':');
    if (!rawKey || rawValue.length === 0) continue;
    result[rawKey.trim()] = rawValue.join(':').trim();
  }

  // 08.2 P4 D-09: parse the 4 Claude Code-aligned fields (kebab-case → camelCase).
  // Booleans are recognized by literal "true" / "false" — absence leaves the
  // field undefined so the D-10 default ("absence means false") applies downstream.
  const disableRaw = result['disable-model-invocation'];
  const userInvocableRaw = result['user-invocable'];
  const result_: ParsedFrontmatter & { name?: string; description?: string } = {
    name: result['name'],
    description: result['description'],
    disableModelInvocation:
      disableRaw === 'true' ? true : disableRaw === 'false' ? false : undefined,
    userInvocable:
      userInvocableRaw === 'true' ? true : userInvocableRaw === 'false' ? false : undefined,
    whenToUse: result['when_to_use'] || '',
  };
  return result_;
}

/** 08.2 P4 D-09: does this skill's SKILL.md mark `disable-model-invocation: true`? */
function isSkillDisabledFromLLM(skillDir: string): boolean {
  return parseFrontmatter(path.join(skillDir, 'SKILL.md')).disableModelInvocation === true;
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
  const fm = parseFrontmatter(path.join(skillDir, 'SKILL.md'));

  // 08.2 P4 D-09: append `when_to_use` text to the description so the LLM
  // can self-judge when to auto-trigger the skill (Claude Code behavior).
  // The joined text is also what the UI popup shows; the `frontmatter`
  // field preserves the raw `whenToUse` for consumers that need to split.
  const baseDescription = fm.description || '';
  const whenToUse = (fm.whenToUse || '').trim();
  const description = whenToUse
    ? `${baseDescription}\n\n何时使用：${whenToUse}`
    : baseDescription;

  const resourceFiles = listResourceFiles(skillDir);
  const entryScript = resourceFiles.find((file) => file === 'main.js' || file === 'main.py') ?? resourceFiles[0];
  const scriptPath = entryScript ? path.join(skillDir, entryScript) : null;
  const scriptContent = scriptPath && fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf-8') : undefined;

  return {
    id: `${scope}:${skillName}`,
    name: fm.name || skillName,
    description,
    scope,
    resourceFiles,
    script_type: entryScript?.endsWith('.py') ? 'python' : entryScript ? 'javascript' : undefined,
    entryScript,
    script_content: scriptContent,
    created_at: stat.birthtimeMs || stat.ctimeMs,
    updated_at: stat.mtimeMs,
    frontmatter: {
      disableModelInvocation: fm.disableModelInvocation,
      userInvocable: fm.userInvocable,
      whenToUse: fm.whenToUse,
    },
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
  if (skill.script_content) {
    const entryScript = skill.script_type === 'python' ? 'main.py' : 'main.js';
    fs.writeFileSync(path.join(skillDir, entryScript), skill.script_content, 'utf-8');
  }
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

export function resolveAgentSkillsConfig(projectPath: string, enabledSkillIds?: string[]): { skillsSources: string[]; permissions: FilesystemPermission[] } {
  const globalSkillsDir = getScopePath(projectPath, 'global');
  const projectSkillsDir = getScopePath(projectPath, 'project');
  const sources: string[] = [];

  // 项目级 skills: 始终全量加载，不经过白名单
  if (fs.existsSync(projectSkillsDir)) {
    sources.push(projectSkillsDir);
  }

  // 全局 skills: 按绑定白名单过滤
  const enabled = Array.isArray(enabledSkillIds) && enabledSkillIds.length > 0 ? enabledSkillIds : null;
  if (enabled) {
    for (const skillId of enabled) {
      const [scope, skillName] = skillId.includes(':') ? skillId.split(':', 2) : ['global', skillId];
      if (scope === 'global') {
        const physicalPath = path.join(globalSkillsDir, skillName);
        if (fs.existsSync(physicalPath)) {
          sources.push(physicalPath);
        }
      }
    }
  } else if (fs.existsSync(globalSkillsDir)) {
    sources.push(globalSkillsDir);
  }

  // 08.2 P4 D-09 disable-model-invocation enforcement: filter the LLM-visible
  // sources so deepagents never sees a skill marked disable-model-invocation: true.
  // We rewrite the per-skill entries to either keep the parent dir (when no skill
  // inside it is disabled) or expand the dir into a list of individual skill
  // subdirectories that are NOT disabled. Walk sources and replace any directory
  // that contains a disabled skill.
  const filtered: string[] = [];
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    const stat = fs.statSync(src);
    if (!stat.isDirectory()) {
      filtered.push(src);
      continue;
    }
    // Check if src is a "skills dir" (i.e. lists sibling skill subdirectories)
    // vs an "individual skill dir" (contains a SKILL.md). An individual skill
    // dir never has disabled siblings to filter, so just push it.
    const hasSkillMd = fs.existsSync(path.join(src, 'SKILL.md'));
    if (hasSkillMd) {
      if (!isSkillDisabledFromLLM(src)) {
        filtered.push(src);
      }
      continue;
    }
    // Skills dir: keep only skill subdirs whose SKILL.md is NOT disable-model-invocation: true
    const keep: string[] = [];
    let allKept = true;
    for (const entry of fs.readdirSync(src)) {
      const entryPath = path.join(src, entry);
      if (!fs.statSync(entryPath).isDirectory()) continue;
      if (isSkillDisabledFromLLM(entryPath)) {
        allKept = false;
        continue;
      }
      keep.push(entryPath);
    }
    if (allKept) {
      // No disabled skills found — keep the original directory entry (cheaper
      // for deepagents to enumerate, and matches the pre-08.2 behavior).
      filtered.push(src);
    } else {
      filtered.push(...keep);
    }
  }

  return {
    skillsSources: filtered,
    permissions: [
      { operations: ['read', 'write'] as const, paths: [path.join(projectPath, '*'), path.join(projectPath, '**', '*')] },
    ],
  };
}
