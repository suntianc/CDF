import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  configuredMarkerCommand,
  type PdfParseDiagnostic,
  type StructuredPaperParse,
} from './pdf-parse';
import {
  clearPdfRecoveryPreference,
  discoverPdfRecoveryCapabilities,
  executePdfRecoveryPlan,
  finalizeRecoveredPaperParseView,
  findReusablePdfParseArtifact,
  generatePdfRecoveryPlan,
  parsePdfWithSkill,
  recordPdfRecoveryRouteSelection,
  updatePdfRecoveryPreference,
  type PdfRecoveryCapability,
  type PdfRecoveryCapabilityResult,
  type PdfRecoveryAgentJudgedRoute,
  type PdfRecoveryDiscoveryInput,
  type PdfRecoveryPlan,
  type PdfRecoveryRoute,
  type PdfRecoveryRouteDecision,
  type PdfRecoveryTarget,
} from './pdf-parsing-skill';

type ParsedArgs = Record<string, string | true>;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function stringArg(args: ParsedArgs, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' ? value : undefined;
}

function requiredStringArg(args: ParsedArgs, name: string): string {
  const value = stringArg(args, name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function booleanArg(args: ParsedArgs, name: string): boolean {
  const value = args[name];
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isPdfRecoveryRoute(value: string): value is PdfRecoveryRoute {
  return ['local-first', 'vision-capability', 'multimodal-agent', 'ask-each-time'].includes(value);
}

function markerNextActions(): Array<{ kind: 'prepare-marker'; script: string; command: string; description: string }> {
  const skillDir = process.env.CDF_PDF_SKILL_DIR;
  const script = skillDir
    ? path.join(skillDir, 'scripts', 'ensure-marker.js')
    : path.join(process.cwd(), 'scripts', 'ensure-marker.js');
  return [
    {
      kind: 'prepare-marker',
      script,
      command: `${process.execPath} ${JSON.stringify(script)} --mode prepare`,
      description: 'Prepare the local Marker CLI dependency, then rerun baseline-parse.js.',
    },
  ];
}

function markerDiscoveryTimeoutMs(): number {
  const parsed = Number(process.env.CDF_MARKER_DISCOVERY_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

function probeConfiguredMarker(): PdfRecoveryDiscoveryInput['localMarker'] {
  const configured = configuredMarkerCommand();
  const result = spawnSync(configured.command, [...configured.args, '--help'], {
    encoding: 'utf-8',
    timeout: markerDiscoveryTimeoutMs(),
    windowsHide: true,
  });
  return {
    available: !result.error && result.status === 0,
    commandSource: process.env.CDF_MARKER_COMMAND?.trim() ? 'CDF_MARKER_COMMAND' : 'default-uvx',
  };
}

interface ParsedAgentViableRoutes {
  routes: PdfRecoveryAgentJudgedRoute[];
  diagnostics: PdfParseDiagnostic[];
}

function parseAgentViableRoutes(value: string | undefined): ParsedAgentViableRoutes {
  if (!value?.trim()) {
    return {
      routes: [],
      diagnostics: [
        {
          severity: 'info',
          code: 'PDF_RECOVERY_AGENT_ROUTES_NOT_REPORTED',
          message: 'The Agent did not report vision-capability or multimodal-agent viability; discovery only used local Marker probing.',
        },
      ],
    };
  }
  const routes: PdfRecoveryAgentJudgedRoute[] = [];
  const diagnostics: PdfParseDiagnostic[] = [];
  for (const rawRoute of value.split(',')) {
    const route = rawRoute.trim();
    if (!route) continue;
    if (route === 'vision-capability' || route === 'multimodal-agent') {
      routes.push(route);
      continue;
    }
    if (route === 'local-first') {
      diagnostics.push({
        severity: 'info',
        code: 'PDF_RECOVERY_AGENT_ROUTES_INVALID',
        message: 'Ignoring Agent-reported local-first viability; local-first is determined only by local Marker probing.',
      });
      continue;
    }
    diagnostics.push({
      severity: 'warning',
      code: 'PDF_RECOVERY_AGENT_ROUTES_INVALID',
      message: `Ignoring unsupported Agent-reported PDF recovery route: ${route}.`,
    });
  }
  return { routes, diagnostics };
}

function discoverCapabilities(args: ParsedArgs): void {
  const agentViableRoutes = parseAgentViableRoutes(stringArg(args, 'viable-routes'));
  const discovery = discoverPdfRecoveryCapabilities({
    localMarker: probeConfiguredMarker(),
    agentViableRoutes: agentViableRoutes.routes,
    diagnostics: agentViableRoutes.diagnostics,
  });
  output({
    status: discovery.capabilities.length > 0 ? 'completed' : 'no-viable-capability',
    ...discovery,
  });
}

async function baselineParse(args: ParsedArgs): Promise<void> {
  const projectPath = requiredStringArg(args, 'project');
  const filePath = requiredStringArg(args, 'file');
  const createdAt = process.env.CDF_PDF_PARSE_NOW
    ? new Date(process.env.CDF_PDF_PARSE_NOW)
    : undefined;
  const result = await parsePdfWithSkill(projectPath, filePath, {
    now: createdAt ? () => createdAt : undefined,
    createJobId: process.env.CDF_PDF_PARSE_JOB_ID ? () => process.env.CDF_PDF_PARSE_JOB_ID as string : undefined,
    parseOptions: {
      pageRange: stringArg(args, 'page-range'),
      timeoutMs: 0,
    },
  });
  output({
    ...result,
    ...(result.diagnostics.some((diagnostic) => diagnostic.code === 'MARKER_UNAVAILABLE')
      ? { nextActions: markerNextActions() }
      : {}),
  });
}

function findArtifact(args: ParsedArgs): void {
  const projectPath = requiredStringArg(args, 'project');
  const filePath = requiredStringArg(args, 'file');
  output(findReusablePdfParseArtifact(projectPath, filePath));
}

function refreshRecoveryPlan(args: ParsedArgs): void {
  const artifactDir = requiredStringArg(args, 'artifact');
  const metadata = readJson<{ artifactId?: string }>(path.join(artifactDir, 'metadata.json'));
  const baseline = readJson<StructuredPaperParse>(path.join(artifactDir, 'baseline.json'));
  const artifactId = metadata.artifactId ?? path.basename(artifactDir);
  const plan = generatePdfRecoveryPlan({ artifactId, baseline });
  writeJson(path.join(artifactDir, 'recovery-plan.json'), plan);
  output({ status: 'completed', artifactDir, plan });
}

function setPreference(args: ParsedArgs): void {
  const projectPath = requiredStringArg(args, 'project');
  const route = requiredStringArg(args, 'route');
  if (!isPdfRecoveryRoute(route)) {
    throw new Error('PDF Recovery Preference stores route categories only, not provider/model/MCP/CLI identifiers.');
  }
  updatePdfRecoveryPreference(projectPath, {
    route,
    askAgainWhen: 'new-cost-or-privacy-risk',
  });
  output({ status: 'completed', projectPath, preference: { route, askAgainWhen: 'new-cost-or-privacy-risk' } });
}

function clearPreference(args: ParsedArgs): void {
  const projectPath = requiredStringArg(args, 'project');
  clearPdfRecoveryPreference(projectPath);
  output({ status: 'completed', projectPath, preference: null });
}

function recoveryResultsFor(args: ParsedArgs): PdfRecoveryCapabilityResult[] {
  const resultsFile = requiredStringArg(args, 'results-file');
  const parsed = readJson<PdfRecoveryCapabilityResult[]>(resultsFile);
  if (!Array.isArray(parsed)) throw new Error('--results-file must contain a JSON array.');
  return parsed;
}

function recoveryTargetKey(target: Pick<PdfRecoveryTarget, 'kind' | 'page' | 'blockId'>): string {
  return [
    target.kind,
    target.page ?? '',
    target.blockId ?? '',
  ].join(':');
}

async function applyRecovery(args: ParsedArgs): Promise<void> {
  const artifactDir = requiredStringArg(args, 'artifact');
  const route = requiredStringArg(args, 'route');
  if (!isPdfRecoveryRoute(route)) throw new Error(`Unsupported PDF recovery route: ${route}`);

  const plan = readJson<PdfRecoveryPlan>(path.join(artifactDir, 'recovery-plan.json'));
  const results = recoveryResultsFor(args);
  const targetResults = new Map<string, PdfRecoveryCapabilityResult[]>();
  const positionalResults: PdfRecoveryCapabilityResult[] = [];
  for (const result of results) {
    if (result.target?.kind) {
      const key = recoveryTargetKey(result.target);
      targetResults.set(key, [...targetResults.get(key) ?? [], result]);
    } else {
      positionalResults.push(result);
    }
  }
  let positionalResultIndex = 0;
  const decision: Extract<PdfRecoveryRouteDecision, { status: 'selected' }> = {
    status: 'selected',
    route,
    planLevelConfirmed: booleanArg(args, 'plan-confirmed'),
    source: 'user',
    routeRisks: [...plan.routeRisks],
  };
  const capability: PdfRecoveryCapability = {
    route,
    label: stringArg(args, 'capability-label') ?? 'script-provided recovery results',
    recover: async (target) => {
      const key = recoveryTargetKey(target);
      const matchedResults = targetResults.get(key);
      if (matchedResults?.length) {
        const result = matchedResults.shift() as PdfRecoveryCapabilityResult;
        if (matchedResults.length === 0) targetResults.delete(key);
        return result;
      }
      const positionalResult = positionalResults[positionalResultIndex];
      positionalResultIndex += 1;
      if (!positionalResult) return { ok: false, message: 'No recovery result was provided for this target.' };
      return positionalResult;
    },
  };

  recordPdfRecoveryRouteSelection(artifactDir, decision);
  const result = await executePdfRecoveryPlan(artifactDir, plan, decision, capability);
  const unusedResultCount = Array.from(targetResults.values()).reduce((count, values) => count + values.length, 0)
    + Math.max(0, positionalResults.length - positionalResultIndex);
  if (unusedResultCount > 0) {
    result.diagnostics.push({
      severity: 'warning',
      code: 'RECOVERY_FAILED',
      message: `Ignored ${unusedResultCount} recovery result(s) that did not match any recovery target.`,
    });
    writeJson(path.join(artifactDir, 'diagnostics.json'), result.diagnostics);
  }
  output({ status: 'completed', artifactDir, overlays: result.overlays, diagnostics: result.diagnostics });
}

function finalizeView(args: ParsedArgs): void {
  const artifactDir = requiredStringArg(args, 'artifact');
  const baseline = readJson<StructuredPaperParse>(path.join(artifactDir, 'baseline.json'));
  const overlays = readJson<Parameters<typeof finalizeRecoveredPaperParseView>[2]>(path.join(artifactDir, 'overlays.json'));
  const diagnostics = fs.existsSync(path.join(artifactDir, 'diagnostics.json'))
    ? readJson<PdfParseDiagnostic[]>(path.join(artifactDir, 'diagnostics.json'))
    : [];
  const result = finalizeRecoveredPaperParseView(artifactDir, baseline, overlays, diagnostics, {
    comparisonTraceEnabled: booleanArg(args, 'comparison-trace'),
  });
  output({ status: 'completed', artifactDir, ...result });
}

async function main(): Promise<void> {
  const [operation, ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);
  switch (operation) {
    case 'findArtifact':
      findArtifact(args);
      return;
    case 'baselineParse':
      await baselineParse(args);
      return;
    case 'discoverCapabilities':
      discoverCapabilities(args);
      return;
    case 'refreshRecoveryPlan':
      refreshRecoveryPlan(args);
      return;
    case 'setPreference':
      setPreference(args);
      return;
    case 'clearPreference':
      clearPreference(args);
      return;
    case 'applyRecovery':
      await applyRecovery(args);
      return;
    case 'finalizeView':
      finalizeView(args);
      return;
    default:
      throw new Error(`Unknown PDF Parsing Skill operation: ${operation || '<missing>'}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  output({
    status: 'failed',
    error: message,
  });
  process.exitCode = 1;
});
