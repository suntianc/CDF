import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type StructuredPaperParser = 'marker' | 'pymupdf-text-layer';
export type StructuredPaperBlockType = 'heading' | 'paragraph' | 'formula' | 'table' | 'figure' | 'reference';
export type PdfParseDiagnosticSeverity = 'info' | 'warning' | 'error';
export type PdfParseStatus = 'running' | 'completed' | 'failed' | 'canceled';
export type PdfParseFallback = 'none' | 'agent-on-marker-failure' | 'agent-for-selected-pages';

export type PdfParseDiagnosticCode =
  | 'MARKER_UNAVAILABLE'
  | 'MARKER_COLD_START'
  | 'MARKER_TIMEOUT'
  | 'MARKER_EXIT_ERROR'
  | 'MARKER_ALREADY_RUNNING'
  | 'TEXT_LAYER_OCR_DISABLED'
  | 'TEXT_LAYER_FALLBACK_USED'
  | 'SLOW_PARSE'
  | 'OCR_ARTIFACTS'
  | 'MISSING_TABLE_STRUCTURE'
  | 'FIGURE_ONLY_CONTENT'
  | 'WEAK_SOURCE_LOCATION'
  | 'FALLBACK_NOT_IMPLEMENTED'
  | 'PDF_RECOVERY_CAPABILITY_UNAVAILABLE'
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
  parser?: StructuredPaperParser;
  markdown: string;
  outputDir: string;
  diagnostics?: PdfParseDiagnostic[];
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
  parser: StructuredPaperParser;
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
  const imageMatch = text.match(/!\[[^\]]*]\(([^)]+)\)/);
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
  if (/!\[[^\]]*]\([^)]+\)/.test(text)) return 'figure';
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
    ...(result.diagnostics ?? []),
    ...mapped.diagnostics,
    ...detectQualityDiagnostics(result.markdown, result.elapsedMs, slowParseThresholdMs),
  ];
  return {
    parser: result.parser ?? 'marker',
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
  if (patch.parse !== undefined) {
    job.parse = patch.parse;
    job.parser = patch.parse.parser;
  }
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
    .catch(async (error) => {
      const message = errorMessage(error);
      const code: PdfParseDiagnosticCode = controller.signal.aborted ? 'PARSE_CANCELED' : mapMarkerErrorCode(error);
      const severity: PdfParseDiagnosticSeverity = controller.signal.aborted ? 'info' : 'error';
      if (job.status === 'canceled' && code === 'PARSE_CANCELED') {
        return;
      }
      if (!controller.signal.aborted && shouldAttemptTextLayerFallback(code)) {
        const markerFailureDiagnostic = makeDiagnostic('warning', code, message);
        const fallbackResult = await tryTextLayerFallback({
          filePath,
          outputDir,
          signal: controller.signal,
          markerFailureCode: code,
        });
        if (fallbackResult) {
          const parse = toStructuredPaperParse(
            filePath,
            fallbackResult,
            [...job.diagnostics, markerFailureDiagnostic],
            dependencies.slowParseThresholdMs ?? DEFAULT_SLOW_PARSE_THRESHOLD_MS,
          );
          markJob(job, 'completed', now, { parse, diagnostics: parse.diagnostics });
          return;
        }
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
  if (record.code === 'MARKER_ALREADY_RUNNING') return 'MARKER_ALREADY_RUNNING';
  if (record.code === 'ENOENT') return 'MARKER_UNAVAILABLE';
  if (record.exitCode === -2) return 'MARKER_TIMEOUT';
  if (record.exitCode !== undefined) return 'MARKER_EXIT_ERROR';
  return 'MARKER_EXIT_ERROR';
}

function processLooksAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function markerLockPath(filePath: string): string {
  const lockRoot = path.join(getDefaultManagedTempRoot(), 'marker-locks');
  fs.mkdirSync(lockRoot, { recursive: true });
  const hash = crypto.createHash('sha256').update(path.resolve(filePath)).digest('hex');
  return path.join(lockRoot, `${hash}.lock`);
}

function readLockPid(lockPath: string): number | null {
  try {
    const payload = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { pid?: unknown };
    return typeof payload.pid === 'number' ? payload.pid : null;
  } catch {
    return null;
  }
}

function acquireMarkerRunLock(filePath: string): () => void {
  const lockPath = markerLockPath(filePath);
  const lockPayload = `${JSON.stringify({
    pid: process.pid,
    filePath: path.resolve(filePath),
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, lockPayload, { encoding: 'utf-8', flag: 'wx' });
      return () => {
        fs.rmSync(lockPath, { force: true });
      };
    } catch (error) {
      const record = error && typeof error === 'object' ? error as NodeJS.ErrnoException : {};
      if (record.code !== 'EEXIST') throw error;
      const existingPid = readLockPid(lockPath);
      if (existingPid !== null && !processLooksAlive(existingPid)) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      const alreadyRunning = new Error(`Marker is already running for PDF: ${filePath}`) as Error & { code?: string };
      alreadyRunning.code = 'MARKER_ALREADY_RUNNING';
      throw alreadyRunning;
    }
  }

  const alreadyRunning = new Error(`Marker is already running for PDF: ${filePath}`) as Error & { code?: string };
  alreadyRunning.code = 'MARKER_ALREADY_RUNNING';
  throw alreadyRunning;
}

interface PdfTextLayerPreflight {
  hasTextLayer: boolean;
  reason?: 'tex-producer' | 'text-operators';
}

function inspectPdfTextLayer(filePath: string): PdfTextLayerPreflight {
  const sample = fs.readFileSync(filePath).subarray(0, 1024 * 1024).toString('latin1');
  if (/\/(?:Producer|Creator)\s*\((?:[^\\)]|\\.)*(?:pdfTeX|LaTeX|LuaTeX|XeTeX)/i.test(sample)) {
    return { hasTextLayer: true, reason: 'tex-producer' };
  }
  if (/\bBT\b[\s\S]{0,5000}\b(?:Tj|TJ|'|")\b[\s\S]{0,5000}\bET\b/.test(sample)) {
    return { hasTextLayer: true, reason: 'text-operators' };
  }
  return { hasTextLayer: false };
}

function shouldAutoDisableOcr(args: string[], filePath: string): PdfTextLayerPreflight {
  if (args.includes('--disable_ocr')) return { hasTextLayer: false };
  return inspectPdfTextLayer(filePath);
}

function shouldAttemptTextLayerFallback(code: PdfParseDiagnosticCode): boolean {
  return code === 'MARKER_UNAVAILABLE' || code === 'MARKER_TIMEOUT' || code === 'MARKER_EXIT_ERROR';
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

export function splitConfiguredCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  const pushCurrent = () => {
    if (!current) return;
    parts.push(current);
    current = '';
  };

  const isEscapable = (char: string | undefined) =>
    char === '"' || char === "'" || char === '\\' || char === ' ';

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === '\\' && quote !== "'") {
      const next = command[index + 1];
      if (isEscapable(next)) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }
    current += char;
  }
  pushCurrent();
  return parts;
}

export function configuredMarkerCommand(): { command: string; args: string[] } {
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

interface TextLayerFallbackInput {
  filePath: string;
  outputDir: string;
  signal: AbortSignal;
  markerFailureCode: PdfParseDiagnosticCode;
}

interface TextLayerFallbackCommandResult {
  markdown: string;
  engine: string;
  stderr?: string;
  elapsedMs?: number;
}

function parseTextLayerFallbackStdout(stdout: string, defaultEngine: string): Pick<TextLayerFallbackCommandResult, 'markdown' | 'engine'> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const payload = JSON.parse(trimmed) as { ok?: unknown; markdown?: unknown; engine?: unknown };
    if (payload.ok === false) return null;
    if (typeof payload.markdown === 'string' && payload.markdown.trim().length > 0) {
      return {
        markdown: payload.markdown,
        engine: typeof payload.engine === 'string' && payload.engine.trim() ? payload.engine : defaultEngine,
      };
    }
  } catch {
    return {
      markdown: stdout.trimEnd(),
      engine: defaultEngine,
    };
  }
  return null;
}

async function runTextLayerFallbackCommand(
  command: string,
  args: string[],
  filePath: string,
  signal: AbortSignal,
  defaultEngine: string,
): Promise<TextLayerFallbackCommandResult | null> {
  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof runMarkerCommand>>;
  try {
    result = await runMarkerCommand(command, [...args, filePath], signal);
  } catch {
    return null;
  }
  if (result.exitCode !== 0) return null;
  const parsed = parseTextLayerFallbackStdout(result.stdout, defaultEngine);
  if (!parsed) return null;
  return {
    ...parsed,
    stderr: result.stderr,
    elapsedMs: Date.now() - startedAt,
  };
}

async function runConfiguredTextLayerFallback(
  filePath: string,
  signal: AbortSignal,
): Promise<TextLayerFallbackCommandResult | null> {
  const configured = process.env.CDF_PDF_TEXT_LAYER_FALLBACK_COMMAND?.trim();
  if (!configured) return null;
  const [command, ...args] = splitConfiguredCommand(configured);
  if (!command) return null;
  return runTextLayerFallbackCommand(command, args, filePath, signal, 'text-layer-command');
}

const PYMUPDF_TEXT_LAYER_SCRIPT = [
  'import json, sys',
  'try:',
  '    import fitz',
  'except Exception as exc:',
  '    print(json.dumps({"ok": False, "error": "PyMuPDF unavailable: " + str(exc)}))',
  '    sys.exit(3)',
  'doc = fitz.open(sys.argv[1])',
  'pages = []',
  'for index, page in enumerate(doc):',
  '    text = page.get_text("text").strip()',
  '    if text:',
  '        pages.append("<!-- page:%d -->\\n\\n%s" % (index + 1, text))',
  'markdown = "\\n\\n".join(pages).strip()',
  'if not markdown:',
  '    print(json.dumps({"ok": False, "error": "PDF text layer produced no text."}))',
  '    sys.exit(4)',
  'print(json.dumps({"ok": True, "engine": "pymupdf", "markdown": markdown}))',
].join('\n');

async function runDefaultPymupdfTextLayerFallback(
  filePath: string,
  signal: AbortSignal,
): Promise<TextLayerFallbackCommandResult | null> {
  for (const command of ['python3', 'python']) {
    const result = await runTextLayerFallbackCommand(
      command,
      ['-c', PYMUPDF_TEXT_LAYER_SCRIPT],
      filePath,
      signal,
      'pymupdf',
    );
    if (result) return result;
  }
  return null;
}

async function tryTextLayerFallback(input: TextLayerFallbackInput): Promise<MarkerRunnerResult | null> {
  if (!inspectPdfTextLayer(input.filePath).hasTextLayer) return null;
  const result = await runConfiguredTextLayerFallback(input.filePath, input.signal)
    ?? await runDefaultPymupdfTextLayerFallback(input.filePath, input.signal);
  if (!result) return null;
  return {
    parser: 'pymupdf-text-layer',
    markdown: result.markdown,
    outputDir: input.outputDir,
    stderr: result.stderr,
    elapsedMs: result.elapsedMs,
    diagnostics: [
      makeDiagnostic(
        'info',
        'TEXT_LAYER_FALLBACK_USED',
        `Marker failed with ${input.markerFailureCode}; extracted the existing PDF text layer with ${result.engine}.`,
      ),
    ],
  };
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
      const diagnostics: PdfParseDiagnostic[] = [];
      const textLayerPreflight = shouldAutoDisableOcr(args, input.filePath);
      if (textLayerPreflight.hasTextLayer) {
        args.push('--disable_ocr');
        diagnostics.push(makeDiagnostic(
          'info',
          'TEXT_LAYER_OCR_DISABLED',
          `PDF preflight detected a text layer (${textLayerPreflight.reason}); Marker OCR was disabled for this baseline run.`,
        ));
      }

      const startedAt = Date.now();
      const releaseLock = acquireMarkerRunLock(input.filePath);
      let result: Awaited<ReturnType<typeof runMarkerCommand>>;
      try {
        result = await runMarkerCommand(command, args, input.signal);
      } finally {
        releaseLock();
      }
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
        diagnostics,
        stderr: result.stderr,
        elapsedMs,
      };
    },
  };
}
