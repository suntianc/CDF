import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { tool } from '@langchain/core/tools';
import type {
  KnowledgeEntryCreateInput,
  KnowledgeEntrySearchOptions,
  KnowledgeEntrySummary,
  KnowledgeEntryUpdateInput,
} from '../shared/types';

const KNOWLEDGE_SEARCH_SCHEMA = {
  type: 'object' as const,
  properties: {
    keyword: { type: 'string', description: 'Optional keyword to match title, tags, selected source fields, or Markdown body.' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tags to filter Knowledge Entries.',
    },
    tagMatch: {
      type: 'string',
      enum: ['all', 'any'],
      description: 'Whether all tags or any tag must match. Defaults to all.',
    },
    dateField: {
      type: 'string',
      enum: ['created_at', 'updated_at', 'source_date'],
      description: 'Date field to use for dateFrom/dateTo filtering.',
    },
    dateFrom: { type: 'string', description: 'Optional inclusive date lower bound.' },
    dateTo: { type: 'string', description: 'Optional inclusive date upper bound.' },
    sortBy: {
      type: 'string',
      enum: ['updated_at', 'created_at', 'source_date', 'title'],
      description: 'Optional sort field.',
    },
    sortOrder: {
      type: 'string',
      enum: ['asc', 'desc'],
      description: 'Optional sort order.',
    },
    limit: { type: 'number', description: 'Maximum number of entries to return.' },
  },
  additionalProperties: false,
};

const KNOWLEDGE_CREATE_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string', description: 'Knowledge Entry title.' },
    body: { type: 'string', description: 'Markdown body content for the Knowledge Entry.' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tags for the Knowledge Entry.',
    },
    source: {
      type: 'object',
      description: 'Optional structured source metadata. Defaults to { type: "agent" }.',
      additionalProperties: true,
    },
    relativePath: {
      type: 'string',
      description: 'Optional Knowledge Base-relative .md path. If omitted, CDF generates one from title.',
    },
  },
  required: ['title', 'body'],
  additionalProperties: false,
};

export function getKnowledgeBaseRoot(projectPath: string): string {
  return path.join(projectPath, '.cdf', 'knowledge');
}

export function ensureKnowledgeBase(projectPath: string): void {
  const root = getKnowledgeBaseRoot(projectPath);
  fs.mkdirSync(root, { recursive: true });

  const indexPath = path.join(root, 'index.md');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      '# Knowledge Base\n\nThis directory stores project-local knowledge entries in Open Knowledge Format.\n',
      'utf-8',
    );
  }

  const logPath = path.join(root, 'log.md');
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(
      logPath,
      '# Knowledge Base Log\n\nChronological notes about meaningful additions, updates, imports, and reorganizations in this Knowledge Base.\n',
      'utf-8',
    );
  }
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isReservedKnowledgeFile(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return name === 'index.md' || name === 'log.md';
}

function resolveKnowledgeEntryPath(projectPath: string, relativePath: string): string {
  const root = getKnowledgeBaseRoot(projectPath);
  const normalized = relativePath.split('\\').join('/').trim();
  if (!normalized || path.isAbsolute(normalized)) {
    throw new Error('Knowledge Entry path must be a relative Markdown path.');
  }
  if (!normalized.toLowerCase().endsWith('.md')) {
    throw new Error('Knowledge Entry path must end with .md.');
  }
  if (normalized.split('/').some((part) => part === '..' || part === '' || part.startsWith('.'))) {
    throw new Error('Knowledge Entry path contains an unsafe segment.');
  }
  if (isReservedKnowledgeFile(normalized)) {
    throw new Error('Knowledge Entry path cannot be an OKF reserved file.');
  }
  const target = path.resolve(root, normalized);
  const relativeToRoot = path.relative(root, target);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('Knowledge Entry path escapes the Knowledge Base root.');
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      throw new Error('Knowledge Entry path cannot be a symlink.');
    }
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    const realRelative = path.relative(realRoot, realTarget);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error('Knowledge Entry path escapes the Knowledge Base root.');
    }
  }
  return target;
}

