import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  parsePDF,
  type MarkerRunner,
  type PdfParseJobSnapshot,
  type PdfParseDiagnostic,
  type PdfParseDiagnosticCode,
  type PdfParseOptions,
  type StructuredPaperParse,
} from './pdf-parse';

export interface PdfParseSourceMetadata {
  path: string;
  fileSize: number;
  sha256: string;
}

export interface ParsePdfWithSkillDependencies {
  runner?: MarkerRunner;
  now?: () => Date;
  createJobId?: () => string;
  parseOptions?: PdfParseOptions;
}

export type PdfRecoveryRoute =
  | 'local-first'
  | 'vision-capability'
  | 'multimodal-agent'
  | 'ask-each-time';

export interface PdfRecoveryPreference {
  route: PdfRecoveryRoute;
  askAgainWhen: 'new-cost-or-privacy-risk';
}

export interface PdfRecoveryPreferencePlanSummary {
  candidateRoutes: PdfRecoveryRoute[];
  viableRoutes?: PdfRecoveryRoute[];
  introducesNewRisk: boolean;
}

export type PdfRecoveryRisk = 'network' | 'metered-provider' | 'page-or-text-upload';

export type PdfRecoveryTriggerCode = Extract<
  PdfParseDiagnosticCode,
  'MARKER_TIMEOUT' | 'OCR_ARTIFACTS' | 'FIGURE_ONLY_CONTENT' | 'MISSING_TABLE_STRUCTURE' | 'WEAK_SOURCE_LOCATION'
>;

export interface PdfRecoveryTarget {
  kind: 'document' | 'page' | 'block';
  page?: number;
  blockId?: string;
  reasons: PdfRecoveryTriggerCode[];
}

export interface PdfRecoveryPlan {
  artifactId: string;
  targets: PdfRecoveryTarget[];
  candidateRoutes: PdfRecoveryRoute[];
  routeRisks: PdfRecoveryRisk[];
  requiresPlanConfirmation: boolean;
  requiresManualPageSelection: false;
}

export interface PdfRecoveryRouteOption {
  route: PdfRecoveryRoute;
  capabilitySource: string;
  problemFit: string;
  privacyNetworkBehavior: string;
  possibleCost: string;
  processingScope: string;
  qualityExpectation: string;
}

export interface PdfRecoveryDiscoveryNextAction {
  kind: 'prepare-marker' | 'connect-vision-mcp' | 'configure-multimodal-agent';
  description: string;
}

export interface PdfRecoveryDiscoveredCapability {
  route: Exclude<PdfRecoveryRoute, 'ask-each-time'>;
  label: string;
  capabilitySource: string;
  problemFit: string;
  privacyNetworkBehavior: string;
  possibleCost: string;
  applicableReasons: PdfRecoveryTriggerCode[];
}

export type PdfRecoveryAgentJudgedRoute = Extract<PdfRecoveryRoute, 'vision-capability' | 'multimodal-agent'>;

export interface PdfRecoveryDiscoveryInput {
  localMarker?: {
    available: boolean;
    commandSource?: string;
  };
  agentViableRoutes?: PdfRecoveryAgentJudgedRoute[];
  diagnostics?: PdfParseDiagnostic[];
}

export interface PdfRecoveryCapabilityDiscovery {
  capabilities: PdfRecoveryDiscoveredCapability[];
  viableRoutes: PdfRecoveryRoute[];
  diagnostics: PdfParseDiagnostic[];
  nextActions: PdfRecoveryDiscoveryNextAction[];
}

export interface PdfRecoveryRouteDiscoveryOptions {
  capabilityDiscovery?: PdfRecoveryCapabilityDiscovery;
}

export type PdfRecoveryPreferenceResolution =
  | { action: 'reuse'; preference: PdfRecoveryPreference }
  | { action: 'ask'; reason: 'missing-preference' | 'unavailable-preference' | 'ask-each-time' | 'new-cost-or-privacy-risk' };

export type PdfRecoveryRouteDecision =
  | {
      status: 'no-viable-capability';
      diagnostics: PdfParseDiagnostic[];
      nextActions: PdfRecoveryDiscoveryNextAction[];
      options: [];
      requiresPlanConfirmation: false;
    }
  | {
      status: 'needs-route-choice';
      reason: PdfRecoveryPreferenceResolution['reason'] | 'meaningful-trade-offs';
      options: PdfRecoveryRouteOption[];
      requiresPlanConfirmation: boolean;
    }
  | {
      status: 'needs-plan-confirmation';
      route: PdfRecoveryRoute;
      routeRisks: PdfRecoveryRisk[];
      options: PdfRecoveryRouteOption[];
    }
  | {
      status: 'selected';
      route: PdfRecoveryRoute;
      planLevelConfirmed: boolean;
      source: 'preference' | 'user';
      routeRisks: PdfRecoveryRisk[];
    };

export interface PdfRecoveryOverlayProvenance {
  recoveryCapability: string;
  route: PdfRecoveryRoute;
  source: {
    kind: PdfRecoveryTarget['kind'];
    page?: number;
    blockId?: string;
  };
  diagnosticCode: PdfRecoveryTriggerCode;
  meteredNetworkApproved: boolean;
}

export interface PdfRecoveryOverlay {
  id: string;
  target: PdfRecoveryTarget;
  markdown: string;
  provenance: PdfRecoveryOverlayProvenance;
}

export type PdfRecoveryCapabilityResult =
  | { ok: true; markdown: string; target?: Pick<PdfRecoveryTarget, 'kind' | 'page' | 'blockId'> }
  | { ok: false; message: string; target?: Pick<PdfRecoveryTarget, 'kind' | 'page' | 'blockId'> };

export interface PdfRecoveryCapability {
  route: PdfRecoveryRoute;
  label: string;
  recover(target: PdfRecoveryTarget): Promise<PdfRecoveryCapabilityResult>;
}

export interface ParsePdfWithSkillCompletedResult {
  status: 'completed';
  artifactDir: string;
  source: PdfParseSourceMetadata;
  diagnostics: PdfParseDiagnostic[];
  conversationSummary: string;
}

export interface ParsePdfWithSkillArtifactResult {
  status: 'failed' | 'canceled';
  jobId: string;
  artifactDir: string;
  source: PdfParseSourceMetadata;
  diagnostics: PdfParseDiagnostic[];
  conversationSummary: string;
  error?: string;
}

export type ParsePdfWithSkillResult = ParsePdfWithSkillCompletedResult | ParsePdfWithSkillArtifactResult | {
  status: 'running' | 'failed' | 'canceled';
  jobId: string;
  diagnostics: PdfParseDiagnostic[];
  conversationSummary: string;
  error?: string;
};

export type PdfParseArtifactLookupResult =
  | {
      status: 'reusable-artifact';
      artifactDir: string;
      artifactId: string;
      createdAt?: string;
      source: PdfParseSourceMetadata;
      recoveredViewPath: string;
      baselinePath: string;
      diagnostics: PdfParseDiagnostic[];
      conversationSummary: string;
      nextActions: Array<{
        kind: 'read-recovered-view';
        path: string;
        description: string;
      }>;
    }
  | {
      status: 'stale-artifact';
      artifactDir: string;
      artifactId: string;
      createdAt?: string;
      source: PdfParseSourceMetadata;
      currentSource: PdfParseSourceMetadata;
      diagnostics: PdfParseDiagnostic[];
      conversationSummary: string;
      nextActions: Array<{
        kind: 'rerun-baseline-parse';
        description: string;
      }>;
    }
  | {
      status: 'not-parsed';
      source: PdfParseSourceMetadata;
      diagnostics: PdfParseDiagnostic[];
      conversationSummary: string;
      nextActions: Array<{
        kind: 'run-baseline-parse';
        description: string;
      }>;
    };

export interface PdfParsingSkillResource {
  relativePath: string;
  content: string;
}

export interface PdfParsingSkillResourceOptions {
  cliPath?: string;
}

type PdfParsingSkillEntrypointKey =
  | 'findArtifact'
  | 'baselineParse'
  | 'ensureMarker'
  | 'discoverCapabilities'
  | 'refreshRecoveryPlan'
  | 'setPreference'
  | 'clearPreference'
  | 'applyRecovery'
  | 'finalizeView';

