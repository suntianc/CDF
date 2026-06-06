import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';
import type { ParsedFrontmatter, SlashCommand } from '../../shared/types';

/** D-20 / Phase 6: original hand-rolled frontmatter fields. 08.2 keeps them
 *  on the new typed return shape for back-compat with consumers that read
 *  `fm.name` / `fm.description` / `fm['argument-hint']` as strings. */
export interface CommandFrontmatter extends ParsedFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
}

const FRONTMATTER_START = '---\n';
const FRONTMATTER_END = '\n---';

/**
 * Parse YAML frontmatter from a `.md` file. Returns an empty object when:
 * - the file does not exist
 * - the file does not start with `---`
 * - the closing `---` marker is missing
 *
 * 08.2 D-08 / D-10: backed by `yaml@2.9.0` for proper boolean / array coercion.
 * Returns a typed `CommandFrontmatter` (extends `ParsedFrontmatter`) so consumers
 * get `boolean | string[]` instead of the raw string.
 *
 * D-10 defaults (applied here so downstream can rely on stable shape):
 *   disableModelInvocation: undefined  // not defaulted; absence means false
 *   userInvocable:           true
 *   allowedTools:            []
 *   whenToUse:               ''
 *   arguments:               []
 */
export function parseFrontmatter(filePath: string): CommandFrontmatter {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.startsWith(FRONTMATTER_START)) return {};

  const end = content.indexOf(FRONTMATTER_END, FRONTMATTER_START.length);
  if (end === -1) return {};

  const raw = content.slice(FRONTMATTER_START.length, end);
  // yaml@2.9.0 parse — returns { key: typedValue } where booleans/arrays/strings
  // are correctly typed. `?? {}` guards against a top-level scalar (single-line
  // frontmatter that YAML.parse resolves to a non-object).
  const parsed = (YAML.parse(raw) ?? {}) as Record<string, unknown>;

  return {
    name: typeof parsed['name'] === 'string' ? (parsed['name'] as string) : undefined,
    description:
      typeof parsed['description'] === 'string' ? (parsed['description'] as string) : undefined,
    'argument-hint':
      typeof parsed['argument-hint'] === 'string'
        ? (parsed['argument-hint'] as string)
        : undefined,
    // D-10 defaults — keep stable shape downstream
    disableModelInvocation:
      typeof parsed['disable-model-invocation'] === 'boolean'
        ? (parsed['disable-model-invocation'] as boolean)
        : undefined,
    userInvocable:
      typeof parsed['user-invocable'] === 'boolean'
        ? (parsed['user-invocable'] as boolean)
        : true,
    allowedTools: Array.isArray(parsed['allowed-tools'])
      ? (parsed['allowed-tools'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
    whenToUse:
      typeof parsed['when_to_use'] === 'string' ? (parsed['when_to_use'] as string) : '',
    arguments: Array.isArray(parsed['arguments'])
      ? (parsed['arguments'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
  };
}

function listCommandsInDir(
  dir: string,
  source: 'cmd:system' | 'cmd:project'
): SlashCommand[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const filePath = path.join(dir, file);
      let fm: CommandFrontmatter;
      try {
        fm = parseFrontmatter(filePath);
      } catch (err) {
        console.warn('[project-commands] invalid frontmatter ignored:', filePath, err);
        fm = {};
      }
      // D-09 when_to_use 拼接 (Claude Code behavior): append soft hint to
      // description so the LLM can decide when to auto-trigger. Only when
      // whenToUse is non-empty (otherwise the original description is kept verbatim).
      const baseDescription = fm.description || '';
      const whenToUse = fm.whenToUse?.trim() || '';
      const description = whenToUse
        ? `${baseDescription}\n\n何时使用：${whenToUse}`
        : baseDescription;
      return {
        name: fm.name || file.replace(/\.md$/, ''),
        description,
        source,
        target: filePath,
        sourceLabel: source,
        badge: `[${source}]`,
        argumentHint: fm['argument-hint'],
        // D-05: absolute path so dispatcher can lazy-load body on Enter
        bodyPath: filePath,
        // D-07: pre-parsed frontmatter for downstream consumers
        frontmatter: {
          disableModelInvocation: fm.disableModelInvocation,
          userInvocable: fm.userInvocable,
          allowedTools: fm.allowedTools,
          whenToUse: fm.whenToUse,
          arguments: fm.arguments,
        },
      } as SlashCommand;
    });
}

/** D-19: system-level custom commands live in `~/.cdf/commands/*.md`. */
export function listSystemCommands(): SlashCommand[] {
  return listCommandsInDir(path.join(os.homedir(), '.cdf', 'commands'), 'cmd:system');
}

/** D-19: project-level custom commands live in `<projectPath>/.cdf/commands/*.md`. */
export function listProjectCommands(projectPath: string): SlashCommand[] {
  return listCommandsInDir(path.join(projectPath, '.cdf', 'commands'), 'cmd:project');
}