function stringifyKnowledgeEntry(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trimEnd()}\n`;
}

function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'knowledge-entry';
}

function generateAvailableRelativePath(projectPath: string, title: string): string {
  const base = slugifyTitle(title);
  let candidate = `${base}.md`;
  let suffix = 2;
  while (fs.existsSync(resolveKnowledgeEntryPath(projectPath, candidate))) {
    candidate = `${base}-${suffix}.md`;
    suffix += 1;
  }
  return candidate;
}

function collectMarkdownFiles(root: string, currentDir = root): string[] {
  if (!fs.existsSync(currentDir)) return [];

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(root, absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !isReservedKnowledgeFile(absolutePath)) {
      files.push(absolutePath);
    }
  }
  return files;
}

function parseKnowledgeEntry(filePath: string): Omit<KnowledgeEntrySummary, 'relativePath'> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const warnings: string[] = [];
  let invalidFrontmatter = false;
  let frontmatter: Record<string, unknown> = {};
  let body = content;

  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---', 4);
    if (end === -1) {
      warnings.push('Invalid frontmatter: missing closing delimiter');
      invalidFrontmatter = true;
    } else {
      const rawFrontmatter = content.slice(4, end);
      const bodyStart = end + '\n---'.length;
      body = content.slice(content[bodyStart] === '\n' ? bodyStart + 1 : bodyStart);
      try {
        const parsed = YAML.parse(rawFrontmatter);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          frontmatter = parsed as Record<string, unknown>;
        } else {
          warnings.push('Invalid frontmatter: expected object');
          invalidFrontmatter = true;
        }
      } catch (error) {
        warnings.push(`Invalid frontmatter: ${error instanceof Error ? error.message : String(error)}`);
        invalidFrontmatter = true;
      }
    }
  }

  for (const field of ['id', 'title', 'tags', 'created_at', 'updated_at', 'source']) {
    if (!(field in frontmatter)) {
      warnings.push(`Missing managed field: ${field}`);
    }
  }

  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  return {
    title: typeof frontmatter.title === 'string' ? frontmatter.title : undefined,
    tags,
    body: body.trim(),
    frontmatter,
    warnings,
    invalidFrontmatter,
  };
}

export function listKnowledgeEntries(
  projectPath: string,
  _options: KnowledgeEntrySearchOptions = {},
): KnowledgeEntrySummary[] {
  ensureKnowledgeBase(projectPath);
  const root = getKnowledgeBaseRoot(projectPath);
  return collectMarkdownFiles(root)
    .map((filePath) => ({
      relativePath: toPosixPath(path.relative(root, filePath)),
      ...parseKnowledgeEntry(filePath),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function readKnowledgeEntry(projectPath: string, relativePath: string): KnowledgeEntrySummary {
  ensureKnowledgeBase(projectPath);
  const root = getKnowledgeBaseRoot(projectPath);
  const filePath = resolveKnowledgeEntryPath(projectPath, relativePath);
  const relative = toPosixPath(path.relative(root, filePath));
  return {
    relativePath: relative,
    ...parseKnowledgeEntry(filePath),
  };
}

export function createKnowledgeEntry(
  projectPath: string,
  input: KnowledgeEntryCreateInput,
): KnowledgeEntrySummary {
  ensureKnowledgeBase(projectPath);
  const relativePath = input.relativePath ?? generateAvailableRelativePath(projectPath, input.title);
  const filePath = resolveKnowledgeEntryPath(projectPath, relativePath);
  if (fs.existsSync(filePath)) {
    throw new Error(`Knowledge Entry already exists: ${relativePath}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const now = new Date().toISOString();
  const frontmatter: Record<string, unknown> = {
    id: crypto.randomUUID(),
    title: input.title,
    tags: input.tags ?? [],
    created_at: now,
    updated_at: now,
    source: input.source ?? { type: 'manual' },
  };
  fs.writeFileSync(filePath, stringifyKnowledgeEntry(frontmatter, input.body ?? ''), 'utf-8');
  return readKnowledgeEntry(projectPath, relativePath);
}

export function updateKnowledgeEntry(
  projectPath: string,
  relativePath: string,
  input: KnowledgeEntryUpdateInput,
): KnowledgeEntrySummary {
  ensureKnowledgeBase(projectPath);
  const filePath = resolveKnowledgeEntryPath(projectPath, relativePath);
  const existing = parseKnowledgeEntry(filePath);
  if (existing.invalidFrontmatter) {
    throw new Error('Cannot update Knowledge Entry with invalid frontmatter.');
  }
  const now = new Date().toISOString();
  const frontmatter: Record<string, unknown> = {
    ...existing.frontmatter,
    id: typeof existing.frontmatter.id === 'string' ? existing.frontmatter.id : crypto.randomUUID(),
    title: input.title ?? existing.title ?? path.basename(relativePath, '.md'),
    tags: input.tags ?? existing.tags,
    created_at: typeof existing.frontmatter.created_at === 'string' ? existing.frontmatter.created_at : now,
    updated_at: now,
    source: input.source ?? (
      existing.frontmatter.source && typeof existing.frontmatter.source === 'object' && !Array.isArray(existing.frontmatter.source)
        ? existing.frontmatter.source
        : { type: 'manual' }
    ),
  };
  const body = input.body ?? existing.body;
  fs.writeFileSync(filePath, stringifyKnowledgeEntry(frontmatter, body), 'utf-8');
  return readKnowledgeEntry(projectPath, relativePath);
}

export function deleteKnowledgeEntry(projectPath: string, relativePath: string): { deleted: true } {
  ensureKnowledgeBase(projectPath);
  const filePath = resolveKnowledgeEntryPath(projectPath, relativePath);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error('Cannot delete symlinked Knowledge Entry.');
  }
  if (!stat.isFile()) {
    throw new Error('Knowledge Entry path is not a file.');
  }
  fs.unlinkSync(filePath);
  return { deleted: true };
}

