import { tool } from '@langchain/core/tools';
import type { SearchResult } from '../../shared/types';

export interface SearchProviderConfig {
  decryptedKey: string;
  config: Record<string, unknown>;
}

// ===== Tavily Search Tool =====

interface TavilyInput {
  query: string;
}

const TAVILY_SCHEMA = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description: 'The search query to search for',
    },
  },
  required: ['query'],
  additionalProperties: false,
};

export function createTavilyTool(providerConfig: SearchProviderConfig | null) {
  return tool(
    async (input: TavilyInput) => {
      const { query } = input;

      if (!providerConfig) {
        return JSON.stringify({
          error: 'Tavily is not configured or enabled. Please add your Tavily API key in tool settings.',
          results: [],
        });
      }

      const config = providerConfig.config as { max_results?: number };
      const maxResults = config?.max_results ?? 5;

      try {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: providerConfig.decryptedKey,
            query,
            max_results: maxResults,
            search_depth: 'basic',
            topic: 'general',
          }),
        });

        if (!response.ok) {
          throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as {
          results?: Array<{ url: string; title: string; content: string; score?: number }>;
          answer?: string;
        };

        const results: SearchResult[] = (data.results || []).map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          source: 'tavily',
          score: r.score ?? 0.5,
        }));

        return JSON.stringify({
          query,
          provider: 'tavily',
          total_results: results.length,
          answer: data.answer,
          results,
        });
      } catch (err) {
        console.error('Tavily search failed:', err);
        return JSON.stringify({
          error: `Tavily search failed: ${err instanceof Error ? err.message : String(err)}`,
          results: [],
        });
      }
    },
    {
      name: 'tavily_search',
      description: 'General web search for everyday questions, news, facts, products, definitions. Fast and broad.',
      schema: TAVILY_SCHEMA,
    }
  );
}

// ===== AnySearch Tool =====

interface AnysearchInput {
  query: string;
  domains?: string;
}

const ANYSEARCH_SCHEMA = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description: 'The search query to search for',
    },
    domains: {
      type: 'string',
      description: 'Domain filter: academic, code, finance, legal, health, tech, business, security. Default: general',
      enum: ['academic', 'code', 'finance', 'legal', 'health', 'tech', 'business', 'security', 'general'],
    },
  },
  required: ['query'],
  additionalProperties: false,
};

export function createAnysearchTool(providerConfig: SearchProviderConfig | null) {
  return tool(
    async (input: AnysearchInput) => {
      const { query, domains } = input;

      if (!providerConfig) {
        return JSON.stringify({
          error: 'AnySearch is not configured or enabled. Please add your AnySearch API key in tool settings.',
          results: [],
        });
      }

      const config = providerConfig.config as { max_results?: number };
      const maxResults = config?.max_results ?? 5;

      try {
        const body: Record<string, unknown> = {
          query,
          max_results: maxResults,
        };

        if (domains && domains !== 'general') {
          body.domains = [domains];
        }

        const response = await fetch('https://api.anysearch.com/v1/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${providerConfig.decryptedKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`AnySearch API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as {
          code?: number;
          message?: string;
          data?: {
            results?: Array<{
              title: string;
              url: string;
              description?: string;
              content?: string;
              source?: string;
              score?: number;
              quality_score?: number;
              published_at?: string;
            }>;
            metadata?: {
              total_results?: number;
              search_time_ms?: number;
            };
          };
        };

        const results: SearchResult[] = (data.data?.results || []).map((r) => ({
          title: r.title,
          url: r.url,
          content: r.description || r.content || '',
          source: 'anysearch',
          score: r.quality_score ?? r.score ?? 0.5,
          published_at: r.published_at,
        }));

        return JSON.stringify({
          query,
          provider: 'anysearch',
          domains: domains || 'general',
          total_results: results.length,
          search_time_ms: data.data?.metadata?.search_time_ms,
          results,
        });
      } catch (err) {
        console.error('AnySearch failed:', err);
        return JSON.stringify({
          error: `AnySearch failed: ${err instanceof Error ? err.message : String(err)}`,
          results: [],
        });
      }
    },
    {
      name: 'anysearch',
      description: "Specialized search for academic papers, code, finance, legal, health, tech, business, security. Use when user mentions a specific domain like 'paper', 'code', 'stock', 'law', 'medical'.",
      schema: ANYSEARCH_SCHEMA,
    }
  );
}