const PDF_PARSING_SKILL_ENTRYPOINTS: Record<PdfParsingSkillEntrypointKey, {
  script: string;
  internalModule: string;
  exportName: string;
  purpose: string;
}> = {
  findArtifact: {
    script: 'scripts/find-artifact.js',
    internalModule: 'src/main/pdf-parsing-skill.ts',
    exportName: 'findReusablePdfParseArtifact',
    purpose: 'Find a reusable project-local PDF Parse Artifact by source PDF hash before parsing.',
  },
  baselineParse: {
    script: 'scripts/baseline-parse.js',
    internalModule: 'src/main/pdf-parsing-skill.ts',
    exportName: 'parsePdfWithSkill',
    purpose: 'Run the Marker baseline parse and write a project-local PDF Parse Artifact.',
  },
  ensureMarker: {
    script: 'scripts/ensure-marker.js',
    internalModule: 'external marker CLI',
    exportName: 'marker_single',
    purpose: 'Prepare or verify the local Marker CLI dependency used by the PDF Parsing Skill.',
  },
  discoverCapabilities: {
    script: 'scripts/discover-capabilities.js',
    internalModule: 'src/main/pdf-parsing-skill.ts',
    exportName: 'discoverPdfRecoveryCapabilities',
    purpose: 'Discover viable PDF Recovery Capability route categories for the current Agent environment.',
  },
  refreshRecoveryPlan: {
    script: 'scripts/refresh-recovery-plan.js',
    internalModule: 'src/main/pdf-parsing-skill.ts',
    exportName: 'generatePdfRecoveryPlan',
    purpose: 'Regenerate the automatic recovery plan from baseline diagnostics.',
  },
  setPreference: {
    script: 'scripts/set-preference.js',
    internalModule: 'src/main/pdf-parsing-skill.ts',
    exportName: 'updatePdfRecoveryPreference',
    purpose: 'Persist the project PDF recovery route preference in the managed AGENTS.md block.',
  },
  clearPreference: {
    script: 'scripts/clear-preference.js',
    internalModule: 'src/main/pdf-parsing-skill.ts',
    exportName: 'clearPdfRecoveryPreference',
    purpose: 'Remove the managed project PDF recovery route preference block.',
  },
  applyRecovery: {
    script: 'scripts/apply-recovery.js',
    internalModule: 'src/main/pdf-parsing-skill.ts',
    exportName: 'executePdfRecoveryPlan',
    purpose: 'Apply an approved recovery plan through the selected recovery capability.',
  },
  finalizeView: {
    script: 'scripts/finalize-view.js',
    internalModule: 'src/main/pdf-parsing-skill.ts',
    exportName: 'finalizeRecoveredPaperParseView',
    purpose: 'Write the best recovered PDF parse view and final diagnostics artifacts.',
  },
};

const PDF_RECOVERY_BLOCK_START = '<!-- CDF:pdf-recovery:start -->';
const PDF_RECOVERY_BLOCK_END = '<!-- CDF:pdf-recovery:end -->';
const PDF_RECOVERY_BLOCK_PATTERN = /<!-- CDF:pdf-recovery:start -->[\s\S]*?<!-- CDF:pdf-recovery:end -->/;
const PDF_RECOVERY_BLOCK_WITH_PADDING_PATTERN = /\n*<!-- CDF:pdf-recovery:start -->[\s\S]*?<!-- CDF:pdf-recovery:end -->\n?/;
const PDF_RECOVERY_ROUTES: PdfRecoveryRoute[] = [
  'local-first',
  'vision-capability',
  'multimodal-agent',
  'ask-each-time',
];
const PDF_RECOVERY_TRIGGER_CODES: PdfRecoveryTriggerCode[] = [
  'MARKER_TIMEOUT',
  'OCR_ARTIFACTS',
  'FIGURE_ONLY_CONTENT',
  'MISSING_TABLE_STRUCTURE',
  'WEAK_SOURCE_LOCATION',
];

function candidateRoutesForReason(reason: PdfRecoveryTriggerCode): PdfRecoveryRoute[] {
  switch (reason) {
    case 'MARKER_TIMEOUT':
      return ['local-first', 'vision-capability'];
    case 'WEAK_SOURCE_LOCATION':
      return ['local-first'];
    case 'OCR_ARTIFACTS':
    case 'FIGURE_ONLY_CONTENT':
    case 'MISSING_TABLE_STRUCTURE':
      return ['vision-capability', 'multimodal-agent'];
  }
}

function reasonsForRoute(route: Exclude<PdfRecoveryRoute, 'ask-each-time'>): PdfRecoveryTriggerCode[] {
  return PDF_RECOVERY_TRIGGER_CODES.filter((reason) => candidateRoutesForReason(reason).includes(route));
}

function orderedRoutes(
  routes: Iterable<PdfRecoveryRoute>,
  options: { includeAskEachTime?: boolean } = {},
): PdfRecoveryRoute[] {
  const routeSet = routes instanceof Set ? routes : new Set(routes);
  return PDF_RECOVERY_ROUTES.filter((route) =>
    (options.includeAskEachTime || route !== 'ask-each-time') && routeSet.has(route)
  );
}

function unavailableCapabilityDiagnostic(message: string): PdfParseDiagnostic {
  return {
    severity: 'warning',
    code: 'PDF_RECOVERY_CAPABILITY_UNAVAILABLE',
    message,
  };
}

function nextActionsForRoutes(routes: readonly PdfRecoveryRoute[]): PdfRecoveryDiscoveryNextAction[] {
  const actions: PdfRecoveryDiscoveryNextAction[] = [];
  if (routes.includes('local-first')) {
    actions.push({
      kind: 'prepare-marker',
      description: 'Run the PDF Parsing Skill Marker preparation script, then rerun capability discovery.',
    });
  }
  if (routes.includes('vision-capability')) {
    actions.push({
      kind: 'connect-vision-mcp',
      description: 'Connect an MCP tool that can inspect PDF page images or screenshots.',
    });
  }
  if (routes.includes('multimodal-agent')) {
    actions.push({
      kind: 'configure-multimodal-agent',
      description: 'Configure an Agent model capability that explicitly supports page images or multimodal inputs.',
    });
  }
  return actions;
}

function discoveryNextActions(capabilities: PdfRecoveryDiscoveredCapability[]): PdfRecoveryDiscoveryNextAction[] {
  if (capabilities.length > 0) return [];
  return nextActionsForRoutes(['local-first', 'vision-capability', 'multimodal-agent']);
}

export function discoverPdfRecoveryCapabilities(input: PdfRecoveryDiscoveryInput = {}): PdfRecoveryCapabilityDiscovery {
  const capabilities: PdfRecoveryDiscoveredCapability[] = [];

  if (input.localMarker?.available) {
    capabilities.push({
      route: 'local-first',
      label: 'Local Marker-compatible recovery',
      capabilitySource: 'local Marker-compatible recovery command',
      problemFit: 'Local retries and source-location repair for weak baseline evidence.',
      privacyNetworkBehavior: 'Runs locally; no PDF page or text upload is required.',
      possibleCost: 'No metered provider cost expected.',
      applicableReasons: reasonsForRoute('local-first'),
    });
  }

  const agentViableRoutes = orderedRoutes(input.agentViableRoutes ?? []);
  if (agentViableRoutes.includes('vision-capability')) {
    capabilities.push({
      route: 'vision-capability',
      label: 'Agent-judged vision-capable recovery',
      capabilitySource: 'MCP vision-capable tool',
      problemFit: 'Page-image, OCR, figure, and table recovery through an Agent-accessible tool.',
      privacyNetworkBehavior: 'Depends on the selected MCP server; page images or text may leave the local machine.',
      possibleCost: 'Depends on the selected MCP server or backing provider.',
      applicableReasons: reasonsForRoute('vision-capability'),
    });
  }

  if (agentViableRoutes.includes('multimodal-agent')) {
    capabilities.push({
      route: 'multimodal-agent',
      label: 'Configured multimodal Agent capability',
      capabilitySource: 'configured multimodal Agent capability',
      problemFit: 'Layout-aware recovery for images, formulas, tables, and mixed visual evidence.',
      privacyNetworkBehavior: 'Uses the configured Agent model path; page images or text may be sent through that model route.',
      possibleCost: 'May use metered provider capacity.',
      applicableReasons: reasonsForRoute('multimodal-agent'),
    });
  }

  const diagnostics: PdfParseDiagnostic[] = [...(input.diagnostics ?? [])];
  if (capabilities.length === 0) {
    diagnostics.push(unavailableCapabilityDiagnostic('No viable PDF Recovery Capability was discovered for the current Agent environment.'));
  }

  return {
    capabilities,
    viableRoutes: orderedRoutes(capabilities.map((capability) => capability.route)),
    diagnostics,
    nextActions: discoveryNextActions(capabilities),
  };
}

