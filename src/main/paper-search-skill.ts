export interface PaperSearchSkillResource {
  relativePath: string;
  content: string;
}

export interface PaperSearchSkillOptions {
  cliPath?: string;
}

export const PAPER_SEARCH_CANDIDATE_FIELDS = [
  'title',
  'authors',
  'abstract',
  'journal',
  'volume',
  'issue',
  'pages',
  'year',
  'doi',
  'journalMetrics',
  'pdfAccess',
] as const;

function paperSearchCommand(cliPath?: string): string {
  return cliPath ? `node ${JSON.stringify(cliPath)}` : 'node runtime/paper-search.cjs';
}

export function getPaperSearchSkillMarkdown(options: PaperSearchSkillOptions = {}): string {
  const command = paperSearchCommand(options.cliPath);
  return [
    '---',
    'name: paper-search',
    'description: Search academic papers, enrich candidate metadata, and cache results for later Paper Collection.',
    'when_to_use: Use when the user asks to search, find, discover, or compare academic papers without importing them into the Paper Library.',
    '---',
    '',
    '# Paper Search Skill',
    '',
    'Use this Skill only for discovery. Search for candidate papers, enrich their metadata, present the candidates, write the search cache, then stop and wait for the user to choose papers.',
    '',
    '## Runtime',
    '',
    `The bundled paper-search CLI is available at: \`${command}\`.`,
    'Use the bundled CLI through shell commands; do not install another copy during normal search.',
    '',
    '## Source Strategy',
    '',
    'Prefer arXiv platform search when the user names an arXiv paper, arXiv id, or arXiv-heavy topic.',
    'Use Crossref and OpenAlex to fill missing bibliographic fields or to search non-arXiv literature.',
    'Do not call the `arxiv_search` Agent tool from this Skill; it remains available only when the user directly invokes that tool.',
    '',
    '## Commands',
    '',
    `- \`${command} search "<query>" --platform arxiv --max-results 5 --pretty\`: search candidate metadata and open-access PDF availability.`,
    `- \`${command} search "<query>" --sources crossref,openalex --max-results 5 --pretty\`: search registry sources for non-arXiv literature.`,
    `- \`${command} journal-metrics "<journal>" --pretty\`: fetch one Journal Metrics Snapshot per normalized journal name when the easyScholar key is configured.`,
    '',
    'Do not run the CLI download subcommand in this Skill. Downloading or importing belongs to the Paper Collection Skill after the user chooses candidates.',
    'Do not enable Sci-Hub, do not pass a Sci-Hub platform, and do not instruct the user to enable Sci-Hub.',
    '',
    '## Candidate Fields',
    '',
    `Every presented candidate must include the Paper Library field set when available: ${PAPER_SEARCH_CANDIDATE_FIELDS.join(', ')}.`,
    'The `journalMetrics` field carries impact factor, CAS tier, JCR quartile, indexing status, metric year, and data source when available.',
    'Represent PDF access in the `pdfAccess` field with exactly one of: open | paywalled | unknown.',
    '',
    '## Cache Contract',
    '',
    'Before starting a new search, read `/paper-collection-cache/latest.json`. If it does not exist, start the new search directly.',
    'If latest exists and has `consumedAt` and `now - consumedAt >= 30 minutes / 30 分钟`, copy the entire latest payload to `/paper-collection-cache/archive/<searchedAt>.json`, update the matching `/paper-collection-cache/index.json` entry to `status: "archived"` with `archivePath`, then delete or overwrite `latest.json`.',
    'If `consumedAt` is missing or the elapsed time is under 30 minutes, overwrite `latest.json` without archiving; this protects an in-progress user selection. In this branch, keep existing `index.json` history and only append the new search entry.',
    'After search and journal metrics enrichment, write `/paper-collection-cache/latest.json` with `searchedAt`, `query`, `source`, `candidates`, and `journalMetricsByJournal`, then append `/paper-collection-cache/index.json` with `{searchedAt, query, candidateCount, status: "fresh"}`.',
    'Normalize journal names before metrics lookup and query each distinct journal once.',
    '',
    '## Failure Semantics',
    '',
    'If there are no results, tell the user no results were found and suggest changing the query.',
    'If a candidate is paid or has no open PDF, tell the user that CDF cannot fetch it automatically; ask them to use institutional access and place the PDF at `.cdf/knowledge/papers/<slug>.pdf`, then continue with Paper Collection Skill Mode B.',
    'If an API or CLI call fails, surface the original error and add one concise explanation of which source failed.',
    '',
    '## Stop Point',
    '',
    'After presenting candidates, stop. Wait for the user to choose papers before using Paper Collection.',
  ].join('\n');
}

export function getPaperSearchSkillResources(options: PaperSearchSkillOptions = {}): PaperSearchSkillResource[] {
  const command = paperSearchCommand(options.cliPath);
  return [
    {
      relativePath: 'entrypoints.json',
      content: JSON.stringify({
        runtime: {
          paperSearchCli: options.cliPath ?? 'runtime/paper-search.cjs',
        },
        commands: {
          searchArxiv: `${command} search "<query>" --platform arxiv --max-results 5 --pretty`,
          searchRegistries: `${command} search "<query>" --sources crossref,openalex --max-results 5 --pretty`,
          journalMetrics: `${command} journal-metrics "<journal>" --pretty`,
        },
        cache: {
          latest: '/paper-collection-cache/latest.json',
          index: '/paper-collection-cache/index.json',
          archive: '/paper-collection-cache/archive/',
          candidateFields: PAPER_SEARCH_CANDIDATE_FIELDS,
        },
      }, null, 2) + '\n',
    },
  ];
}
