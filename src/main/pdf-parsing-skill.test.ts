import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBuiltInSkillDirs } from './deepagent/skill-manager';
import { resetPdfParseJobsForTests, type MarkerRunner } from './pdf-parse';
import {
  clearPdfRecoveryPreference,
  decidePdfRecoveryRoute,
  discoverPdfRecoveryCapabilities,
  executePdfRecoveryPlan,
  finalizeRecoveredPaperParseView,
  generatePdfRecoveryPlan,
  readPdfRecoveryPreference,
  recordPdfRecoveryRouteSelection,
  resolvePdfRecoveryPreferenceForPlan,
  shouldRerunMarkerBaseline,
  summarizePdfRecoveryRoutes,
  updatePdfRecoveryPreference,
  parsePdfWithSkill,
} from './pdf-parsing-skill';

let projectPath: string;
let pdfPath: string;
let previousPdfSkillCliPath: string | undefined;
let previousMarkerCommand: string | undefined;
let previousMarkerDiscoveryTimeoutMs: string | undefined;
let previousTextLayerFallbackCommand: string | undefined;
let previousPath: string | undefined;

function buildPdfSkillCliBundle(targetDir: string): string {
  const cliPath = path.join(targetDir, 'pdf-parsing-skill-cli.cjs');
  execFileSync(path.join(process.cwd(), 'node_modules', '.bin', 'esbuild'), [
    'src/main/pdf-parsing-skill-cli.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${cliPath}`,
  ], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
  return cliPath;
}

function writeMarkerFixture(markdown: string, options: { delayMs?: number; argsLogPath?: string } = {}): string {
  const markerPath = path.join(projectPath, 'marker-fixture.js');
  fs.writeFileSync(markerPath, [
    "const fs = require('fs');",
    "const path = require('path');",
    "const args = process.argv.slice(2);",
    options.argsLogPath
      ? `fs.writeFileSync(${JSON.stringify(options.argsLogPath)}, JSON.stringify(args), 'utf-8');`
      : '',
    "const outputDir = args[args.indexOf('--output_dir') + 1];",
    "const write = () => {",
    "  fs.mkdirSync(outputDir, { recursive: true });",
    `  fs.writeFileSync(path.join(outputDir, 'result.md'), ${JSON.stringify(markdown)}, 'utf-8');`,
    "};",
    options.delayMs ? `setTimeout(write, ${options.delayMs});` : 'write();',
  ].join('\n'), 'utf-8');
  return `${process.execPath} ${markerPath}`;
}

function writeTextLayerFallbackFixture(markdown: string): string {
  const fallbackPath = path.join(projectPath, 'text-layer-fallback-fixture.js');
  fs.writeFileSync(fallbackPath, [
    `process.stdout.write(JSON.stringify({`,
    `  ok: true,`,
    `  engine: 'pymupdf',`,
    `  markdown: ${JSON.stringify(markdown)},`,
    `}));`,
  ].join('\n'), 'utf-8');
  return `${process.execPath} ${fallbackPath}`;
}

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-pdf-skill-'));
  pdfPath = path.join(projectPath, 'paper.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.7\n% test fixture\n', 'utf-8');
  previousPdfSkillCliPath = process.env.CDF_PDF_SKILL_CLI_PATH;
  previousMarkerCommand = process.env.CDF_MARKER_COMMAND;
  previousMarkerDiscoveryTimeoutMs = process.env.CDF_MARKER_DISCOVERY_TIMEOUT_MS;
  previousTextLayerFallbackCommand = process.env.CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND;
  previousPath = process.env.PATH;
  process.env.CDF_PDF_SKILL_CLI_PATH = buildPdfSkillCliBundle(projectPath);
  delete process.env.CDF_MARKER_COMMAND;
  delete process.env.CDF_MARKER_DISCOVERY_TIMEOUT_MS;
  delete process.env.CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND;
});

afterEach(() => {
  resetPdfParseJobsForTests();
  if (previousPdfSkillCliPath === undefined) {
    delete process.env.CDF_PDF_SKILL_CLI_PATH;
  } else {
    process.env.CDF_PDF_SKILL_CLI_PATH = previousPdfSkillCliPath;
  }
  if (previousMarkerCommand === undefined) {
    delete process.env.CDF_MARKER_COMMAND;
  } else {
    process.env.CDF_MARKER_COMMAND = previousMarkerCommand;
  }
  if (previousMarkerDiscoveryTimeoutMs === undefined) {
    delete process.env.CDF_MARKER_DISCOVERY_TIMEOUT_MS;
  } else {
    process.env.CDF_MARKER_DISCOVERY_TIMEOUT_MS = previousMarkerDiscoveryTimeoutMs;
  }
  if (previousTextLayerFallbackCommand === undefined) {
    delete process.env.CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND;
  } else {
    process.env.CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND = previousTextLayerFallbackCommand;
  }
  if (previousPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = previousPath;
  }
  fs.rmSync(projectPath, { recursive: true, force: true });
});

