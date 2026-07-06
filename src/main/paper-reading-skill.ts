export interface PaperReadingSkillResource {
  relativePath: string;
  content: string;
}

export function getPaperReadingSkillMarkdown(): string {
  return [
    '---',
    'name: paper-reading',
    'description: Guide Agents from Paper Entries to full-text academic paper reading with source-grounded citations.',
    'when_to_use: Use when the user asks to read, compare, inspect, summarize, or cite papers already collected in the Paper Library.',
    '---',
    '',
    '# Paper Reading Skill',
    '',
    'Use this Skill as a strategy-only reading funnel from Paper Entries to source-grounded full text.',
    'This Skill contains no scripts. Artifact lookup and parsing execution stay inside the PDF Parsing Skill.',
    '',
    '## Reading Funnel',
    '',
    '1. Start from Paper Entries in the project Knowledge Base. Use metadata and abstract triage to choose which papers need full-text reading.',
    '2. Resolve the Paper Entry `resource` to the local PDF under `.cdf/knowledge/`. If a Paper Entry has no local PDF resource, stop and tell the user that full-text reading needs an authorized local PDF.',
    '3. Before parsing, run PDF Parsing Skill `scripts/find-artifact.js --project <projectPath> --file <absolutePdfPath>`.',
    '4. If lookup returns `reusable-artifact`, read the returned `recoveredViewPath` and inspect `baseline.json` when block-level Paper Source Location is needed.',
    '5. If lookup returns `stale-artifact` or `not-parsed`, run PDF Parsing Skill `scripts/baseline-parse.js --project <projectPath> --file <absolutePdfPath>`, then run lookup again and read the resulting `recovered-view.md`.',
    '6. Read selectively first, then expand to full-text reading only for papers that survive metadata, abstract, and section-level triage.',
    '7. When citing evidence, include Paper Source Location: page number plus section or heading. Prefer block locations from `baseline.json`; otherwise use nearby page anchors and headings in `recovered-view.md`.',
    '',
    '## Retention',
    '',
    'PDF Parse Artifacts are the source of truth for parsed full text.',
    'Do not clean, delete, compact, or archive `.cdf/pdf-parses/` from this Skill.',
    'Those artifacts may take minutes of Marker compute to rebuild and may include user-approved recovery work.',
    '',
    '## Non-Capabilities',
    '',
    'Do not build or query an index in this Skill.',
    'Do not start a background parsing pipeline during Paper Collection.',
    'Do not import papers; use Paper Collection Skill for that.',
    'Do not create ad hoc parser scripts; use PDF Parsing Skill entrypoints only.',
    '',
    '## Output',
    '',
    'When answering, distinguish metadata-level conclusions from full-text conclusions.',
    'For full-text claims, cite the Paper Entry title and Paper Source Location, such as `Attention Is All You Need, p. 3, Model Architecture`.',
  ].join('\n');
}

export function getPaperReadingSkillResources(): PaperReadingSkillResource[] {
  return [];
}
