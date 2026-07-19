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

const PAPER_COLLECTION_CACHE_SKILL_DIR = '<projectPath>/.cdf/paper-collection-cache';
const PAPER_COLLECTION_CACHE_LATEST_SKILL_PATH = `${PAPER_COLLECTION_CACHE_SKILL_DIR}/latest.json`;
const PAPER_COLLECTION_CACHE_INDEX_SKILL_PATH = `${PAPER_COLLECTION_CACHE_SKILL_DIR}/index.json`;
const PAPER_COLLECTION_CACHE_ARCHIVE_SKILL_DIR = `${PAPER_COLLECTION_CACHE_SKILL_DIR}/archive`;

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
    'Prefer arXiv platform search for the discovery step when the user names an arXiv paper, arXiv id, or arXiv-heavy topic.',
    'Always run the enrichment step for every candidate after discovery, regardless of the discovery platform or topic.',
    'Do not call the `arxiv_search` Agent tool from this Skill; it remains available only when the user directly invokes that tool.',
    '',
    '## Commands',
    '',
    `- \`${command} search "<query>" --platform arxiv --max-results 5 --pretty\`: search candidate metadata and open-access PDF availability.`,
    `- \`${command} search "<query>" --sources crossref,openalex --max-results 5 --pretty\`: search registry sources for non-arXiv literature.`,
    `- \`${command} config list --pretty\`: inspect which paper-search config keys are configured without revealing secret values.`,
    `- \`${command} journal-metrics "<journal>" --pretty\`: fetch one Journal Metrics Snapshot per normalized non-empty journal name.`,
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
    '## Enrichment',
    '',
    'After platform discovery and before presenting candidates or writing cache, enrich every candidate as far as the metadata sources allow.',
    `If a candidate has a DOI, run \`${command} run get_paper_by_doi --json-args '{"doi":"<doi>"}'\` and fill \`journal\`, \`volume\`, \`issue\`, \`pages\`, and \`year\` from the \`data.papers\` entry whose \`source\` is \`crossref\`; if that entry's \`journal\` is empty, fall back to another source entry with a non-empty \`journal\`.`,
    `If a DOI enrichment command times out or is killed, do not retry the full \`get_paper_by_doi\` fan-out; fall back to the title search path: \`${command} search "<title>" --sources crossref --max-results 3 --pretty\`, with the same strict title matching.`,
    'If the fallback also fails, skip enrichment for that candidate and tell the user which candidates could not be enriched and why.',
    `If a candidate has no DOI, run \`${command} search "<title>" --sources crossref --max-results 3 --pretty\` with the full title. Use the result only on a strict title match, ignoring case and punctuation; if uncertain, leave the fields absent and do not guess.`,
    'For every non-empty enriched journal name, normalize and deduplicate it before querying `journal-metrics`.',
    'Present enriched candidates with the journal name and available metrics, including impact factor, CAS tier, and JCR quartile when available.',
    'When no formally published version is found, mark the candidate as `arXiv 预印本,未见正式发表版本`; leave bibliographic and metric fields absent rather than writing placeholders.',
    'Do not let one enrichment source timeout or failure block the whole candidate list. Keep data from successful sources and report failed sources through Failure Semantics.',
    '',
    '## Journal Metrics',
    '',
    'Use `config list --pretty` only as a safe detector: it reports each key with a `configured` boolean and masked value. Do not run `config get` because it can reveal plaintext secrets. Do not run `config set` or `config unset`; keys are managed by CDF Research Settings.',
    `For each distinct normalized non-empty journal name, run \`${command} journal-metrics "<journal>" --pretty\` and handle failures; 先试、按失败处理. If the CLI reports that a key is missing, tell the user to configure it in Research Settings and continue the search without metrics.`,
    'If a candidate has no journal name, such as an arXiv preprint, tell the user 预印本无期刊指标 and do not fabricate journal metrics or `pdfAccess`.',
    '',
    '## Cache Contract',
    '',
    `Before starting a new search, read \`${PAPER_COLLECTION_CACHE_LATEST_SKILL_PATH}\`. If it does not exist, start the new search directly.`,
    `If latest exists and has \`consumedAt\` and \`now - consumedAt >= 30 minutes / 30 分钟\`, copy the entire latest payload to \`${PAPER_COLLECTION_CACHE_ARCHIVE_SKILL_DIR}/<searchedAt>.json\`, update the matching \`${PAPER_COLLECTION_CACHE_INDEX_SKILL_PATH}\` entry to \`status: "archived"\` with \`archivePath\`, then delete or overwrite \`latest.json\`.`,
    'If `consumedAt` is missing or the elapsed time is under 30 minutes, overwrite `latest.json` without archiving; this protects an in-progress user selection. In this branch, keep existing `index.json` history and only append the new search entry.',
    `After search and journal metrics enrichment, write \`${PAPER_COLLECTION_CACHE_LATEST_SKILL_PATH}\` with \`searchedAt\`, \`query\`, \`source\`, \`candidates\`, and \`journalMetricsByJournal\`, then append \`${PAPER_COLLECTION_CACHE_INDEX_SKILL_PATH}\` with \`{searchedAt, query, candidateCount, status: "fresh"}\`.`,
    'Only write the schema fields listed in this Cache Contract to `latest.json` and `index.json`. Do not add extra fields.',
    'Normalize journal names before metrics lookup and query each distinct journal once.',
    '',
    '## Timestamps',
    '',
    'Run `date -u +%Y-%m-%dT%H:%M:%SZ` immediately before writing `searchedAt`, `consumedAt`, or checking archive age. Use the command output as the timestamp; never infer it from memory or conversation context. 禁止编造时间.',
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
          enrichDoi: `${command} run get_paper_by_doi --json-args '{"doi":"<doi>"}'`,
          configList: `${command} config list --pretty`,
          journalMetrics: `${command} journal-metrics "<journal>" --pretty`,
        },
        cache: {
          latest: PAPER_COLLECTION_CACHE_LATEST_SKILL_PATH,
          index: PAPER_COLLECTION_CACHE_INDEX_SKILL_PATH,
          archive: `${PAPER_COLLECTION_CACHE_ARCHIVE_SKILL_DIR}/`,
          candidateFields: PAPER_SEARCH_CANDIDATE_FIELDS,
        },
      }, null, 2) + '\n',
    },
  ];
}