function matchesTags(entry: KnowledgeEntrySummary, tags: string[] | undefined, tagMatch: 'all' | 'any'): boolean {
  if (!tags || tags.length === 0) return true;
  const entryTags = new Set(entry.tags.map((tag) => tag.toLowerCase()));
  const requestedTags = tags.map((tag) => tag.toLowerCase());
  if (tagMatch === 'any') {
    return requestedTags.some((tag) => entryTags.has(tag));
  }
  return requestedTags.every((tag) => entryTags.has(tag));
}

function getSourceText(frontmatter: Record<string, unknown>): string[] {
  const source = frontmatter.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
  const sourceRecord = source as Record<string, unknown>;
  return [sourceRecord.type, sourceRecord.url, sourceRecord.title]
    .filter((value): value is string => typeof value === 'string');
}

function matchesKeyword(entry: KnowledgeEntrySummary, keyword: string | undefined): boolean {
  const normalized = keyword?.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    entry.title,
    ...entry.tags,
    ...getSourceText(entry.frontmatter),
    entry.body,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .toLowerCase();
  return haystack.includes(normalized);
}

function getDateFieldValue(entry: KnowledgeEntrySummary, dateField: 'created_at' | 'updated_at' | 'source_date'): string | undefined {
  if (dateField === 'source_date') {
    const source = entry.frontmatter.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
    const value = (source as Record<string, unknown>).date;
    return typeof value === 'string' ? value : undefined;
  }
  const value = entry.frontmatter[dateField];
  return typeof value === 'string' ? value : undefined;
}

function parseDateTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

function matchesDateRange(entry: KnowledgeEntrySummary, options: KnowledgeEntrySearchOptions): boolean {
  if (!options.dateFrom && !options.dateTo) return true;
  const dateField = options.dateField ?? 'updated_at';
  const entryTime = parseDateTime(getDateFieldValue(entry, dateField));
  if (entryTime === undefined) return false;
  const fromTime = parseDateTime(options.dateFrom);
  const toTime = parseDateTime(options.dateTo);
  if (fromTime !== undefined && entryTime < fromTime) return false;
  if (toTime !== undefined && entryTime > toTime) return false;
  return true;
}

function compareEntries(a: KnowledgeEntrySummary, b: KnowledgeEntrySummary, options: KnowledgeEntrySearchOptions): number {
  const sortBy = options.sortBy;
  if (!sortBy) return a.relativePath.localeCompare(b.relativePath);
  const direction = options.sortOrder === 'desc' ? -1 : 1;
  if (sortBy === 'title') {
    return direction * (a.title ?? '').localeCompare(b.title ?? '');
  }
  const aTime = parseDateTime(getDateFieldValue(a, sortBy)) ?? 0;
  const bTime = parseDateTime(getDateFieldValue(b, sortBy)) ?? 0;
  return direction * (aTime - bTime || a.relativePath.localeCompare(b.relativePath));
}

export function searchKnowledgeEntries(
  projectPath: string,
  options: KnowledgeEntrySearchOptions = {},
): KnowledgeEntrySummary[] {
  const tagMatch = options.tagMatch ?? 'all';
  const entries = listKnowledgeEntries(projectPath)
    .filter((entry) => (
      matchesTags(entry, options.tags, tagMatch)
      && matchesKeyword(entry, options.keyword)
      && matchesDateRange(entry, options)
    ))
    .sort((a, b) => compareEntries(a, b, options));
  return typeof options.limit === 'number' && options.limit >= 0 ? entries.slice(0, options.limit) : entries;
}

export function createKnowledgeSearchTool(projectPath: string) {
  return tool(
    async (input: KnowledgeEntrySearchOptions) => {
      const entries = searchKnowledgeEntries(projectPath, input).map((entry) => ({
        relativePath: entry.relativePath,
        title: entry.title,
        tags: entry.tags,
        warnings: entry.warnings,
      }));
      return JSON.stringify({ success: true, entries });
    },
    {
      name: 'knowledge_search',
      description: 'Search project-local Knowledge Entries stored under .cdf/knowledge. Returns relative paths so you can read matching entries with read_file. Does not read, create, update, or delete entries.',
      schema: KNOWLEDGE_SEARCH_SCHEMA,
    },
  );
}

export function createKnowledgeCreateTool(projectPath: string) {
  return tool(
    async (input: KnowledgeEntryCreateInput) => {
      try {
        const entry = createKnowledgeEntry(projectPath, {
          ...input,
          source: input.source ?? { type: 'agent' },
        });
        return JSON.stringify({
          success: true,
          entry: {
            relativePath: entry.relativePath,
            title: entry.title,
            tags: entry.tags,
            warnings: entry.warnings,
          },
          logHint: 'For meaningful additions, imports, or reorganizations, append a brief note to .cdf/knowledge/log.md with edit_file.',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    {
      name: 'knowledge_create',
      description: 'Create a project-local Knowledge Entry under .cdf/knowledge with managed OKF frontmatter, safe path handling, and collision protection. Does not update or delete entries.',
      schema: KNOWLEDGE_CREATE_SCHEMA,
    },
  );
}