export function getPdfParsingSkillMarkdown(): string {
  return [
    '---',
    'name: pdf-parsing',
    'description: Parse local academic PDFs with Marker baseline artifacts and Agent-mediated recovery.',
    'when_to_use: Use when the user asks to parse, recover, inspect, or prepare a local PDF for downstream Agent work.',
    '---',
    '',
    '# PDF Parsing Skill',
    '',
    'Use this Skill as the Agent-facing PDF parsing entry point.',
    '',
    '## Artifact Lookup',
    '',
    'Before running Marker, check whether the source PDF already has a reusable artifact.',
    '',
    '1. Run `scripts/find-artifact.js --project <projectPath> --file <absolutePdfPath>`.',
    '2. If it returns `reusable-artifact`, read the returned `recoveredViewPath` and do not rerun Marker.',
    '3. If it returns `stale-artifact`, the source PDF SHA-256 no longer matches artifact metadata; rerun baseline parsing.',
    '4. If it returns `not-parsed`, run baseline parsing on demand.',
    '',
    '## Baseline Parse',
    '',
    '1. Accept a readable absolute local PDF path.',
    '2. Run the local Marker baseline parser.',
    '3. Write a project-local PDF Parse Artifact under `.cdf/pdf-parses/<timestamp>-<sha256-prefix>/`.',
    '4. Return a concise Conversation summary with the artifact path and key diagnostics instead of large parse JSON.',
    '',
    'Artifacts record source metadata, baseline parse output, diagnostics, overlays, recovered-view markdown, and minimal provenance.',
    'Do not copy the source PDF into the artifact by default.',
    '',
    '## Recovery',
    '',
    'After the baseline parse, inspect diagnostics and generate an automatic recovery plan.',
    'Run capability discovery before choosing a recovery route so unavailable route categories are not offered.',
    'Before discovery, judge the non-local route categories from your current Agent environment and pass only confident categories with `--viable-routes`.',
    '',
    'Route viability semantics:',
    '- `vision-capability`: report this only when you can see an MCP tool that accepts page images or visual input for PDF recovery. A visible tool must accept image input; a tool that only generates images does not count.',
    '- `multimodal-agent`: report this only when the currently configured Agent model accepts image, page-image, or multimodal input. A configured Agent model must accept image input; a provider family having a multimodal model does not count unless the current model is configured that way.',
    '- `local-first`: do not report this; the script probes local Marker availability itself.',
    '',
    'When unsure, omit the route. A missed route is recoverable through next actions, while a falsely claimed route can fail during execution after the user has chosen or confirmed it.',
    'Ask for route choice or plan-level confirmation only when meaningful capability, privacy, network, upload, or cost trade-offs exist.',
    'Recovery scripts operate on the artifact directory produced by `baseline-parse.js`.',
    'Use `set-preference.js` and `clear-preference.js` only for the managed Project `AGENTS.md` PDF recovery preference block.',
    'Use `apply-recovery.js` only after an explicit route selection and any required plan-level confirmation; provide recovery results from the selected capability as a JSON array.',
    'Each recovery result may include `target: { kind, page, blockId }`; `apply-recovery.js` matches by target first and falls back to array order only for older result files.',
    '',
    '## Failure Handling',
    '',
    'If an entrypoint fails with missing runtime chunks such as `Cannot find module \'./chunks/...\'`, treat the built-in Skill runtime as stale and regenerate the Skill resources from CDF instead of editing the generated script by hand.',
    'For PDFs that already have a text layer, baseline parsing automatically adds `--disable_ocr` to Marker and records `TEXT_LAYER_OCR_DISABLED` in diagnostics and provenance.',
    'If baseline parsing reports `MARKER_ALREADY_RUNNING`, do not start a second Marker command for the same PDF; wait for the existing parse to finish before rerunning `scripts/baseline-parse.js`.',
    'If baseline parsing reports `MARKER_UNAVAILABLE`, run `scripts/ensure-marker.js` through the shell, then rerun `scripts/baseline-parse.js`.',
    'If Marker is unavailable or fails and the PDF has a text layer, the compiled CLI may use the local PyMuPDF text-layer fallback and record `TEXT_LAYER_FALLBACK_USED` with parser `pymupdf-text-layer`.',
    'Do not create ad hoc parser scripts; keep PDF parsing, fallback, diagnostics, and artifact writes inside these Skill entrypoints.',
    '',
    '## Entrypoints',
    '',
    'PDF-specific execution is packaged in this Skill as `entrypoints.json` and `scripts/*.js` resources.',
    '',
    '- `scripts/find-artifact.js --project <projectPath> --file <absolutePdfPath>`: checks `.cdf/pdf-parses/` by source SHA-256 and returns `reusable-artifact`, `stale-artifact`, or `not-parsed` with next actions.',
    '- `scripts/baseline-parse.js --project <projectPath> --file <absolutePdfPath> [--page-range <range>]`: runs Marker through the compiled CDF PDF Skill CLI, writes `.cdf/pdf-parses/<artifactId>/`, and returns a compact JSON summary with diagnostics and next actions.',
    '- `scripts/ensure-marker.js --mode prepare|check`: verifies or prepares the local Marker command used by baseline parsing.',
    '- `scripts/discover-capabilities.js [--viable-routes <vision-capability,multimodal-agent>]`: probes local Marker, merges Agent-judged non-local route categories, and returns viable PDF Recovery Capability route categories, source/privacy/cost/problem-fit notes, and next actions when no capability is available.',
    '- `scripts/refresh-recovery-plan.js --artifact <artifactDir>`: regenerates `recovery-plan.json` from `baseline.json` diagnostics and block evidence.',
    '- `scripts/set-preference.js --project <projectPath> --route <local-first|vision-capability|multimodal-agent|ask-each-time>`: writes the managed PDF recovery preference block in `AGENTS.md`.',
    '- `scripts/clear-preference.js --project <projectPath>`: removes only the managed PDF recovery preference block from `AGENTS.md`.',
    '- `scripts/apply-recovery.js --artifact <artifactDir> --route <route> --plan-confirmed --results-file <json> [--capability-label <label>]`: records the selected route and applies recovery results through the internal recovery seam.',
    '- `scripts/finalize-view.js --artifact <artifactDir> [--comparison-trace]`: rewrites `recovered-view.md` from `baseline.json`, `overlays.json`, and `diagnostics.json`.',
    '',
    'The Skill script path is synchronous; it does not expose cross-process status or cancel scripts. Long-running Marker process management remains inside the compiled CDF CLI invocation.',
    'Do not call global Agent tools named `parse_pdf`, `pdf_parse_status`, or `pdf_parse_cancel`; those tools are intentionally not part of the global tool surface.',
  ].join('\n');
}

function buildPdfParsingSkillEntrypointManifest(): string {
  const scripts = Object.fromEntries(
    Object.entries(PDF_PARSING_SKILL_ENTRYPOINTS).map(([key, value]) => [key, value.script]),
  );
  return `${JSON.stringify({
    skill: 'pdf-parsing',
    globalToolsRemoved: ['parse_pdf', 'pdf_parse_status', 'pdf_parse_cancel'],
    scripts,
  }, null, 2)}\n`;
}

function buildPdfParsingSkillScript(
  name: string,
  entrypoint: typeof PDF_PARSING_SKILL_ENTRYPOINTS[PdfParsingSkillEntrypointKey],
  options: PdfParsingSkillResourceOptions = {},
): string {
  if (name === 'ensureMarker') {
    return buildPdfParsingSkillEnsureMarkerScript(entrypoint);
  }
  return `#!/usr/bin/env node
'use strict';

// CDF built-in PDF Parsing Skill entrypoint resource.
// Backed by ${entrypoint.internalModule}#${entrypoint.exportName}.
// The script is a thin shell-facing entrypoint over the compiled CDF CLI; PDF
// behavior stays in src/main/pdf-parsing-skill.ts and src/main/pdf-parse.ts.
const path = require('path');
const { spawnSync } = require('child_process');

const entrypoint = {
  skill: 'pdf-parsing',
  operation: ${JSON.stringify(name)},
  internalModule: ${JSON.stringify(entrypoint.internalModule)},
  exportName: ${JSON.stringify(entrypoint.exportName)},
  purpose: ${JSON.stringify(entrypoint.purpose)},
};

const cliPath = process.env.CDF_PDF_SKILL_CLI_PATH || ${JSON.stringify(options.cliPath ?? '')};

if (!cliPath) {
  process.stdout.write(JSON.stringify({
    status: 'failed',
    entrypoint,
    error: 'CDF_PDF_SKILL_CLI_PATH is not configured.',
  }, null, 2) + '\\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, [cliPath, entrypoint.operation, ...process.argv.slice(2)], {
  encoding: 'utf-8',
  env: {
    ...process.env,
    CDF_PDF_SKILL_DIR: path.resolve(__dirname, '..'),
  },
  windowsHide: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  process.stdout.write(JSON.stringify({
    status: 'failed',
    entrypoint,
    error: result.error.message,
  }, null, 2) + '\\n');
  process.exitCode = 1;
} else {
  process.exitCode = result.status || 0;
}
`;
}

