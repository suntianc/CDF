export interface PaperCollectionSkillResource {
  relativePath: string;
  content: string;
}

export interface PaperCollectionSkillOptions {
  cliPath?: string;
}

function paperSearchCommand(cliPath?: string): string {
  return cliPath ? `node ${JSON.stringify(cliPath)}` : 'node runtime/paper-search.cjs';
}

export function getPaperCollectionSkillMarkdown(options: PaperCollectionSkillOptions = {}): string {
  const command = paperSearchCommand(options.cliPath);
  return [
    '---',
    'name: paper-collection',
    'description: Collect academic papers into the project Paper Library with metadata, PDFs, and optional journal metrics.',
    'when_to_use: Use when the user asks to collect, search for, download, import, or organize academic papers.',
    '---',
    '',
    '# Paper Collection Skill',
    '',
    'Use this Skill to close the loop from paper discovery to a complete Paper Entry in the project Knowledge Base.',
    '',
    '## Runtime',
    '',
    `The bundled paper-search CLI is available at: \`${command}\`.`,
    'Use the bundled CLI through shell commands; do not install another copy during normal collection.',
    '',
    '## Source Strategy',
    '',
    'Use arXiv tools first when the user names an arXiv paper, arXiv id, or arXiv-heavy topic.',
    'Use `paper-search search` to enrich metadata, find non-arXiv sources, or normalize bibliographic fields.',
    'Use the Crawler Skill only for sources that arXiv tools and paper-search cannot cover; non-arXiv crawling is not the first acceptance path.',
    '',
    '## Commands',
    '',
    'The command names are `paper-search search`, `paper-search journal-metrics`, and `paper-search download`.',
    `- \`${command} search "<query>" --platform arxiv --max-results 5 --pretty\`: search metadata and PDF URLs.`,
    `- \`${command} search "<query>" --sources crossref,openalex --max-results 5 --pretty\`: enrich bibliographic fields from registry sources.`,
    `- \`${command} journal-metrics "<journal>" --pretty\`: fetch Journal Metrics Snapshot fields when the easyScholar key is configured.`,
    `- \`${command} download <paper-id> --platform arxiv --save-path <knowledgeRoot>/papers --pretty\`: download an open-access PDF to the Paper Library storage area.`,
    '',
    'Do not enable Sci-Hub, do not pass a Sci-Hub platform, and do not instruct the user to enable Sci-Hub. PDF acquisition must stay on native, open-access, or institutionally authorized routes.',
    '',
    '## Entry Shape',
    '',
    '- Store collected papers as `papers/<slug>.md` and `papers/<slug>.pdf` side by side under `.cdf/knowledge/`.',
    '- Prefer an arXiv id slug such as `1706.03762`; otherwise use a conservative title slug.',
    '- Write the PDF relative path as `resource: papers/<slug>.pdf` only after the file exists.',
    '- If PDF download fails, still create the Paper Entry, omit `resource`, and record the PDF URL plus failure reason in the body.',
    '- Missing journal metrics are absent fields. Do not write placeholders or guessed rankings.',
    '',
    'Use `knowledge_create` with `type: "Paper"` and CDF-managed fields: `authors`, `source`, `journal`, `volume`, `issue`, `pages`, `year`, `doi`, and optional `journalMetrics` with metric `year` and `source`.',
    '',
    '## Deduplication',
    '',
    'Before creating a Paper Entry:',
    '1. Check whether `papers/<slug>.md` already exists.',
    '2. Run `knowledge_search` by title to catch cross-source duplicates.',
    '',
    'Do not create a second Paper Entry for the same paper. If a duplicate exists, skip it or fill missing metadata in the existing entry after confirming the target.',
    '',
    '## Journal Metrics',
    '',
    'Journal metrics belong to the journal, not the paper. When available, snapshot impact factor, CAS tier, JCR quartile, indexing status, metric year, and data source into `journalMetrics`.',
    'For one collection task, deduplicate by normalized journal name and query each journal once; reuse that Journal Metrics Snapshot across papers from the same journal.',
    'If the CLI reports that `EASYSCHOLAR_KEY` is missing, tell the user to configure it in CDF Research Config before metrics can be fetched; continue collection without metrics.',
  ].join('\n');
}

export function getPaperCollectionSkillResources(options: PaperCollectionSkillOptions = {}): PaperCollectionSkillResource[] {
  const command = paperSearchCommand(options.cliPath);
  return [
    {
      relativePath: 'entrypoints.json',
      content: JSON.stringify({
        runtime: {
          paperSearchCli: options.cliPath ?? 'runtime/paper-search.cjs',
        },
        commands: {
          search: `${command} search "<query>" --platform arxiv --max-results 5 --pretty`,
          journalMetrics: `${command} journal-metrics "<journal>" --pretty`,
          download: `${command} download <paper-id> --platform arxiv --save-path <knowledgeRoot>/papers --pretty`,
        },
      }, null, 2) + '\n',
    },
  ];
}
