import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cancelPdfParseJob, getPdfParseJob, parsePDF, resetPdfParseJobsForTests, type MarkerRunner } from './pdf-parse';

let tempDir: string;
let pdfPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-pdf-parse-'));
  pdfPath = path.join(tempDir, 'paper.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.7\n% test fixture\n', 'utf-8');
});

afterEach(() => {
  resetPdfParseJobsForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

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

    const result = await parsePDF(pdfPath, { timeoutMs: 5000 }, { runner });

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

  it('keeps fallback requests explicit without invoking an LLM fallback in the parser', async () => {
    const runner: MarkerRunner = {
      parse: async () => ({
        markdown: '# Result\n\nParsed by Marker.',
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