function buildPdfParsingSkillEnsureMarkerScript(entrypoint: typeof PDF_PARSING_SKILL_ENTRYPOINTS[PdfParsingSkillEntrypointKey]): string {
  return `#!/usr/bin/env node
'use strict';

// CDF built-in PDF Parsing Skill dependency preparation entrypoint.
// Backed by ${entrypoint.internalModule}#${entrypoint.exportName}.
const { spawnSync } = require('child_process');

const entrypoint = {
  skill: 'pdf-parsing',
  operation: 'ensureMarker',
  internalModule: ${JSON.stringify(entrypoint.internalModule)},
  exportName: ${JSON.stringify(entrypoint.exportName)},
  purpose: ${JSON.stringify(entrypoint.purpose)},
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function splitConfiguredCommand(command) {
  const parts = [];
  let current = '';
  let quote = null;
  const pushCurrent = () => {
    if (!current) return;
    parts.push(current);
    current = '';
  };
  const isEscapable = (char) => char === '"' || char === "'" || char === '\\\\' || char === ' ';
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === '\\\\' && quote !== "'") {
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
    if (/\\s/.test(char)) {
      pushCurrent();
      continue;
    }
    current += char;
  }
  pushCurrent();
  return parts;
}

function configuredMarkerCommand() {
  const configured = (process.env.CDF_MARKER_COMMAND || '').trim();
  if (configured) {
    const parts = splitConfiguredCommand(configured);
    if (parts[0]) return { command: parts[0], args: parts.slice(1), source: 'CDF_MARKER_COMMAND' };
  }
  return { command: 'uvx', args: ['--from', 'marker-pdf', 'marker_single'], source: 'default-uvx-marker-pdf' };
}

function runHelp(command, args) {
  return spawnSync(command, [...args, '--help'], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: Number(process.env.CDF_MARKER_PREPARE_TIMEOUT_MS || 300000),
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode === 'check' ? 'check' : 'prepare';
  const configured = configuredMarkerCommand();
  const result = runHelp(configured.command, configured.args);
  if (result.error) {
    const payload = {
      status: 'unavailable',
      entrypoint,
      mode,
      command: configured.command,
      args: configured.args,
      commandSource: configured.source,
      diagnostics: [
        {
          severity: 'error',
          code: result.error.code === 'ENOENT' ? 'MARKER_BOOTSTRAP_UNAVAILABLE' : 'MARKER_BOOTSTRAP_FAILED',
          message: result.error.message,
        },
      ],
      suggestedCommands: [
        'Install uv, then rerun this script: https://docs.astral.sh/uv/getting-started/installation/',
        'Or set CDF_MARKER_COMMAND to an existing Marker command, then rerun baseline-parse.js.',
      ],
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\\n');
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) {
    process.stdout.write(JSON.stringify({
      status: 'unavailable',
      entrypoint,
      mode,
      command: configured.command,
      args: configured.args,
      commandSource: configured.source,
      diagnostics: [
        {
          severity: 'error',
          code: 'MARKER_BOOTSTRAP_FAILED',
          message: result.stderr || 'Marker prepare command exited with code ' + result.status,
        },
      ],
    }, null, 2) + '\\n');
    process.exitCode = result.status || 1;
    return;
  }
  process.stdout.write(JSON.stringify({
    status: 'ready',
    entrypoint,
    mode,
    command: configured.command,
    args: configured.args,
    commandSource: configured.source,
    message: configured.source === 'default-uvx-marker-pdf'
      ? 'Marker is available through uvx marker-pdf cache.'
      : 'Marker command is available.',
  }, null, 2) + '\\n');
}

main();
`;
}

export function getPdfParsingSkillResources(options: PdfParsingSkillResourceOptions = {}): PdfParsingSkillResource[] {
  const resources: PdfParsingSkillResource[] = [
    {
      relativePath: 'entrypoints.json',
      content: buildPdfParsingSkillEntrypointManifest(),
    },
  ];

  for (const [name, entrypoint] of Object.entries(PDF_PARSING_SKILL_ENTRYPOINTS)) {
    resources.push({
      relativePath: entrypoint.script,
      content: buildPdfParsingSkillScript(name, entrypoint, options),
    });
  }

  return resources;
}

function getAgentsPath(projectPath: string): string {
  return path.join(projectPath, 'AGENTS.md');
}

function isPdfRecoveryRoute(value: string): value is PdfRecoveryRoute {
  return (PDF_RECOVERY_ROUTES as string[]).includes(value);
}

function assertPdfRecoveryPreference(preference: PdfRecoveryPreference): void {
  if (!isPdfRecoveryRoute(preference.route)) {
    throw new Error('PDF Recovery Preference stores route categories only, not provider/model/MCP/CLI identifiers.');
  }
  if (preference.askAgainWhen !== 'new-cost-or-privacy-risk') {
    throw new Error('Unsupported PDF Recovery Preference askAgainWhen value.');
  }
}

function buildPdfRecoveryPreferenceBlock(preference: PdfRecoveryPreference): string {
  assertPdfRecoveryPreference(preference);
  return [
    PDF_RECOVERY_BLOCK_START,
    'PDF recovery preference:',
    `- route: ${preference.route}`,
    `- askAgainWhen: ${preference.askAgainWhen}`,
    PDF_RECOVERY_BLOCK_END,
  ].join('\n');
}

export function readPdfRecoveryPreference(projectPath: string): PdfRecoveryPreference | null {
  const agentsPath = getAgentsPath(projectPath);
  if (!fs.existsSync(agentsPath)) return null;
  const content = fs.readFileSync(agentsPath, 'utf-8');
  const block = content.match(PDF_RECOVERY_BLOCK_PATTERN)?.[0];
  if (!block) return null;

  const route = block.match(/^\s*-\s*route:\s*([^\n]+)\s*$/m)?.[1]?.trim();
  const askAgainWhen = block.match(/^\s*-\s*askAgainWhen:\s*([^\n]+)\s*$/m)?.[1]?.trim();
  if (!route || !isPdfRecoveryRoute(route)) return null;
  if (askAgainWhen !== 'new-cost-or-privacy-risk') return null;
  return {
    route,
    askAgainWhen,
  };
}

export function updatePdfRecoveryPreference(projectPath: string, preference: PdfRecoveryPreference): void {
  const block = buildPdfRecoveryPreferenceBlock(preference);
  const agentsPath = getAgentsPath(projectPath);
  const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf-8') : '';
  const next = PDF_RECOVERY_BLOCK_PATTERN.test(existing)
    ? existing.replace(PDF_RECOVERY_BLOCK_PATTERN, block)
    : existing.trimEnd().length > 0
      ? `${existing.trimEnd()}\n\n${block}\n`
      : `${block}\n`;
  fs.writeFileSync(agentsPath, next, 'utf-8');
}

export function clearPdfRecoveryPreference(projectPath: string): void {
  const agentsPath = getAgentsPath(projectPath);
  if (!fs.existsSync(agentsPath)) return;
  const existing = fs.readFileSync(agentsPath, 'utf-8');
  const next = existing.replace(PDF_RECOVERY_BLOCK_WITH_PADDING_PATTERN, '\n').trimEnd();
  fs.writeFileSync(agentsPath, next.length > 0 ? `${next}\n` : '', 'utf-8');
}

export function resolvePdfRecoveryPreferenceForPlan(
  projectPath: string,
  plan: PdfRecoveryPreferencePlanSummary,
): PdfRecoveryPreferenceResolution {
  const preference = readPdfRecoveryPreference(projectPath);
  if (!preference) return { action: 'ask', reason: 'missing-preference' };
  if (preference.route === 'ask-each-time') return { action: 'ask', reason: 'ask-each-time' };
  const viableRoutes = plan.viableRoutes ?? plan.candidateRoutes;
  if (!plan.candidateRoutes.includes(preference.route) || !viableRoutes.includes(preference.route)) {
    return { action: 'ask', reason: 'unavailable-preference' };
  }
  if (plan.introducesNewRisk) return { action: 'ask', reason: 'new-cost-or-privacy-risk' };
  return { action: 'reuse', preference };
}

