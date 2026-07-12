export interface KnowledgeEntrySearchOptions {
  keyword?: string;
  tags?: string[];
  tagMatch?: 'all' | 'any';
  dateField?: 'timestamp';
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'timestamp' | 'title';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

export interface KnowledgeEntrySummary {
  relativePath: string;
  title?: string;
  tags: string[];
  body: string;
  frontmatter: Record<string, unknown>;
  warnings: string[];
  invalidFrontmatter: boolean;
}

export interface JournalMetricsSnapshot {
  impactFactor?: number | string;
  casTier?: string;
  jcrQuartile?: string;
  indexing?: string[];
  year: number | string;
  source: string;
}

export const PAPER_SEARCH_CONFIG_KEYS = [
  'SEMANTIC_SCHOLAR_API_KEY',
  'UNPAYWALL_EMAIL',
  'CORE_API_KEY',
  'WOS_API_KEY',
  'PUBMED_API_KEY',
  'ELSEVIER_API_KEY',
  'IEEE_API_KEY',
  'EASYSCHOLAR_KEY',
  'SPRINGER_API_KEY',
  'SPRINGER_OPENACCESS_API_KEY',
  'WILEY_TDM_TOKEN',
  'CROSSREF_MAILTO',
  'OPENAIRE_API_KEY',
] as const;

export type PaperSearchConfigKey = typeof PAPER_SEARCH_CONFIG_KEYS[number];
export type PaperSearchConfigSource = 'user_config' | 'environment' | 'missing';

export interface PaperSearchConfigEntry {
  key: PaperSearchConfigKey;
  configured: boolean;
  value: string;
  source: PaperSearchConfigSource;
  secret: boolean;
}

export interface PaperSearchConfigSettings {
  configPath: string;
  entries: PaperSearchConfigEntry[];
  configuredCount: number;
  totalCount: number;
}

export interface KnowledgeEntryCreateInput {
  relativePath?: string;
  type?: string;
  title: string;
  description?: string;
  resource?: string;
  authors?: string[];
  source?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  year?: string | number;
  doi?: string;
  journalMetrics?: JournalMetricsSnapshot;
  tags?: string[];
  body?: string;
}

export interface KnowledgeEntryUpdateInput {
  type?: string;
  title?: string;
  description?: string;
  resource?: string;
  authors?: string[];
  source?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  year?: string | number;
  doi?: string;
  journalMetrics?: JournalMetricsSnapshot;
  tags?: string[];
  body?: string;
}
