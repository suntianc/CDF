import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPdfParseJobsForTests, type MarkerRunner } from '../pdf-parse';
import { createPdfParseTools } from './pdf-parse-tool';

let tempDir: string;
let pdfPath: string;

function parseToolResult(result: unknown) {
  return JSON.parse(String(result));
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-pdf-parse-tool-'));
  pdfPath = path.join(tempDir, 'paper.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.7\n% test fixture\n', 'utf-8');
});

afterEach(() => {
  resetPdfParseJobsForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('createPdfParseTools', () => {
  it('exposes parse_pdf, pdf_parse_status, and pdf_parse_cancel as structured Agent tools', async () => {
    const runner: MarkerRunner = {
      parse: async ({ signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('PDF Parse Job was canceled.'));
        }, { once: true });
      }),
    };
    const tools = createPdfParseTools({
      runner,
      createJobId: () => 'job-tool',
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      'parse_pdf',
      'pdf_parse_status',
      'pdf_parse_cancel',
    ]);

    const parsePdf = tools.find((tool) => tool.name === 'parse_pdf') as any;
    const statusTool = tools.find((tool) => tool.name === 'pdf_parse_status') as any;
    const cancelTool = tools.find((tool) => tool.name === 'pdf_parse_cancel') as any;

    const started = parseToolResult(await parsePdf.invoke({
      filePath: pdfPath,
      timeoutMs: 1,
    }));
    expect(started).toEqual({
      success: true,
      status: 'running',
      jobId: 'job-tool',
      diagnostics: [],
    });

    expect(parseToolResult(await statusTool.invoke({ jobId: 'job-tool' }))).toMatchObject({
      success: true,
      job: {
        jobId: 'job-tool',
        status: 'running',
        sourceFile: pdfPath,
      },
    });

    expect(parseToolResult(await cancelTool.invoke({ jobId: 'job-tool' }))).toMatchObject({
      success: true,
      job: {
        jobId: 'job-tool',
        status: 'canceled',
      },
    });
  });
});