function isPdfRecoveryTriggerCode(code: PdfParseDiagnosticCode): code is PdfRecoveryTriggerCode {
  return (PDF_RECOVERY_TRIGGER_CODES as string[]).includes(code);
}

function addRoute(routes: Set<PdfRecoveryRoute>, route: PdfRecoveryRoute): void {
  routes.add(route);
}

function risksForRoutes(routes: PdfRecoveryRoute[]): PdfRecoveryRisk[] {
  const risks = new Set<PdfRecoveryRisk>();
  if (routes.includes('vision-capability') || routes.includes('multimodal-agent')) {
    risks.add('network');
    risks.add('metered-provider');
    risks.add('page-or-text-upload');
  }
  return ['network', 'metered-provider', 'page-or-text-upload'].filter((risk) => risks.has(risk as PdfRecoveryRisk)) as PdfRecoveryRisk[];
}

function mergeTarget(targets: PdfRecoveryTarget[], next: PdfRecoveryTarget): void {
  const existing = targets.find((target) =>
    target.kind === next.kind &&
    target.page === next.page &&
    target.blockId === next.blockId
  );
  if (!existing) {
    targets.push(next);
    return;
  }
  for (const reason of next.reasons) {
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
  }
}

function planFromDiagnostics(
  artifactId: string,
  diagnostics: PdfParseDiagnostic[],
  blocks: StructuredPaperParse['blocks'],
): PdfRecoveryPlan {
  const targets: PdfRecoveryTarget[] = [];
  const candidateRoutes = new Set<PdfRecoveryRoute>();

  for (const diagnostic of diagnostics) {
    if (!isPdfRecoveryTriggerCode(diagnostic.code)) continue;
    for (const route of candidateRoutesForReason(diagnostic.code)) {
      addRoute(candidateRoutes, route);
    }
    if (diagnostic.code === 'WEAK_SOURCE_LOCATION' && diagnostic.page === undefined) {
      const weakBlocks = blocks.filter((block) => !block.location.markerAnchor);
      if (weakBlocks.length === 0) {
        mergeTarget(targets, { kind: 'document', reasons: ['WEAK_SOURCE_LOCATION'] });
        continue;
      }
      for (const block of weakBlocks) {
        mergeTarget(targets, {
          kind: 'block',
          blockId: block.id,
          page: block.pageStart,
          reasons: ['WEAK_SOURCE_LOCATION'],
        });
      }
      continue;
    }
    mergeTarget(targets, diagnostic.page === undefined
      ? { kind: 'document', reasons: [diagnostic.code] }
      : { kind: 'page', page: diagnostic.page, reasons: [diagnostic.code] });
  }

  const routes = orderedRoutes(candidateRoutes);
  const routeRisks = risksForRoutes(routes);
  return {
    artifactId,
    targets,
    candidateRoutes: routes,
    routeRisks,
    requiresPlanConfirmation: routeRisks.length > 0,
    requiresManualPageSelection: false,
  };
}

export function generatePdfRecoveryPlan(input: {
  artifactId: string;
  baseline: StructuredPaperParse;
}): PdfRecoveryPlan {
  return planFromDiagnostics(input.artifactId, input.baseline.diagnostics, input.baseline.blocks);
}

function routeOption(
  route: PdfRecoveryRoute,
  targetCount: number,
  routeRisks: readonly PdfRecoveryRisk[],
  discoveredCapability?: PdfRecoveryDiscoveredCapability,
): PdfRecoveryRouteOption {
  const processingScope = `${targetCount} recovery target${targetCount === 1 ? '' : 's'}`;
  switch (route) {
    case 'local-first':
      return {
        route,
        capabilitySource: discoveredCapability?.capabilitySource ?? 'local recovery capability',
        problemFit: discoveredCapability?.problemFit ?? 'Best for weak source grounding, reruns, and low-risk local repair.',
        privacyNetworkBehavior: discoveredCapability?.privacyNetworkBehavior ?? 'Runs locally when a local capability is available.',
        possibleCost: discoveredCapability?.possibleCost ?? 'No metered provider cost expected.',
        processingScope,
        qualityExpectation: 'Conservative quality; useful for metadata and source-location repair.',
      };
    case 'vision-capability':
      return {
        route,
        capabilitySource: discoveredCapability?.capabilitySource ?? 'vision-capable recovery capability',
        problemFit: discoveredCapability?.problemFit ?? 'Best for scanned pages, figures, tables, and OCR artifacts.',
        privacyNetworkBehavior: discoveredCapability?.privacyNetworkBehavior ?? (routeRisks.includes('network')
          ? 'May use network access and page or text upload.'
          : 'Uses the selected vision-capable route without new network risk.'),
        possibleCost: discoveredCapability?.possibleCost ?? (routeRisks.includes('metered-provider')
          ? 'May use metered provider capacity.'
          : 'No new metered provider cost indicated.'),
        processingScope,
        qualityExpectation: 'Higher quality for visual layout and table recovery.',
      };
    case 'multimodal-agent':
      return {
        route,
        capabilitySource: discoveredCapability?.capabilitySource ?? 'multimodal Agent capability category',
        problemFit: discoveredCapability?.problemFit ?? 'Best for mixed text, layout, formulas, and figure-heavy evidence.',
        privacyNetworkBehavior: discoveredCapability?.privacyNetworkBehavior ?? (routeRisks.includes('network')
          ? 'May use network access and page or text upload.'
          : 'Uses the selected multimodal route without new network risk.'),
        possibleCost: discoveredCapability?.possibleCost ?? (routeRisks.includes('metered-provider')
          ? 'May use metered provider capacity.'
          : 'No new metered provider cost indicated.'),
        processingScope,
        qualityExpectation: 'Strongest layout-aware recovery when an appropriate capability is configured.',
      };
    case 'ask-each-time':
      return {
        route,
        capabilitySource: 'manual route choice',
        problemFit: 'Best when the user wants to decide on every parse.',
        privacyNetworkBehavior: 'Depends on the route selected at runtime.',
        possibleCost: 'Depends on the route selected at runtime.',
        processingScope,
        qualityExpectation: 'Depends on the selected capability category.',
      };
  }
}

function routeCapabilitiesByRoute(
  discovery: PdfRecoveryCapabilityDiscovery | undefined,
): Map<PdfRecoveryRoute, PdfRecoveryDiscoveredCapability> {
  const capabilities = new Map<PdfRecoveryRoute, PdfRecoveryDiscoveredCapability>();
  for (const capability of discovery?.capabilities ?? []) {
    if (!capabilities.has(capability.route)) capabilities.set(capability.route, capability);
  }
  return capabilities;
}

function buildRouteOptions(
  routes: readonly PdfRecoveryRoute[],
  routeRisks: readonly PdfRecoveryRisk[],
  capabilitiesByRoute: Map<PdfRecoveryRoute, PdfRecoveryDiscoveredCapability>,
  targetCount: number,
): PdfRecoveryRouteOption[] {
  return routes.map((route) => routeOption(route, targetCount, routeRisks, capabilitiesByRoute.get(route)));
}

function viableCandidateRoutes(
  candidateRoutes: readonly PdfRecoveryRoute[],
  discovery: PdfRecoveryCapabilityDiscovery | undefined,
): PdfRecoveryRoute[] {
  const candidates = orderedRoutes(candidateRoutes, { includeAskEachTime: !discovery });
  if (!discovery) return candidates;
  const viable = new Set(discovery.viableRoutes);
  return candidates.filter((route) => viable.has(route));
}

function effectiveRouteRisks(
  plan: Pick<PdfRecoveryPlan, 'routeRisks'>,
  routes: PdfRecoveryRoute[],
  discovery: PdfRecoveryCapabilityDiscovery | undefined,
): PdfRecoveryRisk[] {
  if (!discovery) return [...plan.routeRisks];
  const discoveredRisks = new Set(risksForRoutes(routes));
  return plan.routeRisks.filter((risk) => discoveredRisks.has(risk));
}

function effectiveRequiresPlanConfirmation(
  planRequiresConfirmation: boolean,
  discovery: PdfRecoveryCapabilityDiscovery | undefined,
  routeRisks: readonly PdfRecoveryRisk[],
): boolean {
  if (!planRequiresConfirmation) return false;
  if (!discovery) return true;
  return routeRisks.length > 0;
}

export function summarizePdfRecoveryRoutes(
  plan: Pick<PdfRecoveryPlan, 'targets' | 'candidateRoutes' | 'routeRisks'>,
  options: PdfRecoveryRouteDiscoveryOptions = {},
): PdfRecoveryRouteOption[] {
  const routes = viableCandidateRoutes(plan.candidateRoutes, options.capabilityDiscovery);
  const routeRisks = effectiveRouteRisks(plan, routes, options.capabilityDiscovery);
  const capabilitiesByRoute = routeCapabilitiesByRoute(options.capabilityDiscovery);
  return buildRouteOptions(routes, routeRisks, capabilitiesByRoute, plan.targets.length);
}

