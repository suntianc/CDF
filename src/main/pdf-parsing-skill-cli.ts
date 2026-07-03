import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  clearPdfRecoveryPreference,
  discoverPdfRecoveryCapabilities,
  executePdfRecoveryPlan,
  finalizeRecoveredPaperParseView,
  generatePdfRecoveryPlan,
  parsePdfWithSkill,
  recordPdfRecoveryRouteSelection,
  updatePdfRecoveryPreference,
  type PdfRecoveryCapability,
  type PdfRecoveryCapabilityResult,
  type PdfRecoveryDiscoveryInput,
  type PdfRecoveryPlan,
  type PdfRecoveryRoute,
  type PdfRecoveryRouteDecision,
} from './pdf-parsing-skill';
import type { PdfParseDiagnostic, StructuredPaperParse } from './pdf-parse';

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

function splitConfiguredCommand(command: string): string[] {
  const matches = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ''));
}

function probeConfiguredMarker(): PdfRecoveryDiscoveryInput['localMarker'] {
  const configured = (process.env.CDF_MARKER_COMMAND || '').trim();
  if (!configured) {
    return {
      available: false,
      commandSource: 'not-configured',
    };
  }
  const [command, ...args] = splitConfiguredCommand(configured);
  if (!command) {
    return {
      available: false,
      commandSource: 'CDF_MARKER_COMMAND',
    };
  }
  const result = spawnSync(command, [...args, '--help'], {
    encoding: 'utf-8',
    timeout: Number(process.env.CDF_MARKER_DISCOVERY_TIMEOUT_MS || 5000),
    windowsHide: true,
  });
  return {
    available: !result.error && result.status === 0,
    commandSource: 'CDF_MARKER_COMMAND',
  };
}

function readDiscoveryRuntimeMetadata(args: ParsedArgs): PdfRecoveryDiscoveryInput {
  const metadataFile = stringArg(args, 'runtime-metadata');
  if (!metadataFile) return {};
  const parsed = readJson<PdfRecoveryDiscoveryInput>(metadataFile);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function discoverCapabilities(args: ParsedArgs): void {
  const runtimeMetadata = readDiscoveryRuntimeMetadata(args);
  const discovery = discoverPdfRecoveryCapabilities({
    ...runtimeMetadata,
    localMarker: runtimeMetadata.localMarker ?? probeConfiguredMarker(),
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

async function applyRecovery(args: ParsedArgs): Promise<void> {
  const artifactDir = requiredStringArg(args, 'artifact');
  const route = requiredStringArg(args, 'route');
  if (!isPdfRecoveryRoute(route)) throw new Error(`Unsupported PDF recovery route: ${route}`);

  const plan = readJson<PdfRecoveryPlan>(path.join(artifactDir, 'recovery-plan.json'));
  const results = recoveryResultsFor(args);
  let resultIndex = 0;
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
    recover: async () => {
      const result = results[resultIndex];
      resultIndex += 1;
      if (!result) return { ok: false, message: 'No recovery result was provided for this target.' };
      return result;
    },
  };

  recordPdfRecoveryRouteSelection(artifactDir, decision);
  const result = await executePdfRecoveryPlan(artifactDir, plan, decision, capability);
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
