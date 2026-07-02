import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';
import { listSkills, type FilesystemPermission } from 'deepagents';
import type { ParsedFrontmatter } from '../../shared/types';
import { getKnowledgeBaseSkillMarkdown } from '../knowledge-base-skill';
import { getPdfParsingSkillMarkdown } from '../pdf-parsing-skill';
import {
  invalidateSkillSourceCaches,
  resolveSkillCatalog,
  resolveSkillSourcePlan,
  type ResolvedSkillCatalogEntry,
  type SkillCatalogOptions,
  type SkillSourceKind,
  type SkillSourcePlanOptions,
} from './skills-runtime/skill-sources';
import { parseSkillMetadata, validateSkillName } from './skills-runtime/skill-metadata';
import {
  readAgentSkillOverrides,
  readUserSkillOverrides,
  resolveSkillVisibility,
} from './skills-runtime/skill-visibility';
import type { SkillEffectiveVisibility, SkillOverrideState } from '../../shared/skill-overrides';

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
  qualifiedName?: string;
  description: string;
  scope: SkillScope;
  sourceKind?: SkillSourceKind;
  sourceLabel?: string;
  sourcePath?: string;
  skillPath?: string;
  skillVisibility?: SkillEffectiveVisibility;
  visibilitySource?: string;
  modelDiscovery?: string;
  userInvocable?: boolean;
  editable?: boolean;
  resourceFiles: string[];
  script_type?: string;
  entryScript?: string;
  script_content?: string;
  created_at: number;
  updated_at: number;
  shadowedSkills?: Array<{
    name: string;
    qualifiedName?: string;
    sourceKind?: SkillSourceKind;
    sourceLabel?: string;
    sourcePath?: string;
    skillPath?: string;
  }>;
  /** 08.2 P4 D-09: pre-parsed frontmatter; consumers can read
   *  `frontmatter.disableModelInvocation` to gate LLM exposure. */
  frontmatter?: ParsedFrontmatter;
}

export type ListResolvedSkillViewsOptions = SkillSourcePlanOptions & SkillCatalogOptions;

export interface ResolveAgentSkillsConfigOptions {
  userOverrides?: Record<string, SkillOverrideState>;
  agentOverrides?: Record<string, SkillOverrideState>;
}

export interface ResolvedAgentSkillConfigOptions {
  options?: ResolveAgentSkillsConfigOptions;
  warnings: string[];
}

function ensureDir(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

function ensureBuiltInKnowledgeBaseSkill(): string {
  const skillDir = path.join(os.tmpdir(), 'cdf-built-in-skills', 'knowledge-base');
  ensureDir(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), getKnowledgeBaseSkillMarkdown(), 'utf-8');
  return skillDir;
}

function ensureBuiltInPdfParsingSkill(): string {
  const skillDir = path.join(os.tmpdir(), 'cdf-built-in-skills', 'pdf-parsing');
  ensureDir(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), getPdfParsingSkillMarkdown(), 'utf-8');
  return skillDir;
}

export function getBuiltInSkillDirs(): string[] {
  return [ensureBuiltInKnowledgeBaseSkill(), ensureBuiltInPdfParsingSkill()];
}

function parseFrontmatter(filePath: string): ParsedFrontmatter & { name?: string; description?: string } {
  const parsed = parseSkillMetadata(path.dirname(filePath));
  if (!parsed.metadata) return {};

  return {
    name: parsed.metadata.name,
    description: parsed.metadata.description,
    disableModelInvocation: parsed.metadata.disableModelInvocation,
    userInvocable: parsed.metadata.userInvocable,
    allowedTools: parsed.metadata.allowedTools,
    whenToUse: parsed.metadata.whenToUse,
  };
}

function isSkillHiddenFromModel(
  skillDir: string,
  overrides: {
    project?: Record<string, SkillOverrideState>;
    user?: Record<string, SkillOverrideState>;
    agent?: Record<string, SkillOverrideState>;
  } = {}
): boolean {
  const parsed = parseSkillMetadata(skillDir);
  if (!parsed.metadata) return false;
  const visibility = resolveSkillVisibility({
    name: parsed.metadata.name,
    frontmatter: {
      disableModelInvocation: parsed.metadata.disableModelInvocation,
      userInvocable: parsed.metadata.userInvocable,
    },
    overrides,
  });
  return visibility.modelDiscovery === 'hidden';
}