function getSelectedRoute(options: {
  selectedRoute?: PdfRecoveryRoute;
}): PdfRecoveryRoute | null {
  return options.selectedRoute ?? null;
}

export function decidePdfRecoveryRoute(
  projectPath: string,
  plan: Pick<PdfRecoveryPlan, 'targets' | 'candidateRoutes' | 'routeRisks' | 'requiresPlanConfirmation'>,
  options: {
    selectedRoute?: PdfRecoveryRoute;
    planLevelConfirmed?: boolean;
    introducesNewRisk?: boolean;
    capabilityDiscovery?: PdfRecoveryCapabilityDiscovery;
  } = {},
): PdfRecoveryRouteDecision {
  const candidateRoutes = viableCandidateRoutes(plan.candidateRoutes, options.capabilityDiscovery);
  const routeRisks = effectiveRouteRisks(plan, candidateRoutes, options.capabilityDiscovery);
  const requiresPlanConfirmation = effectiveRequiresPlanConfirmation(
    plan.requiresPlanConfirmation,
    options.capabilityDiscovery,
    routeRisks,
  );
  if (options.capabilityDiscovery && candidateRoutes.length === 0) {
    return {
      status: 'no-viable-capability',
      diagnostics: options.capabilityDiscovery.diagnostics.length > 0
        ? options.capabilityDiscovery.diagnostics
        : [
            unavailableCapabilityDiagnostic(
              'No discovered PDF Recovery Capability can satisfy this recovery plan.',
            ),
          ],
      nextActions: options.capabilityDiscovery.nextActions.length > 0
        ? options.capabilityDiscovery.nextActions
        : nextActionsForRoutes(plan.candidateRoutes),
      options: [],
      requiresPlanConfirmation: false,
    };
  }
  const capabilitiesByRoute = routeCapabilitiesByRoute(options.capabilityDiscovery);
  const routeOptions = buildRouteOptions(candidateRoutes, routeRisks, capabilitiesByRoute, plan.targets.length);
  const selectedRoute = getSelectedRoute(options);
  if (selectedRoute) {
    if (!candidateRoutes.includes(selectedRoute)) {
      return {
        status: 'needs-route-choice',
        reason: 'unavailable-preference',
        options: routeOptions,
        requiresPlanConfirmation,
      };
    }
    if (requiresPlanConfirmation && !options.planLevelConfirmed) {
      return {
        status: 'needs-plan-confirmation',
        route: selectedRoute,
        routeRisks,
        options: routeOptions,
      };
    }
    return {
      status: 'selected',
      route: selectedRoute,
      planLevelConfirmed: !requiresPlanConfirmation || options.planLevelConfirmed === true,
      source: 'user',
      routeRisks,
    };
  }

  const preferenceResolution = resolvePdfRecoveryPreferenceForPlan(projectPath, {
    candidateRoutes: [...plan.candidateRoutes],
    viableRoutes: candidateRoutes,
    introducesNewRisk: options.introducesNewRisk ?? routeRisks.length > 0,
  });
  if (preferenceResolution.action === 'reuse') {
    if (requiresPlanConfirmation) {
      return {
        status: 'needs-plan-confirmation',
        route: preferenceResolution.preference.route,
        routeRisks,
        options: routeOptions,
      };
    }
    return {
      status: 'selected',
      route: preferenceResolution.preference.route,
      planLevelConfirmed: !requiresPlanConfirmation,
      source: 'preference',
      routeRisks,
    };
  }

  return {
    status: 'needs-route-choice',
    reason: preferenceResolution.reason === 'missing-preference' && candidateRoutes.length > 1
      ? 'meaningful-trade-offs'
      : preferenceResolution.reason,
    options: routeOptions,
    requiresPlanConfirmation,
  };
}

export function recordPdfRecoveryRouteSelection(
  artifactDir: string,
  decision: Extract<PdfRecoveryRouteDecision, { status: 'selected' }>,
): void {
  writeJson(path.join(artifactDir, 'run-state.json'), {
    recoveryRoute: {
      route: decision.route,
      planLevelConfirmed: decision.planLevelConfirmed,
      source: decision.source,
      routeRisks: decision.routeRisks,
    },
  });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function overlayId(index: number): string {
  return `overlay-${String(index + 1).padStart(4, '0')}`;
}

function targetSource(target: PdfRecoveryTarget): PdfRecoveryOverlayProvenance['source'] {
  return {
    kind: target.kind,
    ...(target.page === undefined ? {} : { page: target.page }),
    ...(target.blockId === undefined ? {} : { blockId: target.blockId }),
  };
}

export async function executePdfRecoveryPlan(
  artifactDir: string,
  plan: Pick<PdfRecoveryPlan, 'targets' | 'routeRisks'>,
  decision: Extract<PdfRecoveryRouteDecision, { status: 'selected' }>,
  capability: PdfRecoveryCapability,
): Promise<{
  overlays: PdfRecoveryOverlay[];
  diagnostics: PdfParseDiagnostic[];
}> {
  if (capability.route !== decision.route) {
    throw new Error(`Recovery capability route ${capability.route} does not match selected route ${decision.route}.`);
  }
  if (plan.routeRisks.length > 0 && !decision.planLevelConfirmed) {
    throw new Error('PDF recovery plan requires plan-level confirmation before execution.');
  }

  const diagnosticsPath = path.join(artifactDir, 'diagnostics.json');
  const provenancePath = path.join(artifactDir, 'provenance.json');
  const diagnostics = readJsonFile<PdfParseDiagnostic[]>(diagnosticsPath, []);
  const overlays: PdfRecoveryOverlay[] = [];

  for (const target of plan.targets) {
    const result = await capability.recover(target);
    const diagnosticCode = target.reasons[0];
    if (result.ok) {
      overlays.push({
        id: overlayId(overlays.length),
        target,
        markdown: result.markdown,
        provenance: {
          recoveryCapability: capability.label,
          route: decision.route,
          source: targetSource(target),
          diagnosticCode,
          meteredNetworkApproved: decision.planLevelConfirmed,
        },
      });
      continue;
    }

    diagnostics.push({
      severity: 'warning',
      code: 'RECOVERY_FAILED',
      message: `PDF recovery failed for ${target.kind}: ${result.message}`,
      ...(target.page === undefined ? {} : { page: target.page }),
    });
  }

  const provenance = readJsonFile<{ baseline?: unknown; recovery?: PdfRecoveryOverlayProvenance[] }>(
    provenancePath,
    { recovery: [] },
  );
  writeJson(path.join(artifactDir, 'overlays.json'), overlays);
  writeJson(diagnosticsPath, diagnostics);
  writeJson(provenancePath, {
    ...provenance,
    recovery: overlays.map((overlay) => overlay.provenance),
  });

  return {
    overlays,
    diagnostics,
  };
}

function findBlockTextRange(
  baseline: StructuredPaperParse,
  blockId: string,
): { start: number; end: number } | null {
  let searchFrom = 0;
  for (const block of baseline.blocks) {
    if (
      block.id === blockId
      && Number.isInteger(block.location.textStart)
      && Number.isInteger(block.location.textEnd)
      && (block.location.textStart as number) >= 0
      && (block.location.textEnd as number) > (block.location.textStart as number)
      && (block.location.textEnd as number) <= baseline.markdown.length
    ) {
      return {
        start: block.location.textStart as number,
        end: block.location.textEnd as number,
      };
    }
    const start = baseline.markdown.indexOf(block.text, searchFrom);
    if (start === -1) continue;
    const end = start + block.text.length;
    if (block.id === blockId) return { start, end };
    searchFrom = end;
  }
  return null;
}

function applyRecoveryOverlays(
  baseline: StructuredPaperParse,
  overlays: PdfRecoveryOverlay[],
): string {
  const replacements: Array<{ start: number; end: number; markdown: string }> = [];
  const appendOnly: PdfRecoveryOverlay[] = [];
  for (const overlay of overlays) {
    if (overlay.target.blockId) {
      const range = findBlockTextRange(baseline, overlay.target.blockId);
      if (range) {
        replacements.push({ ...range, markdown: overlay.markdown });
        continue;
      }
    }
    appendOnly.push(overlay);
  }

  let markdown = baseline.markdown;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    markdown = `${markdown.slice(0, replacement.start)}${replacement.markdown}${markdown.slice(replacement.end)}`;
  }
  for (const overlay of appendOnly) {
    markdown = `${markdown.trimEnd()}\n\n${overlay.markdown}\n`;
  }
  return markdown;
}