describe('PDF Parsing Skill baseline artifact', () => {
  it('is discoverable and writes a project-local artifact instead of returning large parse JSON', async () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`));
    const skillMarkdown = fs.readFileSync(path.join(pdfSkillDir as string, 'SKILL.md'), 'utf-8');

    expect(pdfSkillDir).toBeTruthy();
    expect(skillMarkdown).toContain('PDF Parsing Skill');
    expect(skillMarkdown).toContain('## Failure Handling');
    expect(skillMarkdown).toContain('missing runtime chunks');
    expect(skillMarkdown).toContain('--disable_ocr');
    expect(skillMarkdown).toContain('MARKER_ALREADY_RUNNING');
    expect(skillMarkdown).toContain('TEXT_LAYER_FALLBACK_USED');
    expect(skillMarkdown).toContain('Do not create ad hoc parser scripts');
    expect(JSON.parse(fs.readFileSync(path.join(pdfSkillDir as string, 'entrypoints.json'), 'utf-8'))).toMatchObject({
      skill: 'pdf-parsing',
      globalToolsRemoved: ['parse_pdf', 'pdf_parse_status', 'pdf_parse_cancel'],
      scripts: {
        baselineParse: 'scripts/baseline-parse.js',
        ensureMarker: 'scripts/ensure-marker.js',
        discoverCapabilities: 'scripts/discover-capabilities.js',
        refreshRecoveryPlan: 'scripts/refresh-recovery-plan.js',
        setPreference: 'scripts/set-preference.js',
        clearPreference: 'scripts/clear-preference.js',
        applyRecovery: 'scripts/apply-recovery.js',
        finalizeView: 'scripts/finalize-view.js',
      },
    });
    for (const scriptFile of [
      'baseline-parse.js',
      'ensure-marker.js',
      'discover-capabilities.js',
      'refresh-recovery-plan.js',
      'set-preference.js',
      'clear-preference.js',
      'apply-recovery.js',
      'finalize-view.js',
    ]) {
      const content = fs.readFileSync(path.join(pdfSkillDir as string, 'scripts', scriptFile), 'utf-8');
      expect(content).toContain("skill: 'pdf-parsing'");
      expect(content).toContain('internalModule');
      expect(content).toContain('exportName');
    }

    const runner: MarkerRunner = {
      parse: async () => ({
        markdown: '<!-- page: 1 -->\n# Abstract\n\nParsed by Marker.\n\n| Metric | Value |',
        outputDir: projectPath,
        elapsedMs: 25,
      }),
    };

    const result = await parsePdfWithSkill(projectPath, pdfPath, {
      runner,
      now: () => new Date('2026-07-02T15:30:00.000Z'),
      createJobId: () => 'job-artifact',
    });

    expect(result.status).toBe('completed');
    expect(result.artifactDir).toBe(path.join(projectPath, '.cdf', 'pdf-parses', `2026-07-02T153000Z-${result.source.sha256.slice(0, 8)}`));
    expect(fs.existsSync(path.join(result.artifactDir, 'source.pdf'))).toBe(false);
    expect(fs.readFileSync(path.join(projectPath, '.gitignore'), 'utf-8')).toContain('.cdf/pdf-parses/');

    const metadata = JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'metadata.json'), 'utf-8'));
    expect(metadata).toMatchObject({
      artifactVersion: 1,
      artifactId: path.basename(result.artifactDir),
      source: {
        path: pdfPath,
        fileSize: fs.statSync(pdfPath).size,
        sha256: result.source.sha256,
      },
      baseline: {
        parser: 'marker',
        jobId: 'job-artifact',
      },
    });
    expect(metadata.createdAt).toBe('2026-07-02T15:30:00.000Z');

    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'baseline.json'), 'utf-8'))).toMatchObject({
      parser: 'marker',
      sourceFile: pdfPath,
      markdown: expect.stringContaining('Parsed by Marker.'),
    });
    expect(fs.readFileSync(path.join(result.artifactDir, 'recovered-view.md'), 'utf-8')).toContain('Parsed by Marker.');
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'diagnostics.json'), 'utf-8'))).toEqual(result.diagnostics);
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'overlays.json'), 'utf-8'))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'recovery-plan.json'), 'utf-8'))).toMatchObject({
      artifactId: path.basename(result.artifactDir),
      targets: [
        {
          kind: 'document',
          reasons: ['MISSING_TABLE_STRUCTURE'],
        },
      ],
      candidateRoutes: ['vision-capability', 'multimodal-agent'],
      requiresManualPageSelection: false,
    });
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'provenance.json'), 'utf-8'))).toMatchObject({
      baseline: {
        parser: 'marker',
        jobId: 'job-artifact',
      },
    });

    expect(result.conversationSummary).toContain(result.artifactDir);
    expect(result.conversationSummary).toContain('MISSING_TABLE_STRUCTURE');
    expect(result.conversationSummary).not.toContain('Parsed by Marker');
    expect(result.conversationSummary).not.toContain('"blocks"');
  });

  it('keeps Marker image references readable inside the baseline artifact', async () => {
    const imageBytes = Buffer.from('fake marker image bytes');
    const runner: MarkerRunner = {
      parse: async (input) => {
        fs.mkdirSync(input.outputDir, { recursive: true });
        fs.writeFileSync(path.join(input.outputDir, '_page_1_Figure_0.jpeg'), imageBytes);
        return {
          markdown: [
            '# Abstract',
            '',
            '<span id="page-1-0"></span>![](_page_1_Figure_0.jpeg)',
            '',
            'Parsed by Marker.',
          ].join('\n'),
          outputDir: input.outputDir,
          elapsedMs: 25,
        };
      },
    };

    const result = await parsePdfWithSkill(projectPath, pdfPath, {
      runner,
      now: () => new Date('2026-07-02T15:45:00.000Z'),
      createJobId: () => 'job-artifact-images',
    });

    expect(result.status).toBe('completed');
    expect(fs.readFileSync(path.join(result.artifactDir, 'recovered-view.md'), 'utf-8')).toContain('![](_page_1_Figure_0.jpeg)');
    expect(fs.readFileSync(path.join(result.artifactDir, '_page_1_Figure_0.jpeg'))).toEqual(imageBytes);
  });

  it('plans local-first recovery for blocks with weak source locations from the baseline parse', async () => {
    const runner: MarkerRunner = {
      parse: async () => ({
        markdown: [
          '# Abstract',
          'This paragraph has no Marker page anchor.',
          '',
          '## Method',
          'This paragraph also has no Marker page anchor.',
        ].join('\n'),
        outputDir: projectPath,
        elapsedMs: 25,
      }),
    };

    const result = await parsePdfWithSkill(projectPath, pdfPath, {
      runner,
      now: () => new Date('2026-07-02T15:50:00.000Z'),
      createJobId: () => 'job-weak-source-location',
    });

    expect(result.status).toBe('completed');
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'diagnostics.json'), 'utf-8'))).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'WEAK_SOURCE_LOCATION' }),
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'recovery-plan.json'), 'utf-8'))).toMatchObject({
      targets: [
        { kind: 'block', blockId: 'heading-0001', page: 1, reasons: ['WEAK_SOURCE_LOCATION'] },
        { kind: 'block', blockId: 'paragraph-0002', page: 1, reasons: ['WEAK_SOURCE_LOCATION'] },
        { kind: 'block', blockId: 'heading-0003', page: 1, reasons: ['WEAK_SOURCE_LOCATION'] },
        { kind: 'block', blockId: 'paragraph-0004', page: 1, reasons: ['WEAK_SOURCE_LOCATION'] },
      ],
      candidateRoutes: ['local-first'],
    });
  });

  it('writes a diagnostics artifact and recovery plan when Marker fails before a baseline exists', async () => {
    const runner: MarkerRunner = {
      parse: async () => {
        const error = new Error('Marker timed out.');
        (error as Error & { exitCode: number }).exitCode = -2;
        throw error;
      },
    };

    const result = await parsePdfWithSkill(projectPath, pdfPath, {
      runner,
      now: () => new Date('2026-07-02T16:00:00.000Z'),
      createJobId: () => 'job-timeout-artifact',
    });

    expect(result.status).toBe('failed');
    expect(result.artifactDir).toBe(path.join(projectPath, '.cdf', 'pdf-parses', `2026-07-02T160000Z-${result.source.sha256.slice(0, 8)}`));
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'diagnostics.json'), 'utf-8'))).toEqual([
      {
        severity: 'error',
        code: 'MARKER_TIMEOUT',
        message: 'Marker timed out.',
      },
    ]);
    expect(fs.existsSync(path.join(result.artifactDir, 'baseline.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'recovery-plan.json'), 'utf-8'))).toMatchObject({
      artifactId: path.basename(result.artifactDir),
      targets: [
        {
          kind: 'document',
          reasons: ['MARKER_TIMEOUT'],
        },
      ],
      candidateRoutes: ['local-first', 'vision-capability'],
    });
    expect(result.conversationSummary).toContain(result.artifactDir);
    expect(result.conversationSummary).toContain('MARKER_TIMEOUT');
  });

  it('baseline entrypoint script writes a failed artifact when Marker is unavailable', () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`));
    const missingMarkerCommand = path.join(projectPath, 'missing-marker-command');

    const output = execFileSync(process.execPath, [
      path.join(pdfSkillDir as string, 'scripts', 'baseline-parse.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_MARKER_COMMAND: missingMarkerCommand,
        CDF_PDF_PARSE_NOW: '2026-07-02T17:00:00.000Z',
      },
    });
    const result = JSON.parse(output);

    expect(result).toMatchObject({
      status: 'failed',
      diagnostics: [
        {
          severity: 'error',
          code: 'MARKER_UNAVAILABLE',
        },
      ],
      nextActions: [
        {
          kind: 'prepare-marker',
          script: expect.stringContaining('ensure-marker.js'),
          command: expect.stringContaining('ensure-marker.js'),
        },
      ],
    });
    expect(result.artifactDir).toBe(path.join(projectPath, '.cdf', 'pdf-parses', `2026-07-02T170000Z-${result.source.sha256.slice(0, 8)}`));
    expect(fs.existsSync(result.artifactDir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'metadata.json'), 'utf-8'))).toMatchObject({
      baseline: {
        parser: 'marker',
        status: 'failed',
      },
    });
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'diagnostics.json'), 'utf-8'))[0].code).toBe('MARKER_UNAVAILABLE');
    expect(fs.existsSync(path.join(result.artifactDir, 'recovery-plan.json'))).toBe(true);
  });

  it('baseline entrypoint script uses the internal parser contract for completed artifacts', () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`));
    const markerCommand = writeMarkerFixture([
      '<!-- page:1 -->',
      '# Abstract',
      '',
      '<!-- page:2 -->',
      '| Metric | Value |',
    ].join('\n'));

    const output = execFileSync(process.execPath, [
      path.join(pdfSkillDir as string, 'scripts', 'baseline-parse.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_MARKER_COMMAND: markerCommand,
        CDF_PDF_PARSE_NOW: '2026-07-02T17:30:00.000Z',
        CDF_PDF_PARSE_JOB_ID: 'job-script-baseline',
      },
    });
    const result = JSON.parse(output);

    expect(result.status).toBe('completed');
    expect(result.artifactDir).toBe(path.join(projectPath, '.cdf', 'pdf-parses', `2026-07-02T173000Z-${result.source.sha256.slice(0, 8)}`));
    const baseline = JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'baseline.json'), 'utf-8'));
    expect(baseline.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'heading', text: 'Abstract' }),
      expect.objectContaining({ type: 'table', text: '| Metric | Value |', pageStart: 2 }),
    ]));
    expect(baseline.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_TABLE_STRUCTURE' }),
    ]));
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'recovery-plan.json'), 'utf-8'))).toMatchObject({
      targets: [
        {
          kind: 'document',
          reasons: ['MISSING_TABLE_STRUCTURE'],
        },
      ],
      candidateRoutes: ['vision-capability', 'multimodal-agent'],
    });
    expect(result.conversationSummary).not.toContain('"blocks"');
  });

  it('baseline entrypoint script disables OCR for text-layer PDFs and records the decision', () => {
    fs.writeFileSync(pdfPath, [
      '%PDF-1.7',
      '1 0 obj << /Producer (pdfTeX-1.40.25) >> endobj',
      'stream',
      'BT',
      '(Autoregressive forecasting paper) Tj',
      'ET',
      'endstream',
    ].join('\n'), 'utf-8');
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`));
    const argsLogPath = path.join(projectPath, 'marker-args.json');
    const markerCommand = writeMarkerFixture('# Text-layer result', { argsLogPath });

    const output = execFileSync(process.execPath, [
      path.join(pdfSkillDir as string, 'scripts', 'baseline-parse.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_MARKER_COMMAND: markerCommand,
        CDF_PDF_PARSE_NOW: '2026-07-02T17:40:00.000Z',
        CDF_PDF_PARSE_JOB_ID: 'job-script-disable-ocr',
      },
    });
    const result = JSON.parse(output);

    expect(result.status).toBe('completed');
    expect(JSON.parse(fs.readFileSync(argsLogPath, 'utf-8'))).toContain('--disable_ocr');
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'diagnostics.json'), 'utf-8'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'info', code: 'TEXT_LAYER_OCR_DISABLED' }),
    ]));
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'metadata.json'), 'utf-8'))).toMatchObject({
      baseline: {
        parser: 'marker',
        ocr: {
          disabled: true,
          reason: 'text-layer-preflight',
        },
      },
    });
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'provenance.json'), 'utf-8'))).toMatchObject({
      baseline: {
        ocr: {
          disabled: true,
          reason: 'text-layer-preflight',
        },
      },
    });
  });

  it('baseline entrypoint script uses the text-layer fallback when Marker is unavailable', () => {
    fs.writeFileSync(pdfPath, [
      '%PDF-1.7',
      '1 0 obj << /Creator (LaTeX) >> endobj',
      'stream',
      'BT',
      '(A readable text layer) Tj',
      'ET',
      'endstream',
    ].join('\n'), 'utf-8');
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`));
    const missingMarkerCommand = path.join(projectPath, 'missing-marker-command');
    const fallbackCommand = writeTextLayerFallbackFixture('# Fallback text\n\nRecovered without OCR.');

    const output = execFileSync(process.execPath, [
      path.join(pdfSkillDir as string, 'scripts', 'baseline-parse.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_MARKER_COMMAND: missingMarkerCommand,
        CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND: fallbackCommand,
        CDF_PDF_PARSE_NOW: '2026-07-02T17:50:00.000Z',
        CDF_PDF_PARSE_JOB_ID: 'job-script-text-fallback',
      },
    });
    const result = JSON.parse(output);

    expect(result.status).toBe('completed');
    const baseline = JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'baseline.json'), 'utf-8'));
    expect(baseline).toMatchObject({
      parser: 'pymupdf-text-layer',
      markdown: expect.stringContaining('Recovered without OCR.'),
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', code: 'MARKER_UNAVAILABLE' }),
        expect.objectContaining({ severity: 'info', code: 'TEXT_LAYER_FALLBACK_USED' }),
      ]),
    });
    expect(JSON.parse(fs.readFileSync(path.join(result.artifactDir, 'metadata.json'), 'utf-8'))).toMatchObject({
      baseline: {
        parser: 'pymupdf-text-layer',
        fallback: {
          engine: 'pymupdf-text-layer',
          reason: 'marker-failure-text-layer',
        },
      },
    });
    expect(result.conversationSummary).toContain('TEXT_LAYER_FALLBACK_USED');
  });

  it('baseline entrypoint script waits for completion instead of returning a cross-process running job', () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`));
    const markerCommand = writeMarkerFixture('# Delayed marker result', { delayMs: 20 });

    const output = execFileSync(process.execPath, [
      path.join(pdfSkillDir as string, 'scripts', 'baseline-parse.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_MARKER_COMMAND: markerCommand,
        CDF_PDF_PARSE_NOW: '2026-07-02T17:45:00.000Z',
        CDF_PDF_PARSE_JOB_ID: 'job-script-wait',
        CDF_PDF_SKILL_BASELINE_TIMEOUT_MS: '1',
      },
    });
    const result = JSON.parse(output);

    expect(result.status).toBe('completed');
    expect(result).not.toHaveProperty('jobId');
    expect(fs.readFileSync(path.join(result.artifactDir, 'recovered-view.md'), 'utf-8')).toContain('Delayed marker result');
  });

  it('recovery entrypoint scripts update preference, apply recovery results, and finalize the recovered view', () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`)) as string;
    const markerCommand = writeMarkerFixture('<!-- page: 1 -->\n| Metric | Value |');
    const baselineOutput = execFileSync(process.execPath, [
      path.join(pdfSkillDir, 'scripts', 'baseline-parse.js'),
      '--project',
      projectPath,
      '--file',
      pdfPath,
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_MARKER_COMMAND: markerCommand,
        CDF_PDF_PARSE_NOW: '2026-07-02T18:00:00.000Z',
        CDF_PDF_PARSE_JOB_ID: 'job-script-recovery',
      },
    });
    const baselineResult = JSON.parse(baselineOutput);
    const artifactDir = baselineResult.artifactDir;

    const setPreferenceOutput = execFileSync(process.execPath, [
      path.join(pdfSkillDir, 'scripts', 'set-preference.js'),
      '--project',
      projectPath,
      '--route',
      'vision-capability',
    ], { encoding: 'utf-8' });
    expect(JSON.parse(setPreferenceOutput)).toMatchObject({
      status: 'completed',
      preference: { route: 'vision-capability' },
    });
    expect(fs.readFileSync(path.join(projectPath, 'AGENTS.md'), 'utf-8')).toContain('- route: vision-capability');

    const refreshOutput = execFileSync(process.execPath, [
      path.join(pdfSkillDir, 'scripts', 'refresh-recovery-plan.js'),
      '--artifact',
      artifactDir,
    ], { encoding: 'utf-8' });
    expect(JSON.parse(refreshOutput)).toMatchObject({
      status: 'completed',
      plan: {
        candidateRoutes: ['vision-capability', 'multimodal-agent'],
      },
    });

    const resultsFile = path.join(projectPath, 'recovery-results.json');
    fs.writeFileSync(resultsFile, JSON.stringify([
      { ok: true, markdown: '| Metric | Value |\n| --- | --- |\n| Accuracy | 0.99 |' },
    ]), 'utf-8');
    const applyOutput = execFileSync(process.execPath, [
      path.join(pdfSkillDir, 'scripts', 'apply-recovery.js'),
      '--artifact',
      artifactDir,
      '--route',
      'vision-capability',
      '--plan-confirmed',
      '--results-file',
      resultsFile,
      '--capability-label',
      'test vision capability',
    ], { encoding: 'utf-8' });
    expect(JSON.parse(applyOutput)).toMatchObject({
      status: 'completed',
      overlays: [
        expect.objectContaining({
          markdown: expect.stringContaining('Accuracy'),
          provenance: expect.objectContaining({
            recoveryCapability: 'test vision capability',
            route: 'vision-capability',
          }),
        }),
      ],
    });

    const finalizeOutput = execFileSync(process.execPath, [
      path.join(pdfSkillDir, 'scripts', 'finalize-view.js'),
      '--artifact',
      artifactDir,
    ], { encoding: 'utf-8' });
    expect(JSON.parse(finalizeOutput)).toMatchObject({ status: 'completed' });
    expect(fs.readFileSync(path.join(artifactDir, 'recovered-view.md'), 'utf-8')).toContain('| Accuracy | 0.99 |');
  });
});

describe('Project PDF recovery preference in AGENTS.md', () => {
  it('manages only the CDF pdf recovery block and reuses the route only when no new risk is introduced', () => {
    const agentsPath = path.join(projectPath, 'AGENTS.md');
    fs.writeFileSync(agentsPath, '# Project Rules\n\nKeep this instruction.\n', 'utf-8');

    updatePdfRecoveryPreference(projectPath, {
      route: 'vision-capability',
      askAgainWhen: 'new-cost-or-privacy-risk',
    });

    expect(fs.readFileSync(agentsPath, 'utf-8')).toBe([
      '# Project Rules',
      '',
      'Keep this instruction.',
      '',
      '<!-- CDF:pdf-recovery:start -->',
      'PDF recovery preference:',
      '- route: vision-capability',
      '- askAgainWhen: new-cost-or-privacy-risk',
      '<!-- CDF:pdf-recovery:end -->',
      '',
    ].join('\n'));
    expect(readPdfRecoveryPreference(projectPath)).toEqual({
      route: 'vision-capability',
      askAgainWhen: 'new-cost-or-privacy-risk',
    });

    updatePdfRecoveryPreference(projectPath, {
      route: 'local-first',
      askAgainWhen: 'new-cost-or-privacy-risk',
    });
    expect(readPdfRecoveryPreference(projectPath)?.route).toBe('local-first');
    expect(fs.readFileSync(agentsPath, 'utf-8')).toContain('Keep this instruction.');
    expect(fs.readFileSync(agentsPath, 'utf-8').match(/CDF:pdf-recovery:start/g)).toHaveLength(1);

    expect(() => updatePdfRecoveryPreference(projectPath, {
      route: 'openai:gpt-4.1' as any,
      askAgainWhen: 'new-cost-or-privacy-risk',
    })).toThrow('PDF Recovery Preference stores route categories only');

    expect(resolvePdfRecoveryPreferenceForPlan(projectPath, {
      candidateRoutes: ['local-first', 'vision-capability'],
      introducesNewRisk: false,
    })).toEqual({
      action: 'reuse',
      preference: {
        route: 'local-first',
        askAgainWhen: 'new-cost-or-privacy-risk',
      },
    });
    expect(resolvePdfRecoveryPreferenceForPlan(projectPath, {
      candidateRoutes: ['local-first', 'vision-capability'],
      introducesNewRisk: true,
    })).toMatchObject({
      action: 'ask',
      reason: 'new-cost-or-privacy-risk',
    });

    clearPdfRecoveryPreference(projectPath);
    expect(readPdfRecoveryPreference(projectPath)).toBeNull();
    expect(fs.readFileSync(agentsPath, 'utf-8')).toBe('# Project Rules\n\nKeep this instruction.\n');

    fs.writeFileSync(agentsPath, [
      '<!-- CDF:pdf-recovery:start -->',
      'PDF recovery preference:',
      '- route: minimax-m3',
      '<!-- CDF:pdf-recovery:end -->',
      '',
    ].join('\n'), 'utf-8');
    expect(readPdfRecoveryPreference(projectPath)).toBeNull();
  });
});

describe('Automatic PDF Recovery Plan', () => {
  it('selects recovery targets from baseline diagnostics and parse evidence without manual page selection', () => {
    const plan = generatePdfRecoveryPlan({
      artifactId: 'parse-1',
      baseline: {
        parser: 'marker',
        sourceFile: pdfPath,
        markdown: '# Result\n\n![scan](page-1.png)',
        diagnostics: [
          { severity: 'error', code: 'MARKER_TIMEOUT', message: 'Marker timed out.', page: 2 },
          { severity: 'warning', code: 'OCR_ARTIFACTS', message: 'Bad OCR.', page: 3 },
          { severity: 'warning', code: 'FIGURE_ONLY_CONTENT', message: 'Figure only.', page: 4 },
          { severity: 'warning', code: 'MISSING_TABLE_STRUCTURE', message: 'Table weak.', page: 5 },
          { severity: 'warning', code: 'WEAK_SOURCE_LOCATION', message: 'Weak location.' },
        ],
        blocks: [
          {
            id: 'paragraph-0001',
            type: 'paragraph',
            text: 'No marker anchor here.',
            section: 'Intro',
            pageStart: 1,
            pageEnd: 1,
            location: {
              pageStart: 1,
              pageEnd: 1,
              section: 'Intro',
            },
          },
        ],
      },
    });

    expect(plan.requiresManualPageSelection).toBe(false);
    expect(plan.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'page', page: 2, reasons: ['MARKER_TIMEOUT'] }),
      expect.objectContaining({ kind: 'page', page: 3, reasons: ['OCR_ARTIFACTS'] }),
      expect.objectContaining({ kind: 'page', page: 4, reasons: ['FIGURE_ONLY_CONTENT'] }),
      expect.objectContaining({ kind: 'page', page: 5, reasons: ['MISSING_TABLE_STRUCTURE'] }),
      expect.objectContaining({ kind: 'block', blockId: 'paragraph-0001', page: 1, reasons: ['WEAK_SOURCE_LOCATION'] }),
    ]));
    expect(plan.candidateRoutes).toEqual(['local-first', 'vision-capability', 'multimodal-agent']);
    expect(plan.routeRisks).toEqual(expect.arrayContaining(['network', 'metered-provider', 'page-or-text-upload']));
    expect(plan.requiresPlanConfirmation).toBe(true);
    expect(plan.targets.flatMap((target) => target.reasons)).toEqual(expect.arrayContaining([
      'MARKER_TIMEOUT',
      'OCR_ARTIFACTS',
      'FIGURE_ONLY_CONTENT',
      'MISSING_TABLE_STRUCTURE',
      'WEAK_SOURCE_LOCATION',
    ]));
  });
});

describe('PDF recovery capability discovery', () => {
  it('discovers route-category capabilities and filters route choices to viable routes', () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`)) as string;
    const manifest = JSON.parse(fs.readFileSync(path.join(pdfSkillDir, 'entrypoints.json'), 'utf-8'));

    expect(manifest.scripts.discoverCapabilities).toBe('scripts/discover-capabilities.js');
    expect(fs.readFileSync(path.join(pdfSkillDir, 'scripts', 'discover-capabilities.js'), 'utf-8')).toContain('discoverPdfRecoveryCapabilities');

    const discovery = discoverPdfRecoveryCapabilities({
      localMarker: { available: true, commandSource: 'CDF_MARKER_COMMAND' },
      mcpTools: [
        {
          name: 'read_page_image',
          description: 'Recover OCR and table structure from a PDF page screenshot.',
          serverName: 'paper-vision',
        },
      ],
      agentModel: {
        configured: true,
        supportsPageImages: true,
        providerType: 'minimax',
        modelName: 'm3',
      },
    });

    expect(discovery.viableRoutes).toEqual(['local-first', 'vision-capability', 'multimodal-agent']);
    expect(discovery.capabilities).toEqual([
      expect.objectContaining({
        route: 'local-first',
        capabilitySource: 'local Marker-compatible recovery command',
        applicableReasons: expect.arrayContaining(['MARKER_TIMEOUT', 'WEAK_SOURCE_LOCATION']),
      }),
      expect.objectContaining({
        route: 'vision-capability',
        capabilitySource: 'MCP vision-capable tool',
        privacyNetworkBehavior: expect.stringContaining('MCP'),
        applicableReasons: expect.arrayContaining(['MARKER_TIMEOUT', 'OCR_ARTIFACTS', 'FIGURE_ONLY_CONTENT', 'MISSING_TABLE_STRUCTURE']),
      }),
      expect.objectContaining({
        route: 'multimodal-agent',
        capabilitySource: 'configured multimodal Agent capability',
        possibleCost: expect.stringContaining('metered'),
        applicableReasons: expect.arrayContaining(['OCR_ARTIFACTS', 'FIGURE_ONLY_CONTENT', 'MISSING_TABLE_STRUCTURE']),
      }),
    ]);
    expect(JSON.stringify(discovery)).not.toContain('minimax');
    expect(JSON.stringify(discovery)).not.toContain('m3');

    const plan = {
      artifactId: 'parse-1',
      targets: [{ kind: 'page' as const, page: 3, reasons: ['OCR_ARTIFACTS' as const] }],
      candidateRoutes: ['local-first', 'vision-capability', 'multimodal-agent'] as const,
      routeRisks: ['network', 'metered-provider', 'page-or-text-upload'] as const,
      requiresPlanConfirmation: true as const,
      requiresManualPageSelection: false as const,
    };
    const visionOnlyDiscovery = discoverPdfRecoveryCapabilities({
      mcpTools: [
        {
          name: 'inspect_screenshot',
          description: 'Analyze visual page images.',
          serverName: 'paper-vision',
        },
      ],
    });

    const options = summarizePdfRecoveryRoutes(plan, { capabilityDiscovery: visionOnlyDiscovery });
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      route: 'vision-capability',
      capabilitySource: 'MCP vision-capable tool',
    });

    updatePdfRecoveryPreference(projectPath, {
      route: 'local-first',
      askAgainWhen: 'new-cost-or-privacy-risk',
    });
    expect(decidePdfRecoveryRoute(projectPath, plan, {
      capabilityDiscovery: visionOnlyDiscovery,
      introducesNewRisk: false,
    })).toMatchObject({
      status: 'needs-route-choice',
      reason: 'unavailable-preference',
      options: [expect.objectContaining({ route: 'vision-capability' })],
    });
  });

  it('returns diagnostics and next actions when no discovered capability can satisfy the plan', () => {
    const localOnlyDiscovery = discoverPdfRecoveryCapabilities({
      localMarker: { available: true, commandSource: 'CDF_MARKER_COMMAND' },
    });
    const plan = {
      artifactId: 'parse-1',
      targets: [{ kind: 'page' as const, page: 3, reasons: ['OCR_ARTIFACTS' as const] }],
      candidateRoutes: ['vision-capability', 'multimodal-agent'] as const,
      routeRisks: ['network', 'metered-provider', 'page-or-text-upload'] as const,
      requiresPlanConfirmation: true as const,
      requiresManualPageSelection: false as const,
    };

    expect(decidePdfRecoveryRoute(projectPath, plan, {
      capabilityDiscovery: localOnlyDiscovery,
    })).toMatchObject({
      status: 'no-viable-capability',
      diagnostics: [
        {
          severity: 'warning',
          code: 'PDF_RECOVERY_CAPABILITY_UNAVAILABLE',
        },
      ],
      nextActions: [
        expect.objectContaining({ kind: 'connect-vision-mcp' }),
        expect.objectContaining({ kind: 'configure-multimodal-agent' }),
      ],
      options: [],
      requiresPlanConfirmation: false,
    });

    const emptyDiscovery = discoverPdfRecoveryCapabilities();
    expect(emptyDiscovery).toMatchObject({
      viableRoutes: [],
      diagnostics: [
        {
          severity: 'warning',
          code: 'PDF_RECOVERY_CAPABILITY_UNAVAILABLE',
        },
      ],
      nextActions: [
        expect.objectContaining({ kind: 'prepare-marker' }),
        expect.objectContaining({ kind: 'connect-vision-mcp' }),
        expect.objectContaining({ kind: 'configure-multimodal-agent' }),
      ],
    });
  });

  it('discovery entrypoint script returns route-category capabilities from runtime metadata', () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`)) as string;
    const metadataFile = path.join(projectPath, 'runtime-metadata.json');
    fs.writeFileSync(metadataFile, JSON.stringify({
      localMarker: { available: false, commandSource: 'test-fixture' },
      mcpTools: [
        {
          name: 'inspect_page_image',
          description: 'Inspect PDF page image crops.',
          serverName: 'paper-vision',
        },
      ],
      agentModel: {
        configured: true,
        supportsMultimodal: true,
        providerType: 'custom-provider',
        modelName: 'layout-vision-model',
      },
    }), 'utf-8');

    const output = execFileSync(process.execPath, [
      path.join(pdfSkillDir, 'scripts', 'discover-capabilities.js'),
      '--runtime-metadata',
      metadataFile,
    ], { encoding: 'utf-8' });
    const result = JSON.parse(output);

    expect(result).toMatchObject({
      status: 'completed',
      viableRoutes: ['vision-capability', 'multimodal-agent'],
      capabilities: [
        expect.objectContaining({ route: 'vision-capability', capabilitySource: 'MCP vision-capable tool' }),
        expect.objectContaining({ route: 'multimodal-agent', capabilitySource: 'configured multimodal Agent capability' }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain('custom-provider');
    expect(JSON.stringify(result)).not.toContain('layout-vision-model');
  });

  it('discovery entrypoint probes the default uvx Marker command and ignores invalid timeout env values', () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`)) as string;
    const uvxPath = path.join(projectPath, 'uvx');
    const probeLog = path.join(projectPath, 'uvx-probe.json');
    fs.writeFileSync(uvxPath, [
      '#!/usr/bin/env node',
      'const fs = require("fs");',
      'fs.writeFileSync(process.env.CDF_MARKER_PROBE_LOG, JSON.stringify(process.argv.slice(2)), "utf-8");',
      'process.exit(process.argv.includes("--help") ? 0 : 2);',
    ].join('\n'), 'utf-8');
    fs.chmodSync(uvxPath, 0o755);

    const output = execFileSync(process.execPath, [
      path.join(pdfSkillDir, 'scripts', 'discover-capabilities.js'),
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${projectPath}${path.delimiter}${process.env.PATH ?? ''}`,
        CDF_MARKER_COMMAND: '',
        CDF_MARKER_DISCOVERY_TIMEOUT_MS: 'not-a-number',
        CDF_MARKER_PROBE_LOG: probeLog,
      },
    });
    const result = JSON.parse(output);

    expect(JSON.parse(fs.readFileSync(probeLog, 'utf-8'))).toEqual(['--from', 'marker-pdf', 'marker_single', '--help']);
    expect(result).toMatchObject({
      status: 'completed',
      viableRoutes: ['local-first'],
      capabilities: [
        expect.objectContaining({
          route: 'local-first',
          capabilitySource: 'local Marker-compatible recovery command',
        }),
      ],
    });
  });

  it('discovery entrypoint preserves quoted arguments in the configured Marker command', () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`)) as string;
    const markerProbe = path.join(projectPath, 'marker-probe.js');
    const profileName = 'layout profile with spaces';
    fs.writeFileSync(markerProbe, [
      'const expected = `--profile=${process.env.CDF_EXPECTED_MARKER_PROFILE}`;',
      'process.exit(process.argv.includes(expected) && process.argv.includes("--help") ? 0 : 2);',
    ].join('\n'), 'utf-8');

    const output = execFileSync(process.execPath, [
      path.join(pdfSkillDir, 'scripts', 'discover-capabilities.js'),
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_MARKER_COMMAND: `${process.execPath} ${markerProbe} --profile="${profileName}"`,
        CDF_EXPECTED_MARKER_PROFILE: profileName,
      },
    });
    const result = JSON.parse(output);

    expect(result).toMatchObject({
      status: 'completed',
      viableRoutes: ['local-first'],
    });
  });

  it('discovery entrypoint preserves unquoted Windows-style backslashes in the configured Marker command', () => {
    const builtInSkillDirs = getBuiltInSkillDirs();
    const pdfSkillDir = builtInSkillDirs.find((skillDir) => skillDir.endsWith(`${path.sep}pdf-parsing`)) as string;
    const markerProbe = path.join(projectPath, 'marker-probe.js');
    const windowsMarkerPath = 'C:\\tools\\marker.exe';
    fs.writeFileSync(markerProbe, [
      'const expected = process.env.CDF_EXPECTED_MARKER_PATH;',
      'process.exit(process.argv.includes(expected) && process.argv.includes("--help") ? 0 : 2);',
    ].join('\n'), 'utf-8');

    const output = execFileSync(process.execPath, [
      path.join(pdfSkillDir, 'scripts', 'discover-capabilities.js'),
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_MARKER_COMMAND: `${process.execPath} ${markerProbe} ${windowsMarkerPath}`,
        CDF_EXPECTED_MARKER_PATH: windowsMarkerPath,
      },
    });
    const result = JSON.parse(output);

    expect(result).toMatchObject({
      status: 'completed',
      viableRoutes: ['local-first'],
    });
  });
});