function isInsideDirectory(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function buildSkillSourceReadPermissions(
  projectPath: string,
  sourcePaths: string[]
): FilesystemPermission[] {
  const permissions: FilesystemPermission[] = [];
  const seen = new Set<string>();
  for (const sourcePath of sourcePaths) {
    if (isInsideDirectory(projectPath, sourcePath)) continue;
    const normalized = path.resolve(sourcePath);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    permissions.push({
      operations: ['read'] as const,
      paths: [path.join(normalized, '*'), path.join(normalized, '**', '*')],
    });
  }
  return permissions;
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
  const frontmatter = YAML.stringify({
    name: skill.name,
    description: skill.description || '',
  }).trimEnd();
  const lines = ['---', frontmatter, '---', '', `# ${skill.name}`, '', skill.description || ''];
  return `${lines.join('\n')}\n`;
}

function validateSkillInput(skill: PhysicalSkillInput): void {
  if (!skill.name || !skill.name.trim()) {
    throw new Error('Skill 名称不能为空');
  }
  const nameErrors = validateSkillName(skill.name);
  if (nameErrors.length > 0) {
    throw new Error(nameErrors[0]);
  }
  if (!skill.description || !skill.description.trim()) {
    throw new Error('Skill 描述不能为空');
  }
}

function parseAgentConfig(config: string | null | undefined): Record<string, unknown> {
  if (!config) return {};
  try {
    const parsed = JSON.parse(config) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      __config_parse_error__: message,
    };
  }
}