function recoveredSummary(
  artifactDir: string,
  diagnostics: PdfParseDiagnostic[],
): string {
  return [
    `PDF best recovered PDF parse: ${artifactDir}`,
    `Diagnostics: ${summarizeDiagnostics(diagnostics)}`,
    'Recovered view: recovered-view.md',
  ].join('\n');
}

export function finalizeRecoveredPaperParseView(
  artifactDir: string,
  baseline: StructuredPaperParse,
  overlays: PdfRecoveryOverlay[],
  diagnostics: PdfParseDiagnostic[],
  options: {
    comparisonTraceEnabled?: boolean;
  } = {},
): {
  recoveredMarkdown: string;
  conversationSummary: string;
} {
  const recoveredMarkdown = applyRecoveryOverlays(baseline, overlays);
  copyBaselineImageAssets(artifactDir, baseline);
  fs.writeFileSync(path.join(artifactDir, 'recovered-view.md'), recoveredMarkdown, 'utf-8');
  writeJson(path.join(artifactDir, 'overlays.json'), overlays);
  writeJson(path.join(artifactDir, 'diagnostics.json'), diagnostics);

  if (options.comparisonTraceEnabled) {
    writeJson(path.join(artifactDir, 'comparison-trace.json'), {
      baselineLength: baseline.markdown.length,
      recoveredLength: recoveredMarkdown.length,
      overlayCount: overlays.length,
      diagnosticCount: diagnostics.length,
    });
  }

  return {
    recoveredMarkdown,
    conversationSummary: recoveredSummary(artifactDir, diagnostics),
  };
}

export function shouldRerunMarkerBaseline(
  artifactDir: string,
  options: {
    sourcePath: string;
    sourceSha256?: string;
    explicitFullReparse?: boolean;
  },
): boolean {
  if (options.explicitFullReparse) return true;
  const baselinePath = path.join(artifactDir, 'baseline.json');
  const metadataPath = path.join(artifactDir, 'metadata.json');
  if (!fs.existsSync(baselinePath) || !fs.existsSync(metadataPath)) return true;

  let metadata: { source?: { path?: string; sha256?: string } };
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as { source?: { path?: string; sha256?: string } };
    JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  } catch {
    return true;
  }

  if (metadata.source?.path && metadata.source.path !== options.sourcePath) return true;
  const sourceSha256 = options.sourceSha256 ?? (fs.existsSync(options.sourcePath) ? hashFile(options.sourcePath) : undefined);
  if (!sourceSha256 || metadata.source?.sha256 !== sourceSha256) return true;
  return false;
}

function readJsonFileOrUndefined<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

