import { tool } from '@langchain/core/tools';
import {
  cancelPdfParseJob,
  getPdfParseJob,
  parsePDF,
  type ParsePDFDependencies,
  type PdfParseOptions,
} from '../pdf-parse';
import { materializePdfParseJobArtifact, parsePdfWithSkill } from '../pdf-parsing-skill';

interface ParsePdfToolInput extends PdfParseOptions {
  filePath: string;
}

interface PdfParseToolDependencies extends ParsePDFDependencies {
  projectPath?: string;
}

interface PdfParseJobToolInput {
  jobId: string;
}

const PARSE_PDF_SCHEMA = {
  type: 'object' as const,
  properties: {
    filePath: {
      type: 'string',
      description: 'Readable absolute local path to a PDF file. Relative paths and non-PDF files are rejected.',
    },
    parser: {
      type: 'string',
      enum: ['marker'],
      description: 'Parser to run. Defaults to marker.',
      default: 'marker',
    },
    pageRange: {
      type: 'string',
      description: 'Optional Marker page range for previews, tests, or recovery-focused parsing.',
    },
    fallback: {
      type: 'string',
      enum: ['none', 'agent-on-marker-failure', 'agent-for-selected-pages'],
      description: 'Agent-mediated recovery request shape. Non-none fallback is reported as not implemented in this slice.',
      default: 'none',
    },
    timeoutMs: {
      type: 'number',
      description: 'How long to wait for completion before returning a running PDF Parse Job.',
      default: 12000,
    },
  },
  required: ['filePath'],
  additionalProperties: false,
};

const PDF_PARSE_JOB_SCHEMA = {
  type: 'object' as const,
  properties: {
    jobId: {
      type: 'string',
      description: 'PDF Parse Job ID returned by parse_pdf.',
    },
  },
  required: ['jobId'],
  additionalProperties: false,
};

export function createPdfParseTools(dependencies: PdfParseToolDependencies = {}) {
  const parsePdf = tool(
    async (input: ParsePdfToolInput) => {
      if (dependencies.projectPath) {
        const result = await parsePdfWithSkill(dependencies.projectPath, input.filePath, {
          runner: dependencies.runner,
          createJobId: dependencies.createJobId,
          now: dependencies.now ? () => new Date(dependencies.now?.() ?? Date.now()) : undefined,
          parseOptions: {
            parser: input.parser,
            pageRange: input.pageRange,
            fallback: input.fallback,
            timeoutMs: input.timeoutMs,
          },
        });
        return JSON.stringify({
          success: result.status !== 'failed' && result.status !== 'canceled',
          ...result,
        });
      }

      const result = await parsePDF(input.filePath, {
        parser: input.parser,
        pageRange: input.pageRange,
        fallback: input.fallback,
        timeoutMs: input.timeoutMs,
      }, dependencies);
      return JSON.stringify({
        success: result.status !== 'failed' && result.status !== 'canceled',
        ...result,
      });
    },
    {
      name: 'parse_pdf',
      description: 'Parse a readable absolute local PDF path using local Marker. In a Project, writes a PDF Parse Artifact under .cdf/pdf-parses and returns a concise summary; long parses continue as cancellable PDF Parse Jobs.',
      schema: PARSE_PDF_SCHEMA,
    },
  );

  const status = tool(
    async (input: PdfParseJobToolInput) => {
      const job = getPdfParseJob(input.jobId);
      if (job && dependencies.projectPath) {
        const artifact = materializePdfParseJobArtifact(dependencies.projectPath, job);
        if (artifact) {
          return JSON.stringify({
            success: artifact.status !== 'failed' && artifact.status !== 'canceled',
            ...artifact,
          });
        }
      }
      return JSON.stringify(job
        ? { success: true, job }
        : { success: false, error: `PDF Parse Job not found: ${input.jobId}` });
    },
    {
      name: 'pdf_parse_status',
      description: 'Return the current status, diagnostics, and completed parse result for a PDF Parse Job.',
      schema: PDF_PARSE_JOB_SCHEMA,
    },
  );

  const cancel = tool(
    async (input: PdfParseJobToolInput) => {
      const job = cancelPdfParseJob(input.jobId);
      return JSON.stringify(job
        ? { success: true, job }
        : { success: false, error: `PDF Parse Job not found: ${input.jobId}` });
    },
    {
      name: 'pdf_parse_cancel',
      description: 'Cancel a running PDF Parse Job. Completed, failed, or already canceled jobs are returned unchanged.',
      schema: PDF_PARSE_JOB_SCHEMA,
    },
  );

  return [parsePdf, status, cancel];
}
