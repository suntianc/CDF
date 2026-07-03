import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type StructuredPaperParser = 'marker';
export type StructuredPaperBlockType = 'heading' | 'paragraph' | 'formula' | 'table' | 'figure' | 'reference';
export type PdfParseDiagnosticSeverity = 'info' | 'warning' | 'error';
export type PdfParseStatus = 'running' | 'completed' | 'failed' | 'canceled';
export type PdfParseFallback = 'none' | 'agent-on-marker-failure' | 'agent-for-selected-pages';

export type PdfParseDiagnosticCode =
  | 'MARKER_UNAVAILABLE'
  | 'MARKER_COLD_START'
  | 'MARKER_TIMEOUT'
  | 'MARKER_EXIT_ERROR'
  | 'SLOW_PARSE'
  | 'OCR_ARTIFACTS'
  | 'MISSING_TABLE_STRUCTURE'
  | 'FIGURE_ONLY_CONTENT'
  | 'WEAK_SOURCE_LOCATION'
  | 'FALLBACK_NOT_IMPLEMENTED'
  | 'RECOVERY_FAILED'
  | 'INVALID_INPUT'
  | 'PARSE_CANCELED';

export interface PdfParseDiagnostic {
  severity: PdfParseDiagnosticSeverity;
  code: PdfParseDiagnosticCode;
  message: string;
  page?: number;
}

export interface PaperSourceLocation {
  pageStart: number;
  pageEnd: number;
  section: string;
  markerAnchor?: string;
  bbox?: [number, number, number, number];
  imagePath?: string;
  parserDetails?: unknown;
}

export interface StructuredPaperBlock {
  id: string;
  type: StructuredPaperBlockType;
  text: string;
  section: string;
  pageStart: number;
  pageEnd: number;
  location: PaperSourceLocation;
}

export interface StructuredPaperParse {
  parser: StructuredPaperParser;
  sourceFile: string;
  markdown: string;
  blocks: StructuredPaperBlock[];
  diagnostics: PdfParseDiagnostic[];
}

export interface PdfParseOptions {
  parser?: 'marker';
  pageRange?: string;
  fallback?: PdfParseFallback;
  timeoutMs?: number;
}

export interface MarkerRunnerInput {
  filePath: string;
  outputDir: string;
  pageRange?: string;
  signal: AbortSignal;
}

export interface MarkerRunnerResult {
  markdown: string;
  outputDir: string;
  stderr?: string;
  elapsedMs?: number;
}

export interface MarkerRunner {
  parse(input: MarkerRunnerInput): Promise<MarkerRunnerResult>;
}

export interface ParsePDFDependencies {
  runner?: MarkerRunner;
  now?: () => number;
  createJobId?: () => string;
  managedTempRoot?: string;
  slowParseThresholdMs?: number;
}

export interface PdfParseJobSnapshot {
  jobId: string;
  status: PdfParseStatus;
  sourceFile: string;
  parser: 'marker';
  createdAt: number;
  updatedAt: number;
  diagnostics: PdfParseDiagnostic[];
  parse?: StructuredPaperParse;
  error?: string;
}

export type ParsePDFResult = (
  | {
      status: 'completed';
      jobId: string;
      parse: StructuredPaperParse;
      diagnostics: PdfParseDiagnostic[];
    }
  | {
      status: 'running';
      jobId: string;
      diagnostics: PdfParseDiagnostic[];
    }
  | {
      status: 'failed' | 'canceled';
      jobId: string;
      diagnostics: PdfParseDiagnostic[];
      error?: string;
    }
);

