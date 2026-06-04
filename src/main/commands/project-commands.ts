import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SlashCommand } from '../../shared/types';

/** D-20: frontmatter fields recognized in custom command `.md` files. */
export interface CommandFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
}

const FRONTMATTER_START = '---\n';
const FRONTMATTER_END = '\n---';

/**
 * Parse YAML-ish frontmatter from a `.md` file. Returns an empty object when:
 * - the file does not exist
 * - the file does not start with `---`
 * - the closing `---` marker is missing
 *
 * NOTE: this is a minimal parser (key: value, one per line). It does NOT
 * handle multi-line strings or block scalars — those are Phase 7+ work. The
 * D-20 spec only requires `name` / `description` / `argument-hint`, all
 * single-line values.
 */
export function parseFrontmatter(filePath: string): CommandFrontmatter {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.startsWith(FRONTMATTER_START)) return {};

  const end = content.indexOf(FRONTMATTER_END, FRONTMATTER_START.length);
  if (end === -1) return {};

  const body = content.slice(FRONTMATTER_START.length, end);
  const result: CommandFrontmatter = {};
  for (const line of body.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!key) continue;
    (result as Record<string, string>)[key] = value;
  }
  return result;
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
      const fm = parseFrontmatter(filePath);
      return {
        name: fm.name || file.replace(/\.md$/, ''),
        description: fm.description || '',
        source,
        target: filePath,
        sourceLabel: source,
        badge: `[${source}]`,
        argumentHint: fm['argument-hint'],
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