describe('PDF recovery route choice and plan-level confirmation', () => {
  it('summarizes route choices, reuses safe preferences, re-prompts on new risk, and records approval state', () => {
    const plan = {
      artifactId: 'parse-1',
      targets: [{ kind: 'page' as const, page: 3, reasons: ['OCR_ARTIFACTS' as const] }],
      candidateRoutes: ['vision-capability', 'multimodal-agent'] as const,
      routeRisks: ['network', 'metered-provider', 'page-or-text-upload'] as const,
      requiresPlanConfirmation: true as const,
      requiresManualPageSelection: false as const,
    };

    const options = summarizePdfRecoveryRoutes(plan);
    expect(options).toEqual([
      expect.objectContaining({
        route: 'vision-capability',
        capabilitySource: expect.stringContaining('vision-capable'),
        privacyNetworkBehavior: expect.stringContaining('network'),
        possibleCost: expect.stringContaining('metered'),
        processingScope: '1 recovery target',
      }),
      expect.objectContaining({
        route: 'multimodal-agent',
        qualityExpectation: expect.stringContaining('layout'),
      }),
    ]);

    expect(decidePdfRecoveryRoute(projectPath, plan)).toMatchObject({
      status: 'needs-route-choice',
      options,
    });

    updatePdfRecoveryPreference(projectPath, {
      route: 'vision-capability',
      askAgainWhen: 'new-cost-or-privacy-risk',
    });
    expect(decidePdfRecoveryRoute(projectPath, {
      ...plan,
      routeRisks: [],
      requiresPlanConfirmation: false,
    }, { introducesNewRisk: false })).toMatchObject({
      status: 'selected',
      route: 'vision-capability',
      planLevelConfirmed: true,
      source: 'preference',
    });
    expect(decidePdfRecoveryRoute(projectPath, plan, { introducesNewRisk: false })).toMatchObject({
      status: 'needs-plan-confirmation',
      route: 'vision-capability',
    });
    expect(decidePdfRecoveryRoute(projectPath, plan, { introducesNewRisk: true })).toMatchObject({
      status: 'needs-route-choice',
      reason: 'new-cost-or-privacy-risk',
    });
    expect(decidePdfRecoveryRoute(projectPath, plan, {
      selectedRoute: 'vision-capability',
      planLevelConfirmed: false,
    })).toMatchObject({
      status: 'needs-plan-confirmation',
      route: 'vision-capability',
    });

    const approved = decidePdfRecoveryRoute(projectPath, plan, {
      selectedRoute: 'vision-capability',
      planLevelConfirmed: true,
    });
    expect(approved).toMatchObject({
      status: 'selected',
      route: 'vision-capability',
      planLevelConfirmed: true,
      source: 'user',
    });

    expect(summarizePdfRecoveryRoutes({
      targets: [{ kind: 'document' as const, reasons: ['WEAK_SOURCE_LOCATION' as const] }],
      candidateRoutes: ['ask-each-time'] as const,
      routeRisks: [] as const,
    })).toEqual([
      expect.objectContaining({
        route: 'ask-each-time',
        capabilitySource: 'manual route choice',
      }),
    ]);

    expect(decidePdfRecoveryRoute(projectPath, {
      targets: [{ kind: 'document' as const, reasons: ['WEAK_SOURCE_LOCATION' as const] }],
      candidateRoutes: ['ask-each-time'] as const,
      routeRisks: [] as const,
      requiresPlanConfirmation: false as const,
    }, {
      selectedRoute: 'ask-each-time',
    })).toMatchObject({
      status: 'selected',
      route: 'ask-each-time',
      planLevelConfirmed: true,
      source: 'user',
    });

    const artifactDir = path.join(projectPath, '.cdf', 'pdf-parses', 'parse-1');
    fs.mkdirSync(artifactDir, { recursive: true });
    recordPdfRecoveryRouteSelection(artifactDir, approved);
    expect(JSON.parse(fs.readFileSync(path.join(artifactDir, 'run-state.json'), 'utf-8'))).toMatchObject({
      recoveryRoute: {
        route: 'vision-capability',
        planLevelConfirmed: true,
        source: 'user',
      },
    });
  });

  it('preserves plan confirmation gates and only narrows declared risks with discovery', () => {
    const discovery = discoverPdfRecoveryCapabilities({
      mcpTools: [
        {
          name: 'inspect_page_image',
          description: '分析 PDF 页面截图。',
          serverName: 'paper-vision',
        },
      ],
    });
    const riskyPlan = {
      artifactId: 'parse-risk',
      targets: [{ kind: 'page' as const, page: 2, reasons: ['MARKER_TIMEOUT' as const] }],
      candidateRoutes: ['local-first', 'vision-capability'] as const,
      routeRisks: ['network'] as const,
      requiresPlanConfirmation: true as const,
      requiresManualPageSelection: false as const,
    };

    expect(discovery).toMatchObject({
      viableRoutes: ['vision-capability'],
      capabilities: [
        expect.objectContaining({
          route: 'vision-capability',
          applicableReasons: expect.arrayContaining(['MARKER_TIMEOUT']),
        }),
      ],
    });
    expect(decidePdfRecoveryRoute(projectPath, riskyPlan, {
      capabilityDiscovery: discovery,
      selectedRoute: 'vision-capability',
      planLevelConfirmed: false,
    })).toMatchObject({
      status: 'needs-plan-confirmation',
      route: 'vision-capability',
      routeRisks: ['network'],
    });

    expect(decidePdfRecoveryRoute(projectPath, {
      targets: [{ kind: 'document' as const, reasons: ['WEAK_SOURCE_LOCATION' as const] }],
      candidateRoutes: ['local-first'] as const,
      routeRisks: [] as const,
      requiresPlanConfirmation: true as const,
    }, {
      selectedRoute: 'local-first',
      planLevelConfirmed: false,
    })).toMatchObject({
      status: 'needs-plan-confirmation',
      route: 'local-first',
      routeRisks: [],
    });
  });
});

