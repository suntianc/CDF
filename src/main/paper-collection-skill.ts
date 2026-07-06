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
    'description: Import selected academic papers or user-provided PDFs into the project Paper Library.',
    'when_to_use: Use when the user has chosen paper candidates or provides a local academic PDF to import into the Paper Library.',
    '---',
    '',
    '# Paper Collection Skill',
    '',
    'Use this Skill only for Paper Library import. It consumes paper candidates already produced by Paper Search or a user-provided PDF, then creates Paper Entries in the project Knowledge Base.',
    '',
    '## Runtime',
    '',
    `The bundled paper-search CLI is available at: \`${command}\`.`,
    'Use the bundled CLI through shell commands only for open-access PDF download. Do not install another copy during normal collection.',
    '',
    '## Modes',
    '',
    'Mode A: the user chooses candidates from `/paper-collection-cache/latest.json` or from an archived payload found through `/paper-collection-cache/index.json`.',
    'Mode B: the user provides a PDF path for a paper they acquired through institutional authorization. Accept an absolute path, a Knowledge Base relative path, or a bare filename under `.cdf/knowledge/papers/`.',
    'Both modes end by creating or updating Paper Entries and marking the latest cache payload consumed.',
    '',
    '## Mode A: Selected Cached Candidates',
    '',
    'Read `/paper-collection-cache/latest.json`. If it does not exist, tell the user to run Paper Search first. If it exists but has no candidates, tell the user the cached search has no candidates and ask them to run Paper Search again.',
    'Import only the candidates the user selected. Do not infer unselected papers.',
    'Use cached `journalMetricsByJournal` snapshots. Do not call `journal-metrics` from this Skill; metrics were already fetched by Paper Search.',
    `Run \`${command} download <paper-id> --platform arxiv --save-path <knowledgeRoot>/papers --pretty\` only for open-access PDF candidates.`,
    'If PDF download fails, still create the Paper Entry, omit `resource`, and record the PDF URL plus failure reason in the body.',
    '',
    '## Mode B: User-Provided PDF',
    '',
    'Use Mode B when the user gives a PDF path for a paid/no-open-PDF candidate or another authorized local paper.',
    'Validate the path with CDF `resolvePaperPdfResourcePath`: the file must stay inside `.cdf/knowledge/papers/`, end in `.pdf`, exist, be a regular file, and not be a symbolic link.',
    'On path escape, non-PDF path, missing file, symbolic link, or non-regular file, report the error and stop without creating a partial Paper Entry.',
    'If the user provides title or DOI and the latest cache has a matching candidate, reconcile with that cached candidate and prefer cached metadata. If no cache match exists, require enough user-supplied metadata to create a useful Paper Entry.',
    'Create the Paper Entry with `resource: papers/<slug>.pdf` after validation succeeds.',
    '',
    '## Archived Search Recovery',
    '',
    'When the user asks for a previous result such as "the fifth paper from last time", read `/paper-collection-cache/index.json`, find an `archivePath`, read `/paper-collection-cache/archive/<searchedAt>.json`, and continue Mode A from that archived payload.',
    'Search cache archival uses a 30 minutes / 30 分钟 threshold after `consumedAt`; archived payloads remain valid import sources.',
    '',
    '## Compliance',
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
    '## Completion',
    '',
    'After a successful Mode A or Mode B import, write `consumedAt` to `/paper-collection-cache/latest.json` when the import used the latest cache, and update `/paper-collection-cache/index.json` for the matching `searchedAt` to `status: "consumed"`.',
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
          download: `${command} download <paper-id> --platform arxiv --save-path <knowledgeRoot>/papers --pretty`,
        },
        cache: {
          latest: '/paper-collection-cache/latest.json',
          index: '/paper-collection-cache/index.json',
          archive: '/paper-collection-cache/archive/',
        },
      }, null, 2) + '\n',
    },
  ];
}