export function resolveAgentSkillConfigOptions(
  agentConfig: string | null | undefined,
  getStoreValue: (key: string) => unknown
): ResolvedAgentSkillConfigOptions {
  const user = readUserSkillOverrides(getStoreValue);
  const parsedAgentConfig = parseAgentConfig(agentConfig);
  const warnings = [...user.warnings];
  if (typeof parsedAgentConfig.__config_parse_error__ === 'string') {
    warnings.push(`Failed to parse agent config for Skill overrides: ${parsedAgentConfig.__config_parse_error__}`);
  }
  const agent = readAgentSkillOverrides(parsedAgentConfig);
  warnings.push(...agent.warnings);

  const options: ResolveAgentSkillsConfigOptions = {};
  if (Object.keys(user.overrides).length > 0) options.userOverrides = user.overrides;
  if (Object.keys(agent.overrides).length > 0) options.agentOverrides = agent.overrides;

  return {
    options: Object.keys(options).length > 0 ? options : undefined,
    warnings,
  };
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
      allowedTools: fm.allowedTools,
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

function getResolvedSkillId(skill: ResolvedSkillCatalogEntry): string {
  switch (skill.sourceKind) {
    case 'project':
      return `project:${skill.qualifiedName ?? skill.name}`;
    case 'project-nested':
      return `project-nested:${skill.qualifiedName ?? skill.name}`;
    case 'project-additional':
      return `project-additional:${skill.qualifiedName ?? skill.name}`;
    case 'user':
      return `global:${skill.qualifiedName ?? skill.name}`;
    case 'built-in':
      return `built-in:${skill.qualifiedName ?? skill.name}`;
    case 'enterprise':
      return `enterprise:${skill.qualifiedName ?? skill.name}`;
  }
}

function getResolvedSkillScope(skill: ResolvedSkillCatalogEntry): SkillScope {
  return skill.sourceKind === 'user' ? 'global' : 'project';
}

function getResolvedSkillSourceLabel(skill: Pick<ResolvedSkillCatalogEntry, 'sourceKind' | 'qualifier'>): string {
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

function isResolvedSkillEditable(skill: ResolvedSkillCatalogEntry): boolean {
  return skill.sourceKind === 'project' || skill.sourceKind === 'user';
}

function buildResolvedSkillView(skill: ResolvedSkillCatalogEntry): PhysicalSkillView {
  const skillDir = path.dirname(skill.skillPath);
  const stat = fs.statSync(skillDir);

  return {
    id: getResolvedSkillId(skill),
    name: skill.name,
    qualifiedName: skill.qualifiedName ?? skill.name,
    description: skill.description,
    scope: getResolvedSkillScope(skill),
    sourceKind: skill.sourceKind,
    sourceLabel: getResolvedSkillSourceLabel(skill),
    sourcePath: skill.sourcePath,
    skillPath: skill.skillPath,
    skillVisibility: skill.visibility,
    visibilitySource: skill.visibilitySource,
    modelDiscovery: skill.modelDiscovery,
    userInvocable: skill.userInvocable,
    editable: isResolvedSkillEditable(skill),
    resourceFiles: listResourceFiles(skillDir),
    created_at: stat.birthtimeMs || stat.ctimeMs,
    updated_at: stat.mtimeMs,
    shadowedSkills: skill.shadowedSkills?.map((shadowed) => ({
      name: shadowed.name,
      qualifiedName: shadowed.qualifiedName ?? shadowed.name,
      sourceKind: shadowed.sourceKind,
      sourceLabel: getResolvedSkillSourceLabel(shadowed),
      sourcePath: shadowed.sourcePath,
      skillPath: shadowed.skillPath,
    })),
  };
}

export function listResolvedSkillViews(
  projectPath: string,
  options: ListResolvedSkillViewsOptions = {}
): PhysicalSkillView[] {
  const plan = resolveSkillSourcePlan(projectPath, {
    builtInSkillDirs: options.builtInSkillDirs ?? getBuiltInSkillDirs(),
    userSkillsDir: options.userSkillsDir === undefined
      ? getScopePath(projectPath, 'global')
      : options.userSkillsDir,
    enterpriseSkillDirs: options.enterpriseSkillDirs,
  });
  const catalog = resolveSkillCatalog(plan, {
    userOverrides: options.userOverrides,
    agentOverrides: options.agentOverrides,
  });

  return catalog.skills.map(buildResolvedSkillView);
}

export function savePhysicalSkill(projectPath: string, scope: SkillScope, skill: PhysicalSkillInput): PhysicalSkillView {
  validateSkillInput(skill);
  invalidateSkillSourceCaches(projectPath);
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

  const parsed = parseSkillMetadata(sourceDir);
  if (!parsed.metadata) {
    throw new Error(`Skill 元数据无效：${parsed.errors.join('；')}`);
  }

  const skillName = parsed.metadata.name;
  const scopeDir = path.join(os.homedir(), '.cdf', 'skills');
  const targetDir = path.join(scopeDir, skillName);

  ensureDir(scopeDir);

  if (fs.existsSync(targetDir)) {
    throw new Error(`Skill "${skillName}" already exists`);
  }

  fs.cpSync(sourceDir, targetDir, { recursive: true });
  invalidateSkillSourceCaches();
  return buildPhysicalSkillView(path.join(os.homedir(), '.cdf'), 'global', skillName);
}

export function deletePhysicalSkill(projectPath: string, scope: SkillScope, name: string): void {
  invalidateSkillSourceCaches(projectPath);
  const skillDir = getSkillDir(projectPath, scope, name);
  if (fs.existsSync(skillDir)) {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
}

export function resolveAgentSkillsConfig(
  projectPath: string,
  preloadSkillIds?: string[],
  options: ResolveAgentSkillsConfigOptions = {}
): { skillsSources: string[]; permissions: FilesystemPermission[] } {
  // `preloadSkillIds` is retained for API compatibility with stored
  // agent_skills rows; Agent Skill selection now means Skill Preload.
  void preloadSkillIds;
  const globalSkillsDir = getScopePath(projectPath, 'global');
  const sourcePlan = resolveSkillSourcePlan(projectPath, {
    builtInSkillDirs: getBuiltInSkillDirs(),
    userSkillsDir: globalSkillsDir,
  });
  const sources = sourcePlan.sources.map((source) => source.path);
  const visibilityOverrides = {
    user: options.userOverrides,
    project: sourcePlan.config.overrides,
    agent: options.agentOverrides,
  };

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
      if (!isSkillHiddenFromModel(src, visibilityOverrides)) {
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
      if (isSkillHiddenFromModel(entryPath, visibilityOverrides)) {
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
      ...buildSkillSourceReadPermissions(projectPath, filtered),
    ],
  };
}
