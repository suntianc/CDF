import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { parseFrontmatterStringList } from '../../frontmatter-list';

export interface SkillMetadata {
  name: string;
  description: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  argumentHint?: string;
  allowedTools: string[];
  arguments: string[];
  whenToUse: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  module?: string;
}

export interface SkillMetadataParseResult {
  metadata?: SkillMetadata;
  errors: string[];
  warnings: string[];
}

const FRONTMATTER_START = '---\n';
const FRONTMATTER_END = '\n---';
const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
const SKILL_MODULE_EXTENSIONS = [
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
];

export function validateSkillName(name: string, directoryName?: string): string[] {
  const errors: string[] = [];
  if (!name) {
    errors.push('Skill 名称不能为空');
    return errors;
  }
  if (!SKILL_NAME_PATTERN.test(name) || name.includes('--')) {
    errors.push(
      `Skill 名称 "${name}" 无效：必须为 1-64 个小写字母、数字或连字符，不能以连字符开头或结尾，不能包含连续连字符`
    );
  }
  if (directoryName !== undefined && directoryName !== name) {
    errors.push(
      `Skill 名称必须与目录名一致：目录名 "${directoryName}"，frontmatter name "${name}"`
    );
  }
  return errors;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith(FRONTMATTER_START)) return null;
  const end = content.indexOf(FRONTMATTER_END, FRONTMATTER_START.length);
  if (end === -1) return null;
  const raw = content.slice(FRONTMATTER_START.length, end);
  const parsed = YAML.parse(raw) ?? {};
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function hasSupportedModuleExtension(value: string): boolean {
  return SKILL_MODULE_EXTENSIONS.some((extension) => value.endsWith(extension));
}

function validateModulePath(raw: unknown, skillPath: string): {
  module?: string;
  warning?: string;
} {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'string') {
    return { warning: `Ignored invalid module metadata in ${skillPath}: expected string` };
  }

  const stripped = raw.trim();
  if (!stripped) return {};
  const normalized = stripped.startsWith('./') ? stripped.slice(2) : stripped;
  const portable = normalized.replace(/\\/g, '/');
  const invalid =
    path.isAbsolute(stripped) ||
    path.win32.isAbsolute(stripped) ||
    portable === '..' ||
    portable.startsWith('../') ||
    portable.includes('/../') ||
    portable.endsWith('/..') ||
    portable.endsWith('.d.ts') ||
    portable.endsWith('.d.mts') ||
    portable.endsWith('.d.cts') ||
    !hasSupportedModuleExtension(portable);

  return invalid
    ? { warning: `Ignored invalid module metadata in ${skillPath}: ${stripped}` }
    : { module: stripped };
}

export function parseSkillMetadata(skillDir: string): SkillMetadataParseResult {
  const skillPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    return {
      errors: [`缺少 SKILL.md：${skillPath}`],
      warnings: [],
    };
  }

  let parsed: Record<string, unknown> | null;
  try {
    parsed = parseFrontmatter(fs.readFileSync(skillPath, 'utf-8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      errors: [`解析 SKILL.md 失败：${skillPath}：${message}`],
      warnings: [],
    };
  }

  if (!parsed) {
    return {
      errors: [`缺少 YAML frontmatter：${skillPath}`],
      warnings: [],
    };
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  let description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!name) errors.push(`Skill 元数据 name 不能为空：${skillPath}`);
  if (!description) errors.push(`Skill 元数据 description 不能为空：${skillPath}`);
  if (name) errors.push(...validateSkillName(name, path.basename(skillDir)));
  if (errors.length > 0) {
    return { errors, warnings };
  }

  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    warnings.push(`Skill description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters in ${skillPath}, truncating`);
    description = description.slice(0, MAX_SKILL_DESCRIPTION_LENGTH);
  }
  const modulePath = validateModulePath(parsed.module, skillPath);
  if (modulePath.warning) warnings.push(modulePath.warning);

  return {
    metadata: {
      name,
      description,
      disableModelInvocation:
        typeof parsed['disable-model-invocation'] === 'boolean'
          ? parsed['disable-model-invocation']
          : undefined,
      userInvocable:
        typeof parsed['user-invocable'] === 'boolean'
          ? parsed['user-invocable']
          : undefined,
      argumentHint:
        typeof parsed['argument-hint'] === 'string'
          ? parsed['argument-hint']
          : undefined,
      allowedTools: parseFrontmatterStringList(parsed['allowed-tools']),
      arguments: parseFrontmatterStringList(parsed.arguments),
      whenToUse: typeof parsed.when_to_use === 'string' ? parsed.when_to_use : '',
      license: typeof parsed.license === 'string' ? parsed.license : undefined,
      compatibility:
        typeof parsed.compatibility === 'string' ? parsed.compatibility : undefined,
      metadata:
        parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata)
          ? parsed.metadata as Record<string, unknown>
          : undefined,
      module: modulePath.module,
    },
    errors: [],
    warnings,
  };
}
