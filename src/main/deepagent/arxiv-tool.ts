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
  pdfLink: string;
  abstractLink: string;
}

// ---------- XML 解析器 ----------
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

function parseArxivResponse(xml: string): ArxivPaper[] {
  const json = parser.parse(xml);
  const feed = json.feed;
  if (!feed || !feed.entry) return [];

  const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
  return entries.map((entry: any) => {
    const id = entry.id?.toString().split('/abs/').pop() ?? '';
    const authors = Array.isArray(entry.author)
      ? entry.author.map((a: any) => a.name?.toString() ?? '')
      : [entry.author?.name?.toString() ?? ''];

    const links = Array.isArray(entry.link) ? entry.link : [entry.link];
    const pdfLinkObj = links.find(
      (l: any) => l['@_title']?.toLowerCase() === 'pdf'
    );
    const abstractLinkObj = links.find(
      (l: any) => !l['@_title'] || l['@_rel'] === 'alternate'
    );

    return {
      id,
      title: entry.title?.toString().replace(/\s+/g, ' ').trim() ?? '',
      authors,
      summary: entry.summary?.toString().replace(/\s+/g, ' ').trim() ?? '',
      published: entry.published?.toString() ?? '',
      pdfLink: pdfLinkObj?.['@_href'] ?? '',
      abstractLink: abstractLinkObj?.['@_href'] ?? entry.id ?? '',
    };
  });
}

// ---------- 核心搜索函数 ----------
export async function searchArxiv(
  query: string,
  maxResults: number = 5,
  start: number = 0
): Promise<ArxivPaper[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodedQuery}&start=${start}&max_results=${maxResults}&sortBy=relevance`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`arXiv API 请求失败: ${response.status}`);
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
  query: string;
  maxResults?: number;
  start?: number;
}

// ---------- JSON Schema ----------
const ARXIV_SCHEMA = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description: '搜索关键词或 arXiv 查询语法，如 "attention is all you need" 或 "au:Yann LeCun"',
    },
    maxResults: {
      type: 'number',
      description: '返回的最大论文数（1-20），默认 5',
    },
    start: {
      type: 'number',
      description: '结果的起始偏移，用于分页，默认 0',
    },
  },
  required: ['query'],
  additionalProperties: false,
};

// ---------- 供 Agent 使用的工具定义 ----------
export function createArxivTool(providerConfig: SearchProviderConfig | null) {
  return tool(
    async (input: ArxivInput) => {
      if (!providerConfig) {
        return JSON.stringify({
          success: false,
          error: 'arXiv 搜索工具未启用。请在工具设置中启用 arXiv。',
          papers: [],
        });
      }

      const { query, maxResults = 5, start = 0 } = input;
      const config = providerConfig.config as { max_results?: number };
      const effectiveMax = config?.max_results ?? maxResults;

      try {
        const papers = await searchArxiv(query, effectiveMax, start);
        return JSON.stringify({
          success: true,
          total_results: papers.length,
          papers,
          content: formatPapersForLLM(papers),
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
}