interface PdfParseJobRecord extends PdfParseJobSnapshot {
  controller: AbortController;
  promise: Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_SLOW_PARSE_THRESHOLD_MS = 120000;
const jobs = new Map<string, PdfParseJobRecord>();

function makeDiagnostic(
  severity: PdfParseDiagnosticSeverity,
  code: PdfParseDiagnosticCode,
  message: string,
  page?: number,
): PdfParseDiagnostic {
  return page === undefined ? { severity, code, message } : { severity, code, message, page };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validatePdfPath(filePath: string): PdfParseDiagnostic | null {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    return makeDiagnostic('error', 'INVALID_INPUT', 'PDF parsing requires an absolute local PDF path.');
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return makeDiagnostic('error', 'INVALID_INPUT', `PDF path is not readable: ${filePath}`);
  }
  if (!stat.isFile()) {
    return makeDiagnostic('error', 'INVALID_INPUT', `PDF path is not a file: ${filePath}`);
  }
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    return makeDiagnostic('error', 'INVALID_INPUT', `PDF path must end with .pdf: ${filePath}`);
  }
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return makeDiagnostic('error', 'INVALID_INPUT', `PDF path is not readable: ${filePath}`);
  }
  return null;
}

function createManagedJobDir(root: string, jobId: string): string {
  const jobDir = path.join(root, 'pdf-parse-jobs', jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  return jobDir;
}

function getDefaultManagedTempRoot(): string {
  return path.join(os.tmpdir(), 'cdf');
}

function normalizeOptions(options: PdfParseOptions): Required<Pick<PdfParseOptions, 'parser' | 'fallback' | 'timeoutMs'>> & Pick<PdfParseOptions, 'pageRange'> {
  return {
    parser: options.parser ?? 'marker',
    fallback: options.fallback ?? 'none',
    timeoutMs: Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    pageRange: options.pageRange,
  };
}

function getLinePage(line: string, currentPage: number): { page: number; markerAnchor?: string } {
  const pageComment = line.match(/<!--\s*page[:=]\s*(\d+)\s*-->/i);
  if (pageComment) return { page: Number(pageComment[1]), markerAnchor: `page:${Number(pageComment[1])}` };

  const markerAnchor = line.match(/\{#page-(\d+)\}/i) ?? line.match(/<a\s+id=["']page-(\d+)["'][^>]*>/i);
  if (markerAnchor) return { page: Number(markerAnchor[1]), markerAnchor: `page:${Number(markerAnchor[1])}` };

  return { page: currentPage };
}

function normalizeText(lines: string[]): string {
  return lines.join('\n').trim();
}

function blockId(type: StructuredPaperBlockType, index: number): string {
  return `${type}-${String(index + 1).padStart(4, '0')}`;
}

function makeBlock(
  type: StructuredPaperBlockType,
  text: string,
  section: string,
  page: number,
  markerAnchor: string | undefined,
  outputDir: string,
  index: number,
): StructuredPaperBlock {
  const imageMatch = type === 'figure' ? text.match(/!\[[^\]]*]\(([^)]+)\)/) : null;
  const imagePath = imageMatch
    ? path.resolve(outputDir, imageMatch[1])
    : undefined;

  return {
    id: blockId(type, index),
    type,
    text,
    section,
    pageStart: page,
    pageEnd: page,
    location: {
      pageStart: page,
      pageEnd: page,
      section,
      markerAnchor,
      ...(imagePath ? { imagePath } : {}),
    },
  };
}

function classifyParagraph(text: string, section: string): StructuredPaperBlockType {
  if (/^!\[[^\]]*]\([^)]+\)/.test(text)) return 'figure';
  if (/^\s*(\[\d+]|references?\b|\d+\.\s+[A-Z]).*/i.test(text) && /references?/i.test(section)) {
    return 'reference';
  }
  if (/^\s*(\[\d+]|\d+\.)\s+/.test(text) && /references?/i.test(section)) return 'reference';
  return 'paragraph';
}

