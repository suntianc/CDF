import fs from 'fs';
import path from 'path';
import { parseSkillMetadata } from './skill-metadata';
import type { SkillSourceKind } from '../../../shared/skills';
export type { SkillSourceKind } from '../../../shared/skills';
import type {
  SkillEffectiveVisibility,
  SkillModelDiscovery,
  SkillOverrideState,
  SkillVisibilitySource,
} from '../../../shared/skill-overrides';
import { parseSkillOverrideRecord, resolveSkillVisibility } from './skill-visibility';

export interface ProjectSkillConfig {
  version: 1;
  overrides: Record<string, SkillOverrideState>;
  additionalSkillDirectories: string[];
}

export interface SkillSourceEntry {
  kind: SkillSourceKind;
  path: string;
  qualifier?: string;
}

export interface SkillSourcePlan {
  config: ProjectSkillConfig;
  sources: SkillSourceEntry[];
  warnings: string[];
}

export interface ResolvedSkillCatalogEntry {
  name: string;
  qualifiedName?: string;
  qualifier?: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  whenToUse?: string;
  arguments?: string[];
  sourceKind: SkillSourceKind;
  sourcePath: string;
  skillPath: string;
  visibility: SkillEffectiveVisibility;
  visibilitySource: SkillVisibilitySource;
  modelDiscovery: SkillModelDiscovery;
  userInvocable: boolean;
  shadowedSkills?: ShadowedSkillCatalogEntry[];
}

export interface ShadowedSkillCatalogEntry {
  name: string;
  qualifiedName?: string;
  qualifier?: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  whenToUse?: string;
  arguments?: string[];
  sourceKind: SkillSourceKind;
  sourcePath: string;
  skillPath: string;
  visibility: SkillEffectiveVisibility;
  visibilitySource: SkillVisibilitySource;
  modelDiscovery: SkillModelDiscovery;
  userInvocable: boolean;
}

export interface ResolvedSkillCatalog {
  skills: ResolvedSkillCatalogEntry[];
  warnings: string[];
}

export interface SkillSourcePlanOptions {
  builtInSkillDirs?: string[];
  userSkillsDir?: string | null;
  enterpriseSkillDirs?: string[];
  /**
   * Discover nested Project Skills (`<dir>/.cdf/skills`) below the project root.
   * Off by default: nested Skills + path-aware relevance are a later delivery
   * slice per ADR 0012, so production stays on the flat resolution path until
   * that slice is enabled.
   */
  includeNestedProjectSkills?: boolean;
}

export interface SkillCatalogOptions {
  userOverrides?: Record<string, SkillOverrideState>;
  agentOverrides?: Record<string, SkillOverrideState>;
  /** Filters a source entry before same-name resolution so excluded Globals cannot shadow Project Skills. */
  includeSkill?: (source: SkillSourceEntry, skillName: string) => boolean;
  pathContext?: string[];
  /** See {@link SkillSourcePlanOptions.includeNestedProjectSkills}. Gates path-aware ranking. */
  includeNestedProjectSkills?: boolean;
}

function classifyGlobalSource(sourceKind: SkillSourceKind): boolean {
  return sourceKind === 'built-in' || sourceKind === 'user';
}

const DEFAULT_PROJECT_SKILL_CONFIG: ProjectSkillConfig = {
  version: 1,
  overrides: {},
  additionalSkillDirectories: [],
};
const NESTED_PROJECT_SKILL_SCAN_IGNORED_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);
const NESTED_PROJECT_SKILL_SCAN_CACHE_TTL_MS = 1000;
const nestedProjectSkillSourceCache = new Map<string, {
  expiresAt: number;
  sources: SkillSourceEntry[];
}>();

export function invalidateSkillSourceCaches(projectPath?: string): void {
  if (!projectPath) {
    nestedProjectSkillSourceCache.clear();
    return;
  }
  nestedProjectSkillSourceCache.delete(path.resolve(projectPath));
}

