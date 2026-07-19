import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBuiltInSkillDirs } from './deepagent/skill-manager';
import { createKnowledgeEntry, getKnowledgeBaseRoot } from './knowledge-base';
import { getPaperReadingSkillMarkdown, getPaperReadingSkillResources } from './paper-reading-skill';

let projectPath: string;
let previousPdfSkillCliPath: string | undefined;
let previousBuiltInSkillsRoot: string | undefined;
let previousMarkerCommand: string | undefined;

function buildPdfSkillCliBundle(targetDir: string): string {
  const cliPath = path.join(targetDir, 'pdf-parsing-skill-cli.cjs');
  buildSync({
    entryPoints: ['src/main/pdf-parsing-skill-cli.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: cliPath,
    logLevel: 'silent',
  });
  return cliPath;
}

function writeMarkerFixture(markdown: string): string {
  const markerPath = path.join(projectPath, 'marker-fixture.js');
  fs.writeFileSync(markerPath, [
    "const fs = require('fs');",
    "const path = require('path');",
    "const args = process.argv.slice(2);",
    "const outputDir = args[args.indexOf('--output_dir') + 1];",
    "fs.mkdirSync(outputDir, { recursive: true });",
    `fs.writeFileSync(path.join(outputDir, 'result.md'), ${JSON.stringify(markdown)}, 'utf-8');`,
  ].join('\n'), 'utf-8');
  return `${process.execPath} ${markerPath}`;
}

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-paper-reading-'));
  previousPdfSkillCliPath = process.env.CDF_PDF_SKILL_CLI_PATH;
  previousBuiltInSkillsRoot = process.env.CDF_BUILT_IN_SKILLS_ROOT;
  previousMarkerCommand = process.env.CDF_MARKER_COMMAND;
  process.env.CDF_PDF_SKILL_CLI_PATH = buildPdfSkillCliBundle(projectPath);
  process.env.CDF_BUILT_IN_SKILLS_ROOT = path.join(projectPath, 'built-in-skills');
  delete process.env.CDF_MARKER_COMMAND;
});

afterEach(() => {
  if (previousPdfSkillCliPath === undefined) {
    delete process.env.CDF_PDF_SKILL_CLI_PATH;
  } else {
    process.env.CDF_PDF_SKILL_CLI_PATH = previousPdfSkillCliPath;
  }
  if (previousBuiltInSkillsRoot === undefined) {
    delete process.env.CDF_BUILT_IN_SKILLS_ROOT;
  } else {
    process.env.CDF_BUILT_IN_SKILLS_ROOT = previousBuiltInSkillsRoot;
  }
  if (previousMarkerCommand === undefined) {
    delete process.env.CDF_MARKER_COMMAND;
  } else {
    process.env.CDF_MARKER_COMMAND = previousMarkerCommand;
  }
  fs.rmSync(projectPath, { recursive: true, force: true });
});

describe('Paper Reading Skill', () => {
  it('is a strategy-only Skill for the Paper Entry to full-text reading funnel', () => {
    const markdown = getPaperReadingSkillMarkdown();
    const builtInSkillDirs = getBuiltInSkillDirs();
    const paperReadingDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}paper-reading`));

    expect(markdown).toContain('name: paper-reading');
    expect(markdown).toContain('metadata and abstract triage');
    expect(markdown).toContain('scripts/find-artifact.js');
    expect(markdown).toContain('scripts/baseline-parse.js');
    expect(markdown).toContain('recovered-view.md');
    expect(markdown).toContain('Paper Source Location');
    expect(markdown).toContain('Do not clean, delete, compact, or archive `.cdf/pdf-parses/`');
    expect(getPaperReadingSkillResources()).toEqual([]);
    expect(paperReadingDir).toBeTruthy();
    expect(fs.existsSync(path.join(paperReadingDir as string, 'scripts'))).toBe(false);
    expect(fs.readFileSync(path.join(paperReadingDir as string, 'SKILL.md'), 'utf-8')).toBe(markdown);
  });

  it('follows the lookup-then-parse reading path and cites source locations from recovered markdown', () => {
    const knowledgeRoot = getKnowledgeBaseRoot(projectPath);
    const pdfPath = path.join(knowledgeRoot, 'papers', 'attention.pdf');
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    fs.writeFileSync(pdfPath, '%PDF-1.7\n% reading fixture\n', 'utf-8');
    createKnowledgeEntry(projectPath, {
      relativePath: 'papers/attention.md',
      type: 'Paper',
      title: 'Attention Is All You Need',
      description: 'Transformer architecture paper.',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      source: 'arXiv:1706.03762',
      resource: 'papers/attention.pdf',
      tags: ['transformer'],
      body: 'Abstract: Sequence transduction without recurrence.',
    });

    const pdfParsingDir = getBuiltInSkillDirs().find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`)) as string;
    const firstLookup = JSON.parse(execFileSync(process.execPath, [
      path.join(pdfParsingDir, 'scripts', 'find-artifact.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], { encoding: 'utf-8' }));
    expect(firstLookup.status).toBe('not-parsed');

    const markerCommand = writeMarkerFixture([
      '<!-- page: 1 -->',
      '# Abstract',
      '',
      'Sequence transduction without recurrence.',
      '',
      '<!-- page: 3 -->',
      '# Model Architecture',
      '',
      'The Transformer uses self-attention.',
    ].join('\n'));
    const parseResult = JSON.parse(execFileSync(process.execPath, [
      path.join(pdfParsingDir, 'scripts', 'baseline-parse.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_MARKER_COMMAND: markerCommand,
        CDF_PDF_PARSE_NOW: '2026-07-03T15:30:00.000Z',
        CDF_PDF_PARSE_JOB_ID: 'job-paper-reading',
      },
    }));
    expect(parseResult.status).toBe('completed');

    const secondLookup = JSON.parse(execFileSync(process.execPath, [
      path.join(pdfParsingDir, 'scripts', 'find-artifact.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], { encoding: 'utf-8' }));
    expect(secondLookup).toMatchObject({
      status: 'reusable-artifact',
      artifactDir: parseResult.artifactDir,
    });
    const recoveredView = fs.readFileSync(secondLookup.recoveredViewPath, 'utf-8');
    expect(recoveredView).toContain('The Transformer uses self-attention.');
    expect(recoveredView).toContain('page: 3');
    expect(JSON.parse(fs.readFileSync(path.join(parseResult.artifactDir, 'baseline.json'), 'utf-8')).blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        section: 'Model Architecture',
        pageStart: 3,
        location: expect.objectContaining({
          section: 'Model Architecture',
          pageStart: 3,
        }),
      }),
    ]));

    fs.writeFileSync(pdfPath, '%PDF-1.7\n% changed reading fixture\n', 'utf-8');
    const staleLookup = JSON.parse(execFileSync(process.execPath, [
      path.join(pdfParsingDir, 'scripts', 'find-artifact.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], { encoding: 'utf-8' }));
    expect(staleLookup).toMatchObject({
      status: 'stale-artifact',
      artifactDir: parseResult.artifactDir,
      nextActions: [
        {
          kind: 'rerun-baseline-parse',
        },
      ],
    });
  });
});