function parseMarkdownBlocks(markdown: string, outputDir: string): {
  blocks: StructuredPaperBlock[];
  diagnostics: PdfParseDiagnostic[];
} {
  const blocks: StructuredPaperBlock[] = [];
  const diagnostics: PdfParseDiagnostic[] = [];
  const lines = markdown.split(/\r?\n/);
  let currentSection = '';
  let currentPage = 1;
  let currentAnchor: string | undefined = 'page:1';
  let paragraph: string[] = [];
  let paragraphPage = currentPage;
  let paragraphAnchor = currentAnchor;

  const flushParagraph = () => {
    const text = normalizeText(paragraph);
    if (!text) {
      paragraph = [];
      return;
    }
    const type = classifyParagraph(text, currentSection);
    blocks.push(makeBlock(type, text, currentSection, paragraphPage, paragraphAnchor, outputDir, blocks.length));
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const pageInfo = getLinePage(rawLine, currentPage);
    if (pageInfo.page !== currentPage || pageInfo.markerAnchor) {
      currentPage = pageInfo.page;
      currentAnchor = pageInfo.markerAnchor ?? currentAnchor;
    }
    if (/^\s*<!--\s*page[:=]\s*\d+\s*-->\s*$/i.test(rawLine) || /<a\s+id=["']page-\d+["'][^>]*>\s*<\/a>/i.test(rawLine)) {
      continue;
    }

    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*(?:\{#page-\d+})?$/);
    if (heading) {
      flushParagraph();
      currentSection = heading[2].trim();
      blocks.push(makeBlock('heading', currentSection, currentSection, currentPage, currentAnchor, outputDir, blocks.length));
      continue;
    }

    if (line.startsWith('|')) {
      flushParagraph();
      const tableLines = [line];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        i += 1;
        tableLines.push(lines[i].trim());
      }
      blocks.push(makeBlock('table', tableLines.join('\n'), currentSection, currentPage, currentAnchor, outputDir, blocks.length));
      continue;
    }

    if (line.startsWith('$$')) {
      flushParagraph();
      const formulaLines = [line];
      while (!formulaLines[formulaLines.length - 1].endsWith('$$') || formulaLines[formulaLines.length - 1] === '$$') {
        if (i + 1 >= lines.length) break;
        i += 1;
        formulaLines.push(lines[i].trim());
        if (formulaLines[formulaLines.length - 1].endsWith('$$')) break;
      }
      blocks.push(makeBlock('formula', formulaLines.join('\n'), currentSection, currentPage, currentAnchor, outputDir, blocks.length));
      continue;
    }

    if (paragraph.length === 0) {
      paragraphPage = currentPage;
      paragraphAnchor = currentAnchor;
    }
    paragraph.push(line);
  }

  flushParagraph();

  if (blocks.some((block) => block.type !== 'heading' && !block.location.markerAnchor)) {
    diagnostics.push(makeDiagnostic('warning', 'WEAK_SOURCE_LOCATION', 'Some parsed blocks do not include a Marker page anchor.'));
  }

  return { blocks, diagnostics };
}

function detectQualityDiagnostics(markdown: string, elapsedMs: number | undefined, slowParseThresholdMs: number): PdfParseDiagnostic[] {
  const diagnostics: PdfParseDiagnostic[] = [];
  if (elapsedMs !== undefined && elapsedMs > slowParseThresholdMs) {
    diagnostics.push(makeDiagnostic('warning', 'SLOW_PARSE', `Marker parse took ${elapsedMs}ms.`));
  }
  if (/[�ᨀ]/.test(markdown)) {
    diagnostics.push(makeDiagnostic('warning', 'OCR_ARTIFACTS', 'Marker output contains likely OCR artifacts.'));
  }
  if (/^\s*\|.+\|\s*$/m.test(markdown) && !/^\s*\|[\s:-]+\|/m.test(markdown)) {
    diagnostics.push(makeDiagnostic('warning', 'MISSING_TABLE_STRUCTURE', 'Marker output contains table-like rows without Markdown table structure.'));
  }
  const nonEmptyLines = markdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (nonEmptyLines.length > 0 && nonEmptyLines.every((line) => /^!\[[^\]]*]\([^)]+\)$/.test(line) || /^<!--\s*page[:=]/i.test(line))) {
    diagnostics.push(makeDiagnostic('warning', 'FIGURE_ONLY_CONTENT', 'Marker output appears to contain figure-only content.'));
  }
  return diagnostics;
}

