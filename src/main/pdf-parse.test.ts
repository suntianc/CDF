import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cancelPdfParseJob, createMarkerCliRunner, getPdfParseJob, parsePDF, resetPdfParseJobsForTests, type MarkerRunner } from './pdf-parse';

let tempDir: string;
let pdfPath: string;
let previousMarkerCommand: string | undefined;
let previousTextLayerFallbackCommand: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-pdf-parse-'));
  pdfPath = path.join(tempDir, 'paper.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.7\n% test fixture\n', 'utf-8');
  previousMarkerCommand = process.env.CDF_MARKER_COMMAND;
  previousTextLayerFallbackCommand = process.env.CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND;
});

afterEach(() => {
  resetPdfParseJobsForTests();
  if (previousMarkerCommand === undefined) {
    delete process.env.CDF_MARKER_COMMAND;
  } else {
    process.env.CDF_MARKER_COMMAND = previousMarkerCommand;
  }
  if (previousTextLayerFallbackCommand === undefined) {
    delete process.env.CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND;
  } else {
    process.env.CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND = previousTextLayerFallbackCommand;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeDelayedMarkerFixture(markdown: string, delayMs: number): string {
  const markerPath = path.join(tempDir, 'marker-fixture.js');
  fs.writeFileSync(markerPath, [
    "const fs = require('fs');",
    "const path = require('path');",
    "const args = process.argv.slice(2);",
    "const outputDir = args[args.indexOf('--output_dir') + 1];",
    `setTimeout(() => {`,
    "  fs.mkdirSync(outputDir, { recursive: true });",
    `  fs.writeFileSync(path.join(outputDir, 'result.md'), ${JSON.stringify(markdown)}, 'utf-8');`,
    `}, ${delayMs});`,
  ].join('\n'), 'utf-8');
  return `${process.execPath} ${markerPath}`;
}

function writeDelayedTextLayerFallbackFixture(markdown: string, delayMs: number): string {
  const fallbackPath = path.join(tempDir, 'text-layer-fallback-fixture.js');
  fs.writeFileSync(fallbackPath, [
    `setTimeout(() => {`,
    '  process.stdout.write(JSON.stringify({',
    '    ok: true,',
    "    engine: 'pymupdf',",
    `    markdown: ${JSON.stringify(markdown)},`,
    '  }));',
    `}, ${delayMs});`,
  ].join('\n'), 'utf-8');
  return `${process.execPath} ${fallbackPath}`;
}

async function waitForPdfParseJobStatus(jobId: string, status: string, timeoutMs = 500): Promise<ReturnType<typeof getPdfParseJob>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = getPdfParseJob(jobId);
    if (snapshot?.status === status) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return getPdfParseJob(jobId);
}

function completedParse(result: import('./pdf-parse').ParsePDFResult) {
  if (result.status !== 'completed') {
    throw new Error(`expected a completed parse result, got status=${result.status}`);
  }
  return result;
}

describe('parsePDF', () => {
  it('returns a Structured Paper Parse from Marker markdown when parsing finishes within timeout', async () => {
    const runner: MarkerRunner = {
      parse: async () => ({
        markdown: [
          '<!-- page: 1 -->',
          '# Abstract',
          'This paper introduces the method.',
          '',
          '$$E = mc^2$$',
          '',
          '| Metric | Value |',
          '| --- | --- |',
          '| Accuracy | 0.99 |',
          '',
          '![Figure 1](images/figure-1.png)',
          '',
          '## References',
          '[1] A. Example. Example Paper.',
        ].join('\n'),
        outputDir: path.join(tempDir, 'marker-output'),
        elapsedMs: 1250,
      }),
    };

    const result = completedParse(await parsePDF(pdfPath, { timeoutMs: 5000 }, { runner }));

    expect(result.status).toBe('completed');
    expect(result.parse?.parser).toBe('marker');
    expect(result.parse?.sourceFile).toBe(pdfPath);
    expect(result.parse?.markdown).toContain('# Abstract');
    expect(result.parse?.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'formula',
      'table',
      'figure',
      'heading',
      'reference',
    ]);
    expect(result.parse?.blocks[0]).toMatchObject({
      text: 'Abstract',
      section: 'Abstract',
      pageStart: 1,
      pageEnd: 1,
      location: {
        pageStart: 1,
        pageEnd: 1,
        section: 'Abstract',
        markerAnchor: 'page:1',
      },
    });
    expect(result.parse?.blocks.find((block) => block.type === 'figure')?.location.imagePath).toBe(
      path.join(tempDir, 'marker-output', 'images/figure-1.png'),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('reports weak source location instead of fabricating page anchors when Marker markdown has no anchors', async () => {
    const runner: MarkerRunner = {
      parse: async () => ({
        markdown: [
          '# Abstract',
          'This paragraph has no Marker page anchor.',
          '',
          '## Method',
          'This paragraph also has no Marker page anchor.',
        ].join('\n'),
        outputDir: path.join(tempDir, 'marker-output'),
        elapsedMs: 25,
      }),
    };

    const result = completedParse(await parsePDF(pdfPath, { timeoutMs: 5000 }, { runner }));

    expect(result.status).toBe('completed');
    expect(result.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'WEAK_SOURCE_LOCATION',
        message: 'Some parsed blocks do not include a Marker page anchor.',
      },
    ]);
    expect(result.parse?.blocks.every((block) => block.location.markerAnchor === undefined)).toBe(true);
    expect(result.parse?.blocks.map((block) => block.pageStart)).toEqual([1, 1, 1, 1]);
  });

  it('uses Marker span page anchors as source locations', async () => {
    const runner: MarkerRunner = {
      parse: async () => ({
        markdown: [
          '<span id="page-2-0"></span># Results',
          'A grounded paragraph.',
          '',
          '<span id="page-3-1"></span>## References',
          '[1] A. Example. Example Paper.',
        ].join('\n'),
        outputDir: path.join(tempDir, 'marker-output'),
        elapsedMs: 25,
      }),
    };

    const result = completedParse(await parsePDF(pdfPath, { timeoutMs: 5000 }, { runner }));

    expect(result.status).toBe('completed');
    expect(result.diagnostics).toEqual([]);
    expect(result.parse?.blocks.map((block) => ({
      text: block.text,
      pageStart: block.pageStart,
      markerAnchor: block.location.markerAnchor,
    }))).toEqual([
      { text: 'Results', pageStart: 2, markerAnchor: 'page:2' },
      { text: 'A grounded paragraph.', pageStart: 2, markerAnchor: 'page:2' },
      { text: 'References', pageStart: 3, markerAnchor: 'page:3' },
      { text: '[1] A. Example. Example Paper.', pageStart: 3, markerAnchor: 'page:3' },
    ]);
  });

  it('returns a running PDF Parse Job when Marker outlives the tool timeout and supports cancellation', async () => {
    let observedAbort = false;
    const runner: MarkerRunner = {
      parse: async ({ signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          observedAbort = true;
          reject(new Error('PDF Parse Job was canceled.'));
        }, { once: true });
      }),
    };

    const result = await parsePDF(pdfPath, { timeoutMs: 1 }, {
      runner,
      createJobId: () => 'job-timeout',
    });

    expect(result).toEqual({
      status: 'running',
      jobId: 'job-timeout',
      diagnostics: [],
    });
    expect(getPdfParseJob('job-timeout')).toMatchObject({
      jobId: 'job-timeout',
      status: 'running',
      sourceFile: pdfPath,
    });

    const canceled = cancelPdfParseJob('job-timeout');

    expect(observedAbort).toBe(true);
    expect(canceled).toMatchObject({
      jobId: 'job-timeout',
      status: 'canceled',
      diagnostics: [
        {
          severity: 'info',
          code: 'PARSE_CANCELED',
          message: 'PDF Parse Job was canceled.',
        },
      ],
    });
  });

  it('waits for completion when timeout is explicitly disabled', async () => {
    const runner: MarkerRunner = {
      parse: async () => new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            markdown: '# Delayed result',
            outputDir: tempDir,
          });
        }, 10);
      }),
    };

    const result = await parsePDF(pdfPath, { timeoutMs: 0 }, {
      runner,
      createJobId: () => 'job-wait-until-complete',
    });

    expect(result.status).toBe('completed');
    expect(result.status === 'completed' ? result.parse.markdown : '').toContain('Delayed result');
    expect(getPdfParseJob('job-wait-until-complete')).toMatchObject({
      jobId: 'job-wait-until-complete',
      status: 'completed',
    });
  });

  it('keeps the job snapshot parser aligned when a running parse finishes through text-layer fallback', async () => {
    fs.writeFileSync(pdfPath, [
      '%PDF-1.7',
      '1 0 obj << /Creator (LaTeX) >> endobj',
      'stream',
      'BT',
      '(A readable text layer) Tj',
      'ET',
      'endstream',
    ].join('\n'), 'utf-8');
    process.env.CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND = writeDelayedTextLayerFallbackFixture(
      '# Fallback result\n\nRecovered from the text layer.',
      40,
    );
    const runner: MarkerRunner = {
      parse: async () => {
        const error = new Error('Marker command not found.') as Error & { code?: string };
        error.code = 'ENOENT';
        throw error;
      },
    };

    const result = await parsePDF(pdfPath, { timeoutMs: 1 }, {
      runner,
      createJobId: () => 'job-text-layer-fallback',
    });
    const snapshot = await waitForPdfParseJobStatus('job-text-layer-fallback', 'completed');

    expect(result).toMatchObject({
      status: 'running',
      jobId: 'job-text-layer-fallback',
    });
    expect(snapshot).toMatchObject({
      jobId: 'job-text-layer-fallback',
      status: 'completed',
      parser: 'pymupdf-text-layer',
      parse: {
        parser: 'pymupdf-text-layer',
        markdown: expect.stringContaining('Recovered from the text layer.'),
      },
    });
  });

  it('rejects a duplicate Marker CLI parse for the same PDF while one is already running', async () => {
    process.env.CDF_MARKER_COMMAND = writeDelayedMarkerFixture('# First result', 120);
    const runner = createMarkerCliRunner();

    const first = parsePDF(pdfPath, { timeoutMs: 0 }, {
      runner,
      createJobId: () => 'job-first-marker',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await parsePDF(pdfPath, { timeoutMs: 0 }, {
      runner,
      createJobId: () => 'job-duplicate-marker',
    });
    const firstResult = await first;

    expect(firstResult.status).toBe('completed');
    expect(second).toMatchObject({
      status: 'failed',
      jobId: 'job-duplicate-marker',
      diagnostics: [
        {
          severity: 'error',
          code: 'MARKER_ALREADY_RUNNING',
        },
      ],
    });
    expect(second.status === 'failed' ? second.error : '').toContain('already running');
  });

  it('keeps fallback requests explicit without invoking an LLM fallback in the parser', async () => {
    const runner: MarkerRunner = {
      parse: async () => ({
        markdown: '<!-- page: 1 -->\n# Result\n\nParsed by Marker.',
        outputDir: tempDir,
      }),
    };

    const result = await parsePDF(pdfPath, {
      fallback: 'agent-on-marker-failure',
      timeoutMs: 100,
    }, { runner });

    expect(result.status).toBe('completed');
    expect(result.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'FALLBACK_NOT_IMPLEMENTED',
        message: 'Agent-mediated PDF recovery "agent-on-marker-failure" is not implemented in issue #30; track recovery work in #61.',
      },
    ]);
    expect(result.status === 'completed' ? result.parse.diagnostics : []).toEqual(result.diagnostics);
  });

  it('rejects non-absolute and non-PDF local inputs before invoking Marker', async () => {
    let called = false;
    const runner: MarkerRunner = {
      parse: async () => {
        called = true;
        throw new Error('runner should not be called');
      },
    };

    const relativeResult = await parsePDF('paper.pdf', {}, { runner });
    const textPath = path.join(tempDir, 'paper.txt');
    fs.writeFileSync(textPath, 'not a pdf', 'utf-8');
    const nonPdfResult = await parsePDF(textPath, {}, { runner });

    expect(called).toBe(false);
    expect(relativeResult).toMatchObject({
      status: 'failed',
      diagnostics: [
        {
          severity: 'error',
          code: 'INVALID_INPUT',
          message: 'PDF parsing requires an absolute local PDF path.',
        },
      ],
    });
    expect(nonPdfResult).toMatchObject({
      status: 'failed',
      diagnostics: [
        {
          severity: 'error',
          code: 'INVALID_INPUT',
          message: `PDF path must end with .pdf: ${textPath}`,
        },
      ],
    });
  });
});