describe('PDF recovery capability execution and overlays', () => {
  it('executes an approved plan through a mocked capability and records partial failures as diagnostics', async () => {
    const artifactDir = path.join(projectPath, '.cdf', 'pdf-parses', 'parse-1');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'diagnostics.json'), '[]\n', 'utf-8');
    fs.writeFileSync(path.join(artifactDir, 'provenance.json'), JSON.stringify({ baseline: { parser: 'marker' }, recovery: [] }, null, 2), 'utf-8');

    const plan = {
      artifactId: 'parse-1',
      targets: [
        { kind: 'page' as const, page: 3, reasons: ['OCR_ARTIFACTS' as const] },
        { kind: 'block' as const, blockId: 'table-0001', page: 4, reasons: ['MISSING_TABLE_STRUCTURE' as const] },
      ],
      candidateRoutes: ['vision-capability'] as const,
      routeRisks: ['network', 'metered-provider', 'page-or-text-upload'] as const,
      requiresPlanConfirmation: true as const,
      requiresManualPageSelection: false as const,
    };

    const result = await executePdfRecoveryPlan(artifactDir, plan, {
      status: 'selected',
      route: 'vision-capability',
      planLevelConfirmed: true,
      source: 'user',
      routeRisks: [...plan.routeRisks],
    }, {
      route: 'vision-capability',
      label: 'mock vision capability',
      recover: async (target) => {
        if (target.blockId === 'table-0001') {
          return { ok: false, message: 'table image unavailable' };
        }
        return {
          ok: true,
          markdown: 'Recovered OCR text for page 3.',
        };
      },
    });

    expect(result.overlays).toEqual([
      expect.objectContaining({
        id: 'overlay-0001',
        markdown: 'Recovered OCR text for page 3.',
        provenance: {
          recoveryCapability: 'mock vision capability',
          route: 'vision-capability',
          source: { kind: 'page', page: 3 },
          diagnosticCode: 'OCR_ARTIFACTS',
          meteredNetworkApproved: true,
        },
      }),
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'RECOVERY_FAILED',
        page: 4,
        message: expect.stringContaining('table image unavailable'),
      }),
    ]);

    const overlays = JSON.parse(fs.readFileSync(path.join(artifactDir, 'overlays.json'), 'utf-8'));
    expect(overlays[0]).not.toHaveProperty('fullPrompt');
    expect(overlays[0]).not.toHaveProperty('fullProviderResponse');
    expect(overlays[0]).not.toHaveProperty('pageImageCopy');
    expect(overlays[0]).not.toHaveProperty('baselineDiff');
    expect(JSON.parse(fs.readFileSync(path.join(artifactDir, 'diagnostics.json'), 'utf-8'))).toEqual(result.diagnostics);
    expect(JSON.parse(fs.readFileSync(path.join(artifactDir, 'provenance.json'), 'utf-8')).recovery).toEqual([
      result.overlays[0].provenance,
    ]);
  });
});