function toStructuredPaperParse(
  sourceFile: string,
  result: MarkerRunnerResult,
  existingDiagnostics: PdfParseDiagnostic[],
  slowParseThresholdMs: number,
): StructuredPaperParse {
  const mapped = parseMarkdownBlocks(result.markdown, result.outputDir);
  const diagnostics = [
    ...existingDiagnostics,
    ...mapped.diagnostics,
    ...detectQualityDiagnostics(result.markdown, result.elapsedMs, slowParseThresholdMs),
  ];
  return {
    parser: 'marker',
    sourceFile,
    markdown: result.markdown,
    blocks: mapped.blocks,
    diagnostics,
  };
}

function snapshotJob(job: PdfParseJobRecord): PdfParseJobSnapshot {
  return {
    jobId: job.jobId,
    status: job.status,
    sourceFile: job.sourceFile,
    parser: job.parser,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    diagnostics: job.diagnostics,
    parse: job.parse,
    error: job.error,
  };
}

function markJob(
  job: PdfParseJobRecord,
  status: PdfParseStatus,
  now: () => number,
  patch: Partial<Pick<PdfParseJobRecord, 'parse' | 'diagnostics' | 'error'>> = {},
): void {
  job.status = status;
  job.updatedAt = now();
  if (patch.parse !== undefined) job.parse = patch.parse;
  if (patch.diagnostics !== undefined) job.diagnostics = patch.diagnostics;
  if (patch.error !== undefined) job.error = patch.error;
}

export async function parsePDF(
  filePath: string,
  options: PdfParseOptions = {},
  dependencies: ParsePDFDependencies = {},
): Promise<ParsePDFResult> {
  const normalized = normalizeOptions(options);
  const now = dependencies.now ?? Date.now;
  const diagnostics: PdfParseDiagnostic[] = [];

  const inputDiagnostic = validatePdfPath(filePath);
  if (inputDiagnostic) {
    return {
      status: 'failed',
      jobId: '',
      diagnostics: [inputDiagnostic],
      error: inputDiagnostic.message,
    };
  }

  if (normalized.fallback !== 'none') {
    diagnostics.push(makeDiagnostic(
      'warning',
      'FALLBACK_NOT_IMPLEMENTED',
      `Agent-mediated PDF recovery "${normalized.fallback}" is not implemented in issue #30; track recovery work in #61.`,
    ));
  }

  const jobId = dependencies.createJobId?.() ?? crypto.randomUUID();
  const controller = new AbortController();
  const outputDir = createManagedJobDir(dependencies.managedTempRoot ?? getDefaultManagedTempRoot(), jobId);
  const runner = dependencies.runner ?? createMarkerCliRunner();
  const job: PdfParseJobRecord = {
    jobId,
    status: 'running',
    sourceFile: filePath,
    parser: 'marker',
    createdAt: now(),
    updatedAt: now(),
    diagnostics,
    controller,
    promise: Promise.resolve(),
  };

  job.promise = runner.parse({
    filePath,
    outputDir,
    pageRange: normalized.pageRange,
    signal: controller.signal,
  })
    .then((result) => {
      const parse = toStructuredPaperParse(
        filePath,
        result,
        job.diagnostics,
        dependencies.slowParseThresholdMs ?? DEFAULT_SLOW_PARSE_THRESHOLD_MS,
      );
      markJob(job, 'completed', now, { parse, diagnostics: parse.diagnostics });
    })
    .catch((error) => {
      const message = errorMessage(error);
      const code: PdfParseDiagnosticCode = controller.signal.aborted ? 'PARSE_CANCELED' : mapMarkerErrorCode(error);
      const severity: PdfParseDiagnosticSeverity = controller.signal.aborted ? 'info' : 'error';
      if (job.status === 'canceled' && code === 'PARSE_CANCELED') {
        return;
      }
      const diagnostic = makeDiagnostic(severity, code, message);
      markJob(job, controller.signal.aborted ? 'canceled' : 'failed', now, {
        diagnostics: [...job.diagnostics, diagnostic],
        error: message,
      });
    });

  jobs.set(jobId, job);

  if (normalized.timeoutMs === 0) {
    await job.promise;
  } else if (normalized.timeoutMs > 0) {
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      job.promise,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, normalized.timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }

  if (job.status === 'completed' && job.parse) {
    return {
      status: 'completed',
      jobId,
      parse: job.parse,
      diagnostics: job.diagnostics,
    };
  }
  if (job.status === 'failed' || job.status === 'canceled') {
    return {
      status: job.status,
      jobId,
      diagnostics: job.diagnostics,
      error: job.error,
    };
  }
  return {
    status: 'running',
    jobId,
    diagnostics: job.diagnostics,
  };
}

