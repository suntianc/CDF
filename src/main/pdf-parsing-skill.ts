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

export type PdfRecoveryPreferenceResolution =
  | { action: 'reuse'; preference: PdfRecoveryPreference }
  | { action: 'ask'; reason: 'missing-preference' | 'unavailable-preference' | 'ask-each-time' | 'new-cost-or-privacy-risk' };

export type PdfRecoveryRouteDecision =
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
  | { ok: true; markdown: string }
  | { ok: false; message: string };

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
    'Ask for route choice or plan-level confirmation only when meaningful capability, privacy, network, upload, or cost trade-offs exist.',
  ].join('\n');
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
  if (!plan.candidateRoutes.includes(preference.route)) {
    return { action: 'ask', reason: 'unavailable-preference' };
  }
  if (plan.introducesNewRisk) return { action: 'ask', reason: 'new-cost-or-privacy-risk' };
  return { action: 'reuse', preference };
}

function isPdfRecoveryTriggerCode(code: PdfParseDiagnosticCode): code is PdfRecoveryTriggerCode {
  return (PDF_RECOVERY_TRIGGER_CODES as string[]).includes(code);
}

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

function addRoute(routes: Set<PdfRecoveryRoute>, route: PdfRecoveryRoute): void {
  routes.add(route);
}

function orderedRoutes(routes: Set<PdfRecoveryRoute>): PdfRecoveryRoute[] {
  return PDF_RECOVERY_ROUTES.filter((route) => route !== 'ask-each-time' && routes.has(route));
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
): PdfRecoveryRouteOption {
  const processingScope = `${targetCount} recovery target${targetCount === 1 ? '' : 's'}`;
  switch (route) {
    case 'local-first':
      return {
        route,
        capabilitySource: 'local recovery capability',
        problemFit: 'Best for weak source grounding, reruns, and low-risk local repair.',
        privacyNetworkBehavior: 'Runs locally when a local capability is available.',
        possibleCost: 'No metered provider cost expected.',
        processingScope,
        qualityExpectation: 'Conservative quality; useful for metadata and source-location repair.',
      };
    case 'vision-capability':
      return {
        route,
        capabilitySource: 'vision-capable recovery capability',
        problemFit: 'Best for scanned pages, figures, tables, and OCR artifacts.',
        privacyNetworkBehavior: routeRisks.includes('network')
          ? 'May use network access and page or text upload.'
          : 'Uses the selected vision-capable route without new network risk.',
        possibleCost: routeRisks.includes('metered-provider')
          ? 'May use metered provider capacity.'
          : 'No new metered provider cost indicated.',
        processingScope,
        qualityExpectation: 'Higher quality for visual layout and table recovery.',
      };
    case 'multimodal-agent':
      return {
        route,
        capabilitySource: 'multimodal Agent capability category',
        problemFit: 'Best for mixed text, layout, formulas, and figure-heavy evidence.',
        privacyNetworkBehavior: routeRisks.includes('network')
          ? 'May use network access and page or text upload.'
          : 'Uses the selected multimodal route without new network risk.',
        possibleCost: routeRisks.includes('metered-provider')
          ? 'May use metered provider capacity.'
          : 'No new metered provider cost indicated.',
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

export function summarizePdfRecoveryRoutes(plan: Pick<PdfRecoveryPlan, 'targets' | 'candidateRoutes' | 'routeRisks'>): PdfRecoveryRouteOption[] {
  return plan.candidateRoutes.map((route) => routeOption(route, plan.targets.length, plan.routeRisks));
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
  } = {},
): PdfRecoveryRouteDecision {
  const routeOptions = summarizePdfRecoveryRoutes(plan);
  const selectedRoute = getSelectedRoute(options);
  if (selectedRoute) {
    if (!plan.candidateRoutes.includes(selectedRoute)) {
      return {
        status: 'needs-route-choice',
        reason: 'unavailable-preference',
        options: routeOptions,
        requiresPlanConfirmation: plan.requiresPlanConfirmation,
      };
    }
    if (plan.requiresPlanConfirmation && !options.planLevelConfirmed) {
      return {
        status: 'needs-plan-confirmation',
        route: selectedRoute,
        routeRisks: [...plan.routeRisks],
        options: routeOptions,
      };
    }
    return {
      status: 'selected',
      route: selectedRoute,
      planLevelConfirmed: !plan.requiresPlanConfirmation || options.planLevelConfirmed === true,
      source: 'user',
      routeRisks: [...plan.routeRisks],
    };
  }

  const preferenceResolution = resolvePdfRecoveryPreferenceForPlan(projectPath, {
    candidateRoutes: [...plan.candidateRoutes],
    introducesNewRisk: options.introducesNewRisk ?? plan.routeRisks.length > 0,
  });
  if (preferenceResolution.action === 'reuse') {
    if (plan.requiresPlanConfirmation) {
      return {
        status: 'needs-plan-confirmation',
        route: preferenceResolution.preference.route,
        routeRisks: [...plan.routeRisks],
        options: routeOptions,
      };
    }
    return {
      status: 'selected',
      route: preferenceResolution.preference.route,
      planLevelConfirmed: !plan.requiresPlanConfirmation,
      source: 'preference',
      routeRisks: [...plan.routeRisks],
    };
  }

  return {
    status: 'needs-route-choice',
    reason: preferenceResolution.reason === 'missing-preference' && plan.candidateRoutes.length > 1
      ? 'meaningful-trade-offs'
      : preferenceResolution.reason,
    options: routeOptions,
    requiresPlanConfirmation: plan.requiresPlanConfirmation,
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

function applyRecoveryOverlays(
  baseline: StructuredPaperParse,
  overlays: PdfRecoveryOverlay[],
): string {
  let markdown = baseline.markdown;
  for (const overlay of overlays) {
    if (overlay.target.blockId) {
      const block = baseline.blocks.find((candidate) => candidate.id === overlay.target.blockId);
      if (block && markdown.includes(block.text)) {
        markdown = markdown.replace(block.text, overlay.markdown);
        continue;
      }
    }
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
  };

  writeJson(path.join(artifactDir, 'metadata.json'), {
    artifactVersion: 1,
    artifactId,
    createdAt: createdAt.toISOString(),
    source,
    baseline: baselineProvenance,
  });
  writeJson(path.join(artifactDir, 'baseline.json'), parse);
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
  const result = await parsePDF(filePath, {
    ...dependencies.parseOptions,
    timeoutMs: dependencies.parseOptions?.timeoutMs ?? 12000,
  }, {
    runner: dependencies.runner,
    now: () => createdAt.getTime(),
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