function artifactCreatedAtSortValue(artifactId: string, createdAt?: string): number {
  if (createdAt) {
    const parsed = Date.parse(createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  const idTimestamp = artifactId.match(/^(\d{4}-\d{2}-\d{2}T\d{6}Z)/)?.[1];
  if (!idTimestamp) return 0;
  const normalized = idTimestamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    '$1T$2:$3:$4Z',
  );
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface PdfParseArtifactMetadata {
  artifactId?: string;
  createdAt?: string;
  source?: Partial<PdfParseSourceMetadata>;
}

interface PdfParseArtifactCandidate {
  artifactDir: string;
  artifactId: string;
  createdAt?: string;
  source: PdfParseSourceMetadata;
  diagnostics: PdfParseDiagnostic[];
  sortValue: number;
}

function listPdfParseArtifactCandidates(projectPath: string): PdfParseArtifactCandidate[] {
  const artifactsRoot = path.join(projectPath, '.cdf', 'pdf-parses');
  if (!fs.existsSync(artifactsRoot)) return [];

  const candidates: PdfParseArtifactCandidate[] = [];
  for (const entry of fs.readdirSync(artifactsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const artifactDir = path.join(artifactsRoot, entry.name);
    const metadata = readJsonFileOrUndefined<PdfParseArtifactMetadata>(path.join(artifactDir, 'metadata.json'));
    const source = metadata?.source;
    if (!source?.path || !source.sha256 || typeof source.fileSize !== 'number') continue;
    const artifactId = metadata.artifactId ?? entry.name;
    candidates.push({
      artifactDir,
      artifactId,
      createdAt: metadata.createdAt,
      source: {
        path: source.path,
        fileSize: source.fileSize,
        sha256: source.sha256,
      },
      diagnostics: readJsonFileOrUndefined<PdfParseDiagnostic[]>(path.join(artifactDir, 'diagnostics.json')) ?? [],
      sortValue: artifactCreatedAtSortValue(artifactId, metadata.createdAt),
    });
  }
  return candidates.sort((left, right) => right.sortValue - left.sortValue || right.artifactId.localeCompare(left.artifactId));
}

function isReusablePdfParseArtifact(candidate: PdfParseArtifactCandidate): boolean {
  return fs.existsSync(path.join(candidate.artifactDir, 'baseline.json'))
    && fs.existsSync(path.join(candidate.artifactDir, 'recovered-view.md'));
}

export function findReusablePdfParseArtifact(
  projectPath: string,
  filePath: string,
): PdfParseArtifactLookupResult {
  const currentSource = sourceMetadata(filePath);
  const candidates = listPdfParseArtifactCandidates(projectPath);
  const reusable = candidates.find((candidate) => (
    candidate.source.sha256 === currentSource.sha256 && isReusablePdfParseArtifact(candidate)
  ));

  if (reusable) {
    const recoveredViewPath = path.join(reusable.artifactDir, 'recovered-view.md');
    return {
      status: 'reusable-artifact',
      artifactDir: reusable.artifactDir,
      artifactId: reusable.artifactId,
      createdAt: reusable.createdAt,
      source: currentSource,
      recoveredViewPath,
      baselinePath: path.join(reusable.artifactDir, 'baseline.json'),
      diagnostics: reusable.diagnostics,
      conversationSummary: [
        `Found reusable PDF parse artifact: ${reusable.artifactDir}`,
        `Recovered view: ${recoveredViewPath}`,
        `Diagnostics: ${summarizeDiagnostics(reusable.diagnostics)}`,
      ].join('\n'),
      nextActions: [
        {
          kind: 'read-recovered-view',
          path: recoveredViewPath,
          description: 'Read recovered-view.md from this artifact instead of rerunning Marker.',
        },
      ],
    };
  }

  const stale = candidates.find((candidate) => (
    candidate.source.path === filePath && candidate.source.sha256 !== currentSource.sha256
  ));
  if (stale) {
    return {
      status: 'stale-artifact',
      artifactDir: stale.artifactDir,
      artifactId: stale.artifactId,
      createdAt: stale.createdAt,
      source: stale.source,
      currentSource,
      diagnostics: stale.diagnostics,
      conversationSummary: [
        `Found stale PDF parse artifact: ${stale.artifactDir}`,
        'The current source PDF SHA-256 does not match artifact metadata; rerun baseline parsing.',
      ].join('\n'),
      nextActions: [
        {
          kind: 'rerun-baseline-parse',
          description: 'Run scripts/baseline-parse.js for the current PDF before reading full text.',
        },
      ],
    };
  }

  return {
    status: 'not-parsed',
    source: currentSource,
    diagnostics: [],
    conversationSummary: 'No PDF parse artifact found for this source PDF; run baseline parsing before full-text reading.',
    nextActions: [
      {
        kind: 'run-baseline-parse',
        description: 'Run scripts/baseline-parse.js to create a PDF Parse Artifact.',
      },
    ],
  };
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sourceMetadata(filePath: string): PdfParseSourceMetadata {
  return {
    path: filePath,
    fileSize: fs.statSync(filePath).size,
    sha256: hashFile(filePath),
  };
}

function formatArtifactTimestamp(date: Date): string {
  return date.toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '');
}

function ensureProjectPdfParseGitignore(projectPath: string): void {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const entry = '.cdf/pdf-parses/';
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';
  if (existing.split(/\r?\n/).includes(entry)) return;
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(gitignorePath, `${existing}${prefix}${entry}\n`, 'utf-8');
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function markdownImageReferences(markdown: string): string[] {
  return Array.from(markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g), (match) => match[1]);
}

function normalizeArtifactImagePath(reference: string): string | null {
  const trimmed = reference.trim().split(/[?#]/, 1)[0];
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || path.isAbsolute(trimmed)) return null;
  const normalized = path.normalize(trimmed);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) return null;
  return normalized;
}

function copyBaselineImageAssets(artifactDir: string, parse: StructuredPaperParse): void {
  const imageSources = new Map<string, string>();
  for (const block of parse.blocks) {
    const imagePath = block.location.imagePath;
    if (imagePath) {
      imageSources.set(path.basename(imagePath), imagePath);
    }
  }

  for (const reference of markdownImageReferences(parse.markdown)) {
    const artifactRelativePath = normalizeArtifactImagePath(reference);
    if (!artifactRelativePath) continue;
    const sourcePath = imageSources.get(path.basename(artifactRelativePath));
    if (!sourcePath || !fs.existsSync(sourcePath)) continue;
    const destinationPath = path.join(artifactDir, artifactRelativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function summarizeDiagnostics(diagnostics: PdfParseDiagnostic[]): string {
  if (diagnostics.length === 0) return 'No diagnostics.';
  return diagnostics.map((diagnostic) => diagnostic.code).join(', ');
}

function summarizeArtifact(artifactDir: string, diagnostics: PdfParseDiagnostic[]): string {
  return [
    `PDF parse artifact: ${artifactDir}`,
    `Diagnostics: ${summarizeDiagnostics(diagnostics)}`,
    'Recovered view: recovered-view.md',
  ].join('\n');
}

function artifactIdFor(createdAt: Date, source: PdfParseSourceMetadata): string {
  return `${formatArtifactTimestamp(createdAt)}-${source.sha256.slice(0, 8)}`;
}

function baselineOcrProvenance(diagnostics: PdfParseDiagnostic[]): { ocr?: { disabled: true; reason: 'text-layer-preflight' } } {
  return diagnostics.some((diagnostic) => diagnostic.code === 'TEXT_LAYER_OCR_DISABLED')
    ? { ocr: { disabled: true, reason: 'text-layer-preflight' } }
    : {};
}

function baselineFallbackProvenance(diagnostics: PdfParseDiagnostic[]): { fallback?: { engine: 'pymupdf-text-layer'; reason: 'marker-failure-text-layer' } } {
  return diagnostics.some((diagnostic) => diagnostic.code === 'TEXT_LAYER_FALLBACK_USED')
    ? { fallback: { engine: 'pymupdf-text-layer', reason: 'marker-failure-text-layer' } }
    : {};
}

function writeBaselineArtifact(
  projectPath: string,
  source: PdfParseSourceMetadata,
  parse: StructuredPaperParse,
  diagnostics: PdfParseDiagnostic[],
  createdAt: Date,
  jobId: string,
): string {
  const artifactId = artifactIdFor(createdAt, source);
  const artifactDir = path.join(projectPath, '.cdf', 'pdf-parses', artifactId);
  fs.mkdirSync(artifactDir, { recursive: true });

  const baselineProvenance = {
    parser: parse.parser,
    jobId,
    ...baselineOcrProvenance(diagnostics),
    ...baselineFallbackProvenance(diagnostics),
  };

  writeJson(path.join(artifactDir, 'metadata.json'), {
    artifactVersion: 1,
    artifactId,
    createdAt: createdAt.toISOString(),
    source,
    baseline: baselineProvenance,
  });
  writeJson(path.join(artifactDir, 'baseline.json'), parse);
  copyBaselineImageAssets(artifactDir, parse);
  fs.writeFileSync(path.join(artifactDir, 'recovered-view.md'), parse.markdown, 'utf-8');
  writeJson(path.join(artifactDir, 'diagnostics.json'), diagnostics);
  writeJson(path.join(artifactDir, 'overlays.json'), []);
  writeJson(path.join(artifactDir, 'recovery-plan.json'), generatePdfRecoveryPlan({
    artifactId,
    baseline: parse,
  }));
  writeJson(path.join(artifactDir, 'provenance.json'), {
    baseline: baselineProvenance,
    recovery: [],
  });
  return artifactDir;
}

function writeDiagnosticArtifact(
  projectPath: string,
  source: PdfParseSourceMetadata,
  diagnostics: PdfParseDiagnostic[],
  createdAt: Date,
  jobId: string,
  status: 'failed' | 'canceled',
  error?: string,
): string {
  const artifactId = artifactIdFor(createdAt, source);
  const artifactDir = path.join(projectPath, '.cdf', 'pdf-parses', artifactId);
  fs.mkdirSync(artifactDir, { recursive: true });

  writeJson(path.join(artifactDir, 'metadata.json'), {
    artifactVersion: 1,
    artifactId,
    createdAt: createdAt.toISOString(),
    source,
    baseline: {
      parser: 'marker',
      jobId,
      status,
      ...baselineOcrProvenance(diagnostics),
      ...(error ? { error } : {}),
    },
  });
  fs.writeFileSync(path.join(artifactDir, 'recovered-view.md'), '', 'utf-8');
  writeJson(path.join(artifactDir, 'diagnostics.json'), diagnostics);
  writeJson(path.join(artifactDir, 'overlays.json'), []);
  writeJson(path.join(artifactDir, 'recovery-plan.json'), planFromDiagnostics(artifactId, diagnostics, []));
  writeJson(path.join(artifactDir, 'provenance.json'), {
    baseline: {
      parser: 'marker',
      jobId,
      status,
      ...baselineOcrProvenance(diagnostics),
    },
    recovery: [],
  });
  return artifactDir;
}

export function materializePdfParseJobArtifact(
  projectPath: string,
  job: PdfParseJobSnapshot,
): ParsePdfWithSkillCompletedResult | ParsePdfWithSkillArtifactResult | null {
  if (job.status === 'running') return null;
  const source = sourceMetadata(job.sourceFile);
  ensureProjectPdfParseGitignore(projectPath);
  if (job.status === 'completed' && job.parse) {
    const artifactDir = writeBaselineArtifact(
      projectPath,
      source,
      job.parse,
      job.diagnostics,
      new Date(job.createdAt),
      job.jobId,
    );
    return {
      status: 'completed',
      artifactDir,
      source,
      diagnostics: job.diagnostics,
      conversationSummary: summarizeArtifact(artifactDir, job.diagnostics),
    };
  }

  if (job.status === 'failed' || job.status === 'canceled') {
    const artifactDir = writeDiagnosticArtifact(
      projectPath,
      source,
      job.diagnostics,
      new Date(job.createdAt),
      job.jobId,
      job.status,
      job.error,
    );
    return {
      status: job.status,
      jobId: job.jobId,
      artifactDir,
      source,
      diagnostics: job.diagnostics,
      error: job.error,
      conversationSummary: summarizeArtifact(artifactDir, job.diagnostics),
    };
  }

  return null;
}

export async function parsePdfWithSkill(
  projectPath: string,
  filePath: string,
  dependencies: ParsePdfWithSkillDependencies = {},
): Promise<ParsePdfWithSkillResult> {
  const createdAt = dependencies.now?.() ?? new Date();
  let nowCalls = 0;
  const result = await parsePDF(filePath, {
    ...dependencies.parseOptions,
    timeoutMs: dependencies.parseOptions?.timeoutMs ?? 12000,
  }, {
    runner: dependencies.runner,
    now: () => {
      nowCalls += 1;
      return nowCalls === 1 ? createdAt.getTime() : Date.now();
    },
    createJobId: dependencies.createJobId,
  });

  if (result.status === 'running') {
    return {
      status: result.status,
      jobId: result.jobId,
      diagnostics: result.diagnostics,
      error: result.status === 'failed' || result.status === 'canceled' ? result.error : undefined,
      conversationSummary: [
        `PDF parse status: ${result.status}`,
        `Job: ${result.jobId}`,
        `Diagnostics: ${summarizeDiagnostics(result.diagnostics)}`,
      ].join('\n'),
    };
  }

  const source = sourceMetadata(filePath);
  ensureProjectPdfParseGitignore(projectPath);
  if (result.status === 'failed' || result.status === 'canceled') {
    const artifactDir = writeDiagnosticArtifact(
      projectPath,
      source,
      result.diagnostics,
      createdAt,
      result.jobId,
      result.status,
      result.error,
    );
    return {
      status: result.status,
      jobId: result.jobId,
      artifactDir,
      source,
      diagnostics: result.diagnostics,
      error: result.error,
      conversationSummary: summarizeArtifact(artifactDir, result.diagnostics),
    };
  }

  const artifactDir = writeBaselineArtifact(
    projectPath,
    source,
    result.parse,
    result.diagnostics,
    createdAt,
    result.jobId,
  );

  return {
    status: 'completed',
    artifactDir,
    source,
    diagnostics: result.diagnostics,
    conversationSummary: summarizeArtifact(artifactDir, result.diagnostics),
  };
}