function defaultProjectSkillConfig(): ProjectSkillConfig {
  return {
    version: DEFAULT_PROJECT_SKILL_CONFIG.version,
    overrides: {},
    additionalSkillDirectories: [],
  };
}

function readProjectSkillConfig(projectPath: string): {
  config: ProjectSkillConfig;
  warnings: string[];
} {
  const configPath = path.join(projectPath, '.cdf', 'skills.config.json');
  if (!fs.existsSync(configPath)) {
    return { config: defaultProjectSkillConfig(), warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      config: defaultProjectSkillConfig(),
      warnings: [`Failed to parse ${configPath}: ${message}`],
    };
  }

  const config = defaultProjectSkillConfig();
  const warnings: string[] = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const rawConfig = parsed as Record<string, unknown>;
    if (rawConfig.version !== undefined && rawConfig.version !== 1) {
      return {
        config,
        warnings: [`Unsupported ${configPath} version: ${String(rawConfig.version)}`],
      };
    }
    if (Array.isArray(rawConfig.additionalSkillDirectories)) {
      for (const entry of rawConfig.additionalSkillDirectories) {
        if (typeof entry === 'string') {
          config.additionalSkillDirectories.push(entry);
        } else {
          warnings.push(`Ignored non-string additionalSkillDirectories entry: ${String(entry)}`);
        }
      }
    }
    if (
      rawConfig.overrides &&
      typeof rawConfig.overrides === 'object' &&
      !Array.isArray(rawConfig.overrides)
    ) {
      const parsedOverrides = parseSkillOverrideRecord(rawConfig.overrides);
      config.overrides = parsedOverrides.overrides;
      warnings.push(...parsedOverrides.warnings);
    }
  }

  return { config, warnings };
}

function getProjectSkillConfigPath(projectPath: string): string {
  return path.join(projectPath, '.cdf', 'skills.config.json');
}

