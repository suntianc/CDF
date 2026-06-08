import { tool } from '@langchain/core/tools';
import { XMLParser } from 'fast-xml-parser';
import type { SearchProviderConfig } from './search-tools';

// ---------- 数据类型 ----------
export interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  summary: string;
  published: string;
  updated: string;
  categories: string[];
  primaryCategory: string;
  doi: string;
  journalRef: string;
  comment: string;
  pdfLink: string;
  abstractLink: string;
}

export interface ArxivFeedMetadata {
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
}

export interface ArxivSearchResponse {
  metadata: ArxivFeedMetadata;
  papers: ArxivPaper[];
}

type ArxivField = 'all' | 'ti' | 'au' | 'abs' | 'co' | 'jr' | 'cat' | 'rn';
type ArxivSortBy = 'relevance' | 'lastUpdatedDate' | 'submittedDate';
type ArxivSortOrder = 'ascending' | 'descending';

export interface ArxivSearchOptions {
  query?: string;
  searchQuery?: string;
  ids?: string[];
  maxResults?: number;
  start?: number;
  field?: ArxivField;
  sortBy?: ArxivSortBy;
  sortOrder?: ArxivSortOrder;
}

// ---------- XML 解析器 ----------
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

function textValue(value: unknown): string {
  return value?.toString().replace(/\s+/g, ' ').trim() ?? '';
}

function arrayValue<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseArxivResponse(xml: string): ArxivSearchResponse {
  const json = parser.parse(xml);
  const feed = json.feed;
  if (!feed) {
    return {
      metadata: { totalResults: 0, startIndex: 0, itemsPerPage: 0 },
      papers: [],
    };
  }

  const entries = arrayValue(feed.entry);
  const papers = entries.map((entry: any) => {
    const id = entry.id?.toString().split('/abs/').pop() ?? '';
    const authors = arrayValue(entry.author)
      .map((a: any) => textValue(a.name))
      .filter(Boolean);

    const links = arrayValue(entry.link);
    const pdfLinkObj = links.find(
      (l: any) => l['@_title']?.toLowerCase() === 'pdf'
    );
    const abstractLinkObj = links.find(
      (l: any) => !l['@_title'] || l['@_rel'] === 'alternate'
    );
    const categories = arrayValue(entry.category)
      .map((category: any) => textValue(category['@_term']))
      .filter(Boolean);

    return {
      id,
      title: textValue(entry.title),
      authors,
      summary: textValue(entry.summary),
      published: entry.published?.toString() ?? '',
      updated: entry.updated?.toString() ?? '',
      categories,
      primaryCategory: textValue(entry.primary_category?.['@_term']),
      doi: textValue(entry.doi),
      journalRef: textValue(entry.journal_ref),
      comment: textValue(entry.comment),
      pdfLink: pdfLinkObj?.['@_href'] ?? '',
      abstractLink: abstractLinkObj?.['@_href'] ?? entry.id ?? '',
    };
  });

  return {
    metadata: {
      totalResults: Number(feed.totalResults ?? papers.length),
      startIndex: Number(feed.startIndex ?? 0),
      itemsPerPage: Number(feed.itemsPerPage ?? papers.length),
    },
    papers,
  };
}

function looksLikeArxivQuerySyntax(query: string): boolean {
  return /\b(ti|au|abs|co|jr|cat|rn|all):|submittedDate:|\b(AND|OR|ANDNOT)\b|[()"]/.test(query);
}

function buildSearchQuery(input: Pick<ArxivSearchOptions, 'query' | 'searchQuery' | 'field'>): string | undefined {
  const searchQuery = input.searchQuery?.trim();
  if (searchQuery) return searchQuery;

  const query = input.query?.trim();
  if (!query) return undefined;
  if (!input.field && looksLikeArxivQuerySyntax(query)) return query;

  return `${input.field ?? 'all'}:${query}`;
}

function clampInteger(value: number | undefined, defaultValue: number, min: number, max: number): number {
  const v = value ?? defaultValue;
  if (!Number.isFinite(v)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function normalizeIds(ids: string[] | undefined): string[] {
  return (ids ?? [])
    .map((id) => id.trim())
    .filter(Boolean);
}

// ---------- 核心搜索函数 ----------
export async function searchArxiv(
  options: string | ArxivSearchOptions,
  maxResults: number = 5,
  start: number = 0
): Promise<ArxivSearchResponse> {
  const normalizedOptions: ArxivSearchOptions = typeof options === 'string'
    ? { query: options, maxResults, start }
    : options;

  const searchQuery = buildSearchQuery(normalizedOptions);
  const ids = normalizeIds(normalizedOptions.ids);
  if (!searchQuery && ids.length === 0) {
    throw new Error('必须提供 query、searchQuery 或 ids。');
  }

  const params = new URLSearchParams();
  if (searchQuery) params.set('search_query', searchQuery);
  if (ids.length > 0) params.set('id_list', ids.join(','));
  params.set('start', String(clampInteger(normalizedOptions.start, 0, 0, 30000)));
  params.set('max_results', String(clampInteger(normalizedOptions.maxResults, 5, 1, 2000)));
  params.set('sortBy', normalizedOptions.sortBy ?? 'relevance');
  params.set('sortOrder', normalizedOptions.sortOrder ?? 'descending');

  const url = `https://export.arxiv.org/api/query?${params.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`arXiv API 请求失败: ${response.status}${body ? ` ${textValue(body).slice(0, 200)}` : ''}`);
  }
  const xml = await response.text();
  return parseArxivResponse(xml);
}

// ---------- 结果转为 LLM 可读文本 ----------
function formatPapersForLLM(papers: ArxivPaper[]): string {
  if (papers.length === 0) return '没有找到匹配的论文。';
  return papers
    .map(
      (p, i) =>
        `### ${i + 1}. ${p.title}\n` +
        `- 作者：${p.authors.join(', ')}\n` +
        `- 发布日期：${p.published}\n` +
        `- 摘要：${p.summary.slice(0, 300)}...\n` +
        `- PDF：${p.pdfLink}\n`
    )
    .join('\n');
}

// ---------- 输入类型 ----------
interface ArxivInput {
  query?: string;
  searchQuery?: string;
  ids?: string[];
  maxResults?: number;
  start?: number;
  field?: ArxivField;
  sortBy?: ArxivSortBy;
  sortOrder?: ArxivSortOrder;
}

// ---------- JSON Schema ----------
const ARXIV_SCHEMA = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description: '普通搜索关键词。若包含 arXiv 高级语法（如 au:、ti:、AND、submittedDate）会原样发送。',
    },
    searchQuery: {
      type: 'string',
      description: '原样传给 arXiv 的 search_query，高级查询优先使用此字段，如 `cat:cs.AI AND submittedDate:[202501010000 TO 202601010000]`。',
    },
    ids: {
      type: 'array',
      items: { type: 'string' },
      description: '一个或多个 arXiv ID，用 id_list 批量获取或配合 searchQuery 过滤，如 ["1706.03762", "1605.08386v1"]。',
    },
    maxResults: {
      type: 'number',
      description: '返回的最大论文数（1-2000），默认 5',
    },
    start: {
      type: 'number',
      description: '结果的起始偏移，用于分页，默认 0',
    },
    field: {
      type: 'string',
      enum: ['all', 'ti', 'au', 'abs', 'co', 'jr', 'cat', 'rn'],
      description: '普通 query 的搜索字段：all、ti、au、abs、co、jr、cat、rn，默认 all。',
    },
    sortBy: {
      type: 'string',
      enum: ['relevance', 'lastUpdatedDate', 'submittedDate'],
      description: '排序字段，默认 relevance。',
    },
    sortOrder: {
      type: 'string',
      enum: ['ascending', 'descending'],
      description: '排序方向，默认 descending。',
    },
  },
  required: [],
  additionalProperties: false,
};

