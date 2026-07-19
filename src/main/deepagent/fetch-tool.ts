import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { tool } from '@langchain/core/tools';

const turndownService = new TurndownService();

interface FetchInput {
  url: string;
  timeout?: number;
}

async function fetchPageAsMarkdown(url: string, timeout: number = 12000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CDF Fetch Tool',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP 请求失败: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return '⚠️ 抓取成功，但未能从该页面提取到有效的高价值核心正文。';
    }

    const markdown = turndownService.turndown(article.content);
    const title = article.title || doc.window.document.title || '无标题';
    return `# ${title}\n\n${markdown}`;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`HTTP 请求超时: ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const FETCH_SCHEMA = {
  type: 'object' as const,
  properties: {
    url: {
      type: 'string',
      description: 'The URL of the webpage to fetch and convert to markdown',
    },
    timeout: {
      type: 'number',
      description: 'Timeout in milliseconds (default: 12000)',
      default: 12000,
    },
  },
  required: ['url'],
  additionalProperties: false,
};

export function createFetchTool() {
  return tool(
    async (input: FetchInput) => {
      try {
        const markdown = await fetchPageAsMarkdown(input.url, input.timeout ?? 12000);
        return markdown;
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          url: input.url,
        });
      }
    },
    {
      name: 'fetch',
      description: 'Fetch a webpage and convert it to markdown. Use this to read the content of a web page when you have a URL. Returns the page title and content in markdown format.',
      schema: FETCH_SCHEMA,
    }
  );
}