function writeProjectSkillConfig(projectPath: string, config: ProjectSkillConfig): void {
  const configPath = getProjectSkillConfigPath(projectPath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  invalidateSkillSourceCaches(projectPath);
}

export function updateProjectSkillOverride(
  projectPath: string,
  skillName: string,
  visibility: SkillOverrideState
): ProjectSkillConfig {
  const { config } = readProjectSkillConfig(projectPath);
  const nextConfig: ProjectSkillConfig = {
    version: 1,
    overrides: { ...config.overrides },
    additionalSkillDirectories: [...config.additionalSkillDirectories],
  };

  nextConfig.overrides[skillName] = visibility;

  writeProjectSkillConfig(projectPath, nextConfig);
  return nextConfig;
}

function isInsideProject(projectPath: string, candidatePath: string): boolean {
  const relative = path.relative(projectPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function getAdditionalSkillQualifier(relativeDir: string): string {
  let normalized = relativeDir.replace(/\\/g, '/').replace(/\/+$/g, '');
  normalized = normalized.replace(/\/\.cdf\/skills$/g, '');
  normalized = normalized.replace(/\/skills$/g, '');
  normalized = normalized.replace(/^\.\//g, '');
  return normalized;
}

function toProjectRelativeQualifier(projectPath: string, sourceOwnerDir: string): string {
  return path.relative(projectPath, sourceOwnerDir).replace(/\\/g, '/');
}

function isDirectory(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function normalizeProjectRelativePath(value: string): string {
  return value
    .trim()
    .replace(/^@+/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//g, '')
    .replace(/^\/+/g, '');
}

function getPathContextMatchScore(
  skill: ResolvedSkillCatalogEntry,
  pathContext: string[] | undefined
): number {
  if (!skill.qualifier || !pathContext || pathContext.length === 0) return 0;
  const qualifier = normalizeProjectRelativePath(skill.qualifier);
  if (!qualifier) return 0;
  return pathContext.some((rawPath) => {
    const normalizedPath = normalizeProjectRelativePath(rawPath);
    return normalizedPath === qualifier || normalizedPath.startsWith(`${qualifier}/`);
  })
    ? 1
    : 0;
}

function sortSkillsByPathContext(
  skills: ResolvedSkillCatalogEntry[],
  pathContext: string[] | undefined
): ResolvedSkillCatalogEntry[] {
  if (!pathContext || pathContext.length === 0) return skills;
  return skills
    .map((skill, index) => ({
      skill,
      index,
      score: getPathContextMatchScore(skill, pathContext),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.skill);
}

function toShadowedSkill(skill: ResolvedSkillCatalogEntry): ShadowedSkillCatalogEntry {
  return {
    name: skill.name,
    qualifiedName: skill.qualifiedName,
    qualifier: skill.qualifier,
    description: skill.description,
    argumentHint: skill.argumentHint,
    allowedTools: skill.allowedTools,
    whenToUse: skill.whenToUse,
    arguments: skill.arguments,
    sourceKind: skill.sourceKind,
    sourcePath: skill.sourcePath,
    skillPath: skill.skillPath,
    visibility: skill.visibility,
    visibilitySource: skill.visibilitySource,
    modelDiscovery: skill.modelDiscovery,
    userInvocable: skill.userInvocable,
  };
}

function discoverNestedProjectSkillSources(projectPath: string): SkillSourceEntry[] {
  const normalizedProjectPath = path.resolve(projectPath);
  const cached = nestedProjectSkillSourceCache.get(normalizedProjectPath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.sources.map((source) => ({ ...source }));
  }

  const rootProjectSkillsDir = path.join(normalizedProjectPath, '.cdf', 'skills');
  const sources: SkillSourceEntry[] = [];

  const visit = (dir: string) => {
    const nestedSkillsDir = path.join(dir, '.cdf', 'skills');
    if (
      path.resolve(nestedSkillsDir) !== rootProjectSkillsDir &&
      isDirectory(nestedSkillsDir)
    ) {
      const qualifier = toProjectRelativeQualifier(normalizedProjectPath, dir);
      if (qualifier && !qualifier.startsWith('..') && !path.isAbsolute(qualifier)) {
        sources.push({
          kind: 'project-nested',
          path: nestedSkillsDir,
          qualifier,
        });
      }
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.cdf') continue;
      if (NESTED_PROJECT_SKILL_SCAN_IGNORED_DIRS.has(entry.name)) continue;
      visit(path.join(dir, entry.name));
    }
  };

  visit(normalizedProjectPath);
  nestedProjectSkillSourceCache.set(normalizedProjectPath, {
    expiresAt: Date.now() + NESTED_PROJECT_SKILL_SCAN_CACHE_TTL_MS,
    sources: sources.map((source) => ({ ...source })),
  });
  return sources;
}

export function resolveSkillSourcePlan(
  projectPath: string,
  options: SkillSourcePlanOptions = {}
): SkillSourcePlan {
  const { config, warnings } = readProjectSkillConfig(projectPath);
  const normalizedProjectPath = path.resolve(projectPath);
  const sources: SkillSourceEntry[] = [];

  for (const sourcePath of options.builtInSkillDirs ?? []) {
    sources.push({ kind: 'built-in', path: sourcePath });
  }

  const projectSkillsDir = path.join(projectPath, '.cdf', 'skills');
  if (fs.existsSync(projectSkillsDir)) {
    sources.push({ kind: 'project', path: projectSkillsDir });
  }

  if (options.includeNestedProjectSkills) {
    sources.push(...discoverNestedProjectSkillSources(projectPath));
  }

  for (const relativeDir of config.additionalSkillDirectories) {
    const sourcePath = path.resolve(normalizedProjectPath, relativeDir);
    if (isAbsolutePath(relativeDir) || !isInsideProject(normalizedProjectPath, sourcePath)) {
      warnings.push(`Rejected additionalSkillDirectories entry outside project: ${relativeDir}`);
      continue;
    }
    if (fs.existsSync(sourcePath)) {
      sources.push({
        kind: 'project-additional',
        path: sourcePath,
        qualifier: getAdditionalSkillQualifier(relativeDir),
      });
    }
  }

  if (options.userSkillsDir && fs.existsSync(options.userSkillsDir)) {
    sources.push({ kind: 'user', path: options.userSkillsDir });
  }

  for (const sourcePath of options.enterpriseSkillDirs ?? []) {
    sources.push({ kind: 'enterprise', path: sourcePath });
  }

  return {
    config,
    sources,
    warnings,
  };
}

export function resolveSkillCatalog(
  plan: SkillSourcePlan,
  options: SkillCatalogOptions = {}
): ResolvedSkillCatalog {
  const merged = new Map<string, ResolvedSkillCatalogEntry>();
  const warnings: string[] = [...plan.warnings];

  const addSkillDir = (source: SkillSourceEntry, skillDir: string) => {
    const skillPath = path.join(skillDir, 'SKILL.md');
    const parsed = parseSkillMetadata(skillDir);
    warnings.push(...parsed.warnings);
    if (!parsed.metadata) {
      if (fs.existsSync(skillPath)) {
        warnings.push(`Skipped ${skillPath}: ${parsed.errors.join('; ')}`);
      }
      return;
    }
    if (options.includeSkill && !options.includeSkill(source, parsed.metadata.name)) {
      return;
    }
    const qualifiedName = source.qualifier
      ? `${source.qualifier}:${parsed.metadata.name}`
      : parsed.metadata.name;
    const visibility = resolveSkillVisibility({
      name: parsed.metadata.name,
      qualifiedName,
      frontmatter: {
        disableModelInvocation: parsed.metadata.disableModelInvocation,
        userInvocable: parsed.metadata.userInvocable,
      },
      // Scene exposure replaces legacy Override policy for Global Skills. Keep
      // old override records readable for the migration tickets, but never let
      // a stale hidden state erase a Global catalog entry before Scene policy.
      overrides: classifyGlobalSource(source.kind)
        ? undefined
        : {
          user: options.userOverrides,
          project: plan.config.overrides,
          agent: options.agentOverrides,
        },
    });
    const mergeKey = source.qualifier ? qualifiedName : parsed.metadata.name;
    const existing = merged.get(mergeKey);
    const entry: ResolvedSkillCatalogEntry = {
      name: parsed.metadata.name,
      qualifiedName,
      qualifier: source.qualifier,
      description: parsed.metadata.description,
      argumentHint: parsed.metadata.argumentHint,
      allowedTools: parsed.metadata.allowedTools,
      whenToUse: parsed.metadata.whenToUse,
      arguments: parsed.metadata.arguments,
      sourceKind: source.kind,
      sourcePath: source.path,
      skillPath,
      visibility: visibility.visibility,
      visibilitySource: visibility.visibilitySource,
      modelDiscovery: visibility.modelDiscovery,
      userInvocable: visibility.userInvocable,
      shadowedSkills: existing
        ? [...(existing.shadowedSkills ?? []), toShadowedSkill(existing)]
        : undefined,
    };
    merged.set(mergeKey, entry);
  };

  for (const source of plan.sources) {
    if (!fs.existsSync(source.path)) continue;
    if (fs.existsSync(path.join(source.path, 'SKILL.md'))) {
      addSkillDir(source, source.path);
      continue;
    }
    const entries = fs.readdirSync(source.path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(source.path, entry.name);
      addSkillDir(source, skillDir);
    }
  }

  const mergedSkills = Array.from(merged.values());
  return {
    skills: options.includeNestedProjectSkills
      ? sortSkillsByPathContext(mergedSkills, options.pathContext)
      : mergedSkills,
    warnings,
  };
}