describe('Recovered Paper Parse View and recovery reruns', () => {
  it('generates the best recovered view and reuses the baseline unless a full reparse is required', () => {
    const artifactDir = path.join(projectPath, '.cdf', 'pdf-parses', 'parse-1');
    fs.mkdirSync(artifactDir, { recursive: true });
    const sourceSha256 = 'a'.repeat(64);
    const baseline = {
      parser: 'marker' as const,
      sourceFile: pdfPath,
      markdown: '# Results\n\nOriginal table placeholder.\n\nOriginal table placeholder.\n',
      diagnostics: [],
      blocks: [
        {
          id: 'table-0001',
          type: 'table' as const,
          text: 'Original table placeholder.',
          section: 'Results',
          pageStart: 2,
          pageEnd: 2,
          location: {
            pageStart: 2,
            pageEnd: 2,
            section: 'Results',
            markerAnchor: 'page:2',
          },
        },
        {
          id: 'table-0002',
          type: 'table' as const,
          text: 'Original table placeholder.',
          section: 'Results',
          pageStart: 3,
          pageEnd: 3,
          location: {
            pageStart: 3,
            pageEnd: 3,
            section: 'Results',
            markerAnchor: 'page:3',
          },
        },
      ],
    };
    fs.writeFileSync(path.join(artifactDir, 'metadata.json'), JSON.stringify({
      source: {
        path: pdfPath,
        sha256: sourceSha256,
      },
    }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(artifactDir, 'baseline.json'), JSON.stringify(baseline, null, 2), 'utf-8');

    const result = finalizeRecoveredPaperParseView(artifactDir, baseline, [
      {
        id: 'overlay-0001',
        target: { kind: 'block', blockId: 'table-0002', page: 3, reasons: ['MISSING_TABLE_STRUCTURE'] },
        markdown: '| Metric | Value |\n| --- | --- |\n| Accuracy | 0.99 |',
        provenance: {
          recoveryCapability: 'mock vision capability',
          route: 'vision-capability',
          source: { kind: 'block', page: 3, blockId: 'table-0002' },
          diagnosticCode: 'MISSING_TABLE_STRUCTURE',
          meteredNetworkApproved: true,
        },
      },
    ], [
      {
        severity: 'warning',
        code: 'RECOVERY_FAILED',
        message: 'Figure recovery failed.',
        page: 5,
      },
    ], { comparisonTraceEnabled: false });

    expect(result.recoveredMarkdown).toContain('| Accuracy | 0.99 |');
    expect(result.recoveredMarkdown.match(/Original table placeholder\./g)).toHaveLength(1);
    expect(result.recoveredMarkdown.indexOf('Original table placeholder.')).toBeLessThan(result.recoveredMarkdown.indexOf('| Accuracy | 0.99 |'));
    expect(fs.readFileSync(path.join(artifactDir, 'recovered-view.md'), 'utf-8')).toBe(result.recoveredMarkdown);
    expect(JSON.parse(fs.readFileSync(path.join(artifactDir, 'overlays.json'), 'utf-8'))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(artifactDir, 'diagnostics.json'), 'utf-8'))[0].code).toBe('RECOVERY_FAILED');
    expect(fs.existsSync(path.join(artifactDir, 'comparison-trace.json'))).toBe(false);
    expect(result.conversationSummary).toContain('best recovered PDF parse');
    expect(result.conversationSummary).toContain('RECOVERY_FAILED');
    expect(result.conversationSummary).not.toContain('baseline-vs-recovery');

    const imageArtifactDir = path.join(projectPath, '.cdf', 'pdf-parses', 'parse-images');
    fs.mkdirSync(imageArtifactDir, { recursive: true });
    const imageSourcePath = path.join(projectPath, '_page_2_Figure_0.jpeg');
    const imageBytes = Buffer.from('finalized marker image bytes');
    fs.writeFileSync(imageSourcePath, imageBytes);
    const imageBaseline = {
      ...baseline,
      markdown: '# Figure\n\n![](_page_2_Figure_0.jpeg)\n',
      blocks: [
        {
          id: 'figure-0001',
          type: 'figure' as const,
          text: '![](_page_2_Figure_0.jpeg)',
          section: 'Figure',
          pageStart: 2,
          pageEnd: 2,
          location: {
            pageStart: 2,
            pageEnd: 2,
            section: 'Figure',
            markerAnchor: 'page:2',
            imagePath: imageSourcePath,
          },
        },
      ],
    };
    finalizeRecoveredPaperParseView(imageArtifactDir, imageBaseline, [], [], { comparisonTraceEnabled: false });
    expect(fs.readFileSync(path.join(imageArtifactDir, '_page_2_Figure_0.jpeg'))).toEqual(imageBytes);

    expect(shouldRerunMarkerBaseline(artifactDir, {
      sourcePath: pdfPath,
      sourceSha256,
      explicitFullReparse: false,
    })).toBe(false);
    expect(shouldRerunMarkerBaseline(artifactDir, {
      sourcePath: pdfPath,
      sourceSha256,
      explicitFullReparse: true,
    })).toBe(true);
    expect(shouldRerunMarkerBaseline(artifactDir, {
      sourcePath: pdfPath,
      sourceSha256: 'b'.repeat(64),
      explicitFullReparse: false,
    })).toBe(true);
    fs.rmSync(path.join(artifactDir, 'baseline.json'));
    expect(shouldRerunMarkerBaseline(artifactDir, {
      sourcePath: pdfPath,
      sourceSha256,
      explicitFullReparse: false,
    })).toBe(true);

    fs.writeFileSync(path.join(artifactDir, 'baseline.json'), JSON.stringify(baseline, null, 2), 'utf-8');
    finalizeRecoveredPaperParseView(artifactDir, baseline, [], [], { comparisonTraceEnabled: true });
    expect(JSON.parse(fs.readFileSync(path.join(artifactDir, 'comparison-trace.json'), 'utf-8'))).toMatchObject({
      baselineLength: baseline.markdown.length,
      overlayCount: 0,
    });
  });
});