function mapMarkerErrorCode(error: unknown): PdfParseDiagnosticCode {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  if (record.code === 'ENOENT') return 'MARKER_UNAVAILABLE';
  if (record.exitCode === -2) return 'MARKER_TIMEOUT';
  if (record.exitCode !== undefined) return 'MARKER_EXIT_ERROR';
  return 'MARKER_EXIT_ERROR';
}

export function getPdfParseJob(jobId: string): PdfParseJobSnapshot | null {
  const job = jobs.get(jobId);
  return job ? snapshotJob(job) : null;
}

export function cancelPdfParseJob(jobId: string): PdfParseJobSnapshot | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === 'running') {
    job.controller.abort();
    markJob(job, 'canceled', Date.now, {
      diagnostics: [
        ...job.diagnostics,
        makeDiagnostic('info', 'PARSE_CANCELED', 'PDF Parse Job was canceled.'),
      ],
    });
  }
  return snapshotJob(job);
}

export function resetPdfParseJobsForTests(): void {
  for (const job of jobs.values()) {
    if (job.status === 'running') job.controller.abort();
  }
  jobs.clear();
}

interface MarkerCliRunnerOptions {
  command?: string;
  args?: string[];
}

function splitConfiguredCommand(command: string): string[] {
  const matches = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ''));
}

function configuredMarkerCommand(): { command: string; args: string[] } {
  const configured = process.env.CDF_MARKER_COMMAND?.trim();
  if (configured) {
    const [command, ...args] = splitConfiguredCommand(configured);
    if (command) return { command, args };
  }
  return { command: 'uvx', args: ['--from', 'marker-pdf', 'marker_single'] };
}

function findMarkdownOutput(outputDir: string): string {
  const stack = [outputDir];
  const candidates: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        candidates.push(absolutePath);
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error('Marker completed without producing a Markdown output file.');
  }
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return candidates[0];
}

function runMarkerCommand(
  command: string,
  args: string[],
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const abort = () => {
      if (settled) return;
      child.kill('SIGTERM');
    };

    signal.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
    });
  });
}

export function createMarkerCliRunner(options: MarkerCliRunnerOptions = {}): MarkerRunner {
  return {
    async parse(input) {
      const configured = configuredMarkerCommand();
      const command = options.command ?? configured.command;
      const baseArgs = options.args ?? configured.args;
      const args = [
        ...baseArgs,
        input.filePath,
        '--output_format',
        'markdown',
        '--output_dir',
        input.outputDir,
      ];
      if (input.pageRange) args.push('--page_range', input.pageRange);

      const startedAt = Date.now();
      const result = await runMarkerCommand(command, args, input.signal);
      const elapsedMs = Date.now() - startedAt;
      if (input.signal.aborted) {
        throw new Error('PDF Parse Job was canceled.');
      }
      if (result.exitCode !== 0) {
        const error = new Error(result.stderr || `Marker exited with code ${result.exitCode}`) as Error & {
          exitCode?: number;
          stderr?: string;
        };
        error.exitCode = result.exitCode;
        error.stderr = result.stderr;
        throw error;
      }
      const markdownPath = findMarkdownOutput(input.outputDir);
      return {
        markdown: fs.readFileSync(markdownPath, 'utf-8'),
        outputDir: path.dirname(markdownPath),
        stderr: result.stderr,
        elapsedMs,
      };
    },
  };
}