const ARXIV_GET_SCHEMA = {
  type: 'object' as const,
  properties: {
    ids: {
      type: 'array',
      items: { type: 'string' },
      description: '一个或多个 arXiv ID，支持版本号，如 ["1706.03762", "1605.08386v1"]。',
    },
  },
  required: ['ids'],
  additionalProperties: false,
};

// ---------- 供 Agent 使用的工具定义 ----------
export function createArxivTool(providerConfig: SearchProviderConfig | null) {
  const searchTool = tool(
    async (input: ArxivInput) => {
      if (!providerConfig) {
        return JSON.stringify({
          success: false,
          error: 'arXiv 搜索工具未启用。请在工具设置中启用 arXiv。',
          papers: [],
        });
      }

      const { query, searchQuery, ids, maxResults = 5, start = 0, field, sortBy, sortOrder } = input;
      const config = providerConfig.config as {
        max_results?: number;
        sort_by?: ArxivSortBy;
        sort_order?: ArxivSortOrder;
      };
      const effectiveMax = config?.max_results ?? maxResults;

      try {
        const result = await searchArxiv({
          query,
          searchQuery,
          ids,
          maxResults: effectiveMax,
          start,
          field,
          sortBy: sortBy ?? config?.sort_by,
          sortOrder: sortOrder ?? config?.sort_order,
        });
        return JSON.stringify({
          success: true,
          total_results: result.metadata.totalResults,
          returned_results: result.papers.length,
          start_index: result.metadata.startIndex,
          items_per_page: result.metadata.itemsPerPage,
          papers: result.papers,
          content: formatPapersForLLM(result.papers),
        });
      } catch (err) {
        console.error('arXiv search failed:', err);
        return JSON.stringify({
          success: false,
          error: `arXiv 搜索失败：${err instanceof Error ? err.message : String(err)}`,
          papers: [],
        });
      }
    },
    {
      name: 'arxiv_search',
      description:
        '在 arXiv 上搜索学术论文，返回匹配的论文标题、作者、摘要及链接。适用于需要查找最新研究或特定领域文献的场景。',
      schema: ARXIV_SCHEMA,
    }
  );

  const getTool = tool(
    async (input: { ids: string[] }) => {
      if (!providerConfig) {
        return JSON.stringify({
          success: false,
          error: 'arXiv 搜索工具未启用。请在工具设置中启用 arXiv。',
          papers: [],
        });
      }

      try {
        const result = await searchArxiv({
          ids: input.ids,
          maxResults: input.ids.length || 1,
        });
        return JSON.stringify({
          success: true,
          total_results: result.metadata.totalResults,
          returned_results: result.papers.length,
          papers: result.papers,
          content: formatPapersForLLM(result.papers),
        });
      } catch (err) {
        console.error('arXiv get papers failed:', err);
        return JSON.stringify({
          success: false,
          error: `arXiv 论文获取失败：${err instanceof Error ? err.message : String(err)}`,
          papers: [],
        });
      }
    },
    {
      name: 'arxiv_get_papers',
      description:
        '按一个或多个 arXiv ID 批量获取论文元数据。适用于用户给出 arXiv ID、URL 或需要查特定论文详情的场景。',
      schema: ARXIV_GET_SCHEMA,
    }
  );

  return [searchTool, getTool];
}
