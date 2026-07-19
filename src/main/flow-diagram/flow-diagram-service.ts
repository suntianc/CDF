import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  createFlowDiagramScene,
  EXCALIDRAW_SDK_VERSION,
  FlowDiagramSceneError,
  normalizeFlowDiagramElement,
  parseFlowDiagramScene,
  serializeFlowDiagramScene,
  validateFlowDiagramScene,
  type ExcalidrawElementData,
  type ExcalidrawScene,
} from './flow-diagram-scene';
import {
  renderFlowDiagramExport,
  type FlowDiagramExportArtifact,
  type FlowDiagramExportFormat,
} from './flow-diagram-export-renderer';
import {
  createFlowDiagramRevisionStore,
  type FlowDiagramRevisionStore,
} from './flow-diagram-revision-store';
import { runProjectFileMutation } from '../services/project-file-mutation';

export type FlowDiagramEditOperation =
  | { op: 'add'; elements: Array<Record<string, unknown>> }
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'delete'; id: string };

export type FlowDiagramActionInput =
  | { action: 'read_format' }
  | {
      action: 'create';
      file_path?: string;
      name?: string;
      elements?: Array<Record<string, unknown>>;
    }
  | { action: 'get'; file_path?: string }
  | {
      action: 'edit';
      file_path?: string;
      operations?: FlowDiagramEditOperation[];
    }
  | { action: 'rollback'; file_path?: string }
  | {
      action: 'export';
      file_path?: string;
      format?: FlowDiagramExportFormat;
      output_path?: string;
    };

export interface FlowDiagramArtifactDisplay {
  kind: 'flow_diagram';
  path: string;
  title: string;
  mimeType: 'application/vnd.excalidraw+json';
  displayMarkdown: string;
}

interface FlowDiagramSuccess {
  ok: true;
  action: FlowDiagramActionInput['action'];
  data: Record<string, unknown>;
}

interface FlowDiagramFailure {
  ok: false;
  action: FlowDiagramActionInput['action'];
  error: { code: string; message: string };
}

export type FlowDiagramResult = FlowDiagramSuccess | FlowDiagramFailure;

export interface FlowDiagramService {
  execute(input: FlowDiagramActionInput): Promise<FlowDiagramResult>;
}

export interface CreateFlowDiagramServiceOptions {
  projectPath: string;
  stateRoot: string;
  revisionStore?: FlowDiagramRevisionStore;
  replaceFile?: (filePath: string, bytes: Buffer) => Promise<void>;
  renderExport?: (
    scene: ExcalidrawScene,
    format: FlowDiagramExportFormat,
  ) => Promise<FlowDiagramExportArtifact>;
  notifyFileChange?: (filePath: string) => void;
}

class FlowDiagramOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FlowDiagramOperationError';
  }
}

const PROTECTED_SEGMENTS = new Set(['.git', '.cdf', 'node_modules', 'out', 'dist']);

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function nearestExistingAncestor(candidatePath: string): string {
  let current = candidatePath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function resolveProjectOwnedPath(
  projectPath: string,
  requestedPath: string,
  expectedExtension: string,
): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new FlowDiagramOperationError('PATH_REQUIRED', 'A non-empty Project path is required.');
  }
  if (trimmed.startsWith('~')) {
    throw new FlowDiagramOperationError('PATH_OUTSIDE_PROJECT', 'Home-relative paths are not allowed.');
  }
  const resolvedProjectPath = fs.realpathSync(projectPath);
  const target = path.resolve(projectPath, trimmed);
  if (!isWithin(path.resolve(projectPath), target)) {
    throw new FlowDiagramOperationError(
      'PATH_OUTSIDE_PROJECT',
      'The requested path is outside the current Project.',
    );
  }
  const relative = path.relative(projectPath, target);
  const segments = relative.toLowerCase().split(path.sep).filter(Boolean);
  if (
    segments.some((segment) => PROTECTED_SEGMENTS.has(segment))
    || segments.some((segment) => segment === '.env' || segment.startsWith('.env.'))
  ) {
    throw new FlowDiagramOperationError(
      'PROTECTED_PATH',
      'The requested path is protected and cannot be used for a Flow Diagram.',
    );
  }
  if (path.extname(target).toLowerCase() !== expectedExtension) {
    throw new FlowDiagramOperationError(
      'INVALID_EXTENSION',
      `The requested path must end with ${expectedExtension}.`,
    );
  }

  const ancestor = nearestExistingAncestor(target);
  const realAncestor = fs.realpathSync(ancestor);
  if (!isWithin(resolvedProjectPath, realAncestor)) {
    throw new FlowDiagramOperationError(
      'PATH_OUTSIDE_PROJECT',
      'The requested path resolves outside the current Project.',
    );
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new FlowDiagramOperationError('SYMLINK_NOT_ALLOWED', 'Flow Diagram paths cannot be symlinks.');
  }
  return target;
}

function safeName(value: string | undefined): string {
  const normalized = (value ?? 'flow-diagram')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'flow-diagram';
}

function collisionSafePath(basePath: string): string {
  if (!fs.existsSync(basePath)) return basePath;
  const extension = path.extname(basePath);
  const stem = basePath.slice(0, -extension.length);
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new FlowDiagramOperationError(
    'PATH_COLLISION',
    'Could not allocate a collision-safe Flow Diagram path.',
  );
}

function artifactFor(projectPath: string, filePath: string): FlowDiagramArtifactDisplay {
  const relativePath = path.relative(projectPath, filePath).replace(/\\/g, '/');
  const title = path.basename(filePath, '.excalidraw');
  return {
    kind: 'flow_diagram',
    path: filePath,
    title,
    mimeType: 'application/vnd.excalidraw+json',
    displayMarkdown: `[${title}](${filePath})`,
  };
}

function fileData(projectPath: string, filePath: string): Record<string, unknown> {
  return {
    filePath,
    relativePath: path.relative(projectPath, filePath).replace(/\\/g, '/'),
    artifact: artifactFor(projectPath, filePath),
  };
}

function temporaryPathFor(targetPath: string): string {
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.cdf-tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  );
}

export async function replaceFileAtomically(filePath: string, bytes: Buffer): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    const handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

async function writeNewFileAtomically(filePath: string, bytes: Buffer): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    await fs.promises.writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await fs.promises.link(temporaryPath, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new FlowDiagramOperationError(
          'FILE_EXISTS',
          'The requested output already exists; no file was overwritten.',
        );
      }
      throw error;
    }
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

function cloneScene(scene: ExcalidrawScene): ExcalidrawScene {
  return structuredClone(scene);
}

function activeElementById(
  scene: ExcalidrawScene,
  id: string,
): ExcalidrawElementData {
  const matches = scene.elements.filter((element) => element.id === id);
  if (matches.length > 1) {
    throw new FlowDiagramOperationError('DUPLICATE_ID', `Element id "${id}" is duplicated.`);
  }
  const target = matches[0];
  if (!target) {
    throw new FlowDiagramOperationError('TARGET_NOT_FOUND', `Element id "${id}" was not found.`);
  }
  if (target.isDeleted) {
    throw new FlowDiagramOperationError('TARGET_DELETED', `Element id "${id}" is already deleted.`);
  }
  return target;
}

const BASE_UPDATE_FIELDS = new Set([
  'x', 'y', 'width', 'height', 'angle', 'strokeColor', 'backgroundColor',
  'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'opacity', 'groupIds',
  'frameId', 'roundness', 'boundElements', 'link', 'locked',
]);
const UPDATE_FIELDS_BY_TYPE: Record<string, ReadonlySet<string>> = {
  text: new Set([
    ...BASE_UPDATE_FIELDS,
    'text', 'fontSize', 'fontFamily', 'textAlign', 'verticalAlign',
    'containerId', 'autoResize', 'lineHeight',
  ]),
  line: new Set([...BASE_UPDATE_FIELDS, 'points', 'startBinding', 'endBinding']),
  arrow: new Set([
    ...BASE_UPDATE_FIELDS,
    'points', 'startBinding', 'endBinding', 'startArrowhead', 'endArrowhead', 'elbowed',
  ]),
  freedraw: new Set([...BASE_UPDATE_FIELDS, 'points', 'pressures', 'simulatePressure']),
  laser: new Set([...BASE_UPDATE_FIELDS, 'points']),
  image: new Set([...BASE_UPDATE_FIELDS, 'fileId', 'status', 'scale', 'crop']),
  frame: new Set([...BASE_UPDATE_FIELDS, 'name']),
  magicframe: new Set([...BASE_UPDATE_FIELDS, 'name']),
};

function updateElement(
  scene: ExcalidrawScene,
  operation: Extract<FlowDiagramEditOperation, { op: 'update' }>,
): void {
  const target = activeElementById(scene, operation.id);
  if (!operation.patch || typeof operation.patch !== 'object' || Array.isArray(operation.patch)) {
    throw new FlowDiagramOperationError('INVALID_OPERATION', 'An update operation requires a patch object.');
  }
  const allowedFields = UPDATE_FIELDS_BY_TYPE[target.type] ?? BASE_UPDATE_FIELDS;
  const unsupportedFields = Object.keys(operation.patch).filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) {
    throw new FlowDiagramOperationError(
      'INCOMPATIBLE_UPDATE',
      `Element type "${target.type}" cannot update: ${unsupportedFields.join(', ')}.`,
    );
  }
  Object.assign(target, structuredClone(operation.patch));
  if ('text' in operation.patch && target.type === 'text') {
    const value = String(operation.patch.text ?? '');
    target.text = value;
    target.rawText = value;
    target.originalText = value;
  }
}

function deleteElement(scene: ExcalidrawScene, id: string): number {
  const target = activeElementById(scene, id);
  const deletedIds = new Set<string>([target.id]);
  if (Array.isArray(target.boundElements)) {
    for (const binding of target.boundElements) {
      if (
        binding
        && typeof binding === 'object'
        && (binding as Record<string, unknown>).type === 'text'
        && typeof (binding as Record<string, unknown>).id === 'string'
      ) {
        const boundText = scene.elements.find(
          (element) => element.id === (binding as Record<string, unknown>).id && !element.isDeleted,
        );
        if (boundText) deletedIds.add(boundText.id);
      }
    }
  }
  for (const element of scene.elements) {
    if (deletedIds.has(element.id)) {
      element.isDeleted = true;
      element.boundElements = null;
    }
  }
  for (const element of scene.elements) {
    if (element.startBinding && typeof element.startBinding === 'object') {
      const boundId = (element.startBinding as Record<string, unknown>).elementId;
      if (typeof boundId === 'string' && deletedIds.has(boundId)) element.startBinding = null;
    }
    if (element.endBinding && typeof element.endBinding === 'object') {
      const boundId = (element.endBinding as Record<string, unknown>).elementId;
      if (typeof boundId === 'string' && deletedIds.has(boundId)) element.endBinding = null;
    }
    if (typeof element.containerId === 'string' && deletedIds.has(element.containerId)) {
      element.isDeleted = true;
      deletedIds.add(element.id);
    }
    if (Array.isArray(element.boundElements)) {
      const remaining = element.boundElements.filter((binding) => {
        const boundId = binding && typeof binding === 'object'
          ? (binding as Record<string, unknown>).id
          : null;
        return typeof boundId !== 'string' || !deletedIds.has(boundId);
      });
      element.boundElements = remaining.length > 0 ? remaining : null;
    }
  }
  return deletedIds.size;
}

function applyOperations(
  original: ExcalidrawScene,
  operations: FlowDiagramEditOperation[],
): {
  scene: ExcalidrawScene;
  summary: { added: number; updated: number; deleted: number };
} {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new FlowDiagramOperationError('INVALID_OPERATION', 'At least one edit operation is required.');
  }
  const candidate = cloneScene(original);
  const summary = { added: 0, updated: 0, deleted: 0 };

  for (const operation of operations) {
    if (!operation || typeof operation !== 'object') {
      throw new FlowDiagramOperationError('INVALID_OPERATION', 'Every edit operation must be an object.');
    }
    if (operation.op === 'add') {
      if (!Array.isArray(operation.elements) || operation.elements.length === 0) {
        throw new FlowDiagramOperationError('INVALID_OPERATION', 'An add operation requires elements.');
      }
      const incoming = operation.elements.map(normalizeFlowDiagramElement);
      const existingIds = new Set(candidate.elements.map((element) => element.id));
      for (const element of incoming) {
        if (existingIds.has(element.id)) {
          throw new FlowDiagramOperationError(
            'DUPLICATE_ID',
            `Element id "${element.id}" already exists.`,
          );
        }
        existingIds.add(element.id);
        candidate.elements.push(element);
        summary.added += 1;
      }
      continue;
    }
    if (operation.op === 'update') {
      updateElement(candidate, operation);
      summary.updated += 1;
      continue;
    }
    if (operation.op === 'delete') {
      summary.deleted += deleteElement(candidate, operation.id);
      continue;
    }
    throw new FlowDiagramOperationError('INVALID_OPERATION', 'Unsupported Flow Diagram edit operation.');
  }

  return { scene: validateFlowDiagramScene(candidate), summary };
}

function safeMessage(error: unknown): string {
  if (error instanceof FlowDiagramOperationError || error instanceof FlowDiagramSceneError) {
    return error.message;
  }
  return 'The Flow Diagram operation could not be completed safely.';
}

function errorCode(error: unknown, fallback: string): string {
  if (error instanceof FlowDiagramOperationError || error instanceof FlowDiagramSceneError) {
    return error.code;
  }
  return fallback;
}

function success(
  action: FlowDiagramActionInput['action'],
  data: Record<string, unknown>,
): FlowDiagramSuccess {
  return { ok: true, action, data };
}

function failure(
  action: FlowDiagramActionInput['action'],
  error: unknown,
  fallbackCode: string,
): FlowDiagramFailure {
  return {
    ok: false,
    action,
    error: { code: errorCode(error, fallbackCode), message: safeMessage(error) },
  };
}

function formatDescription(): Record<string, unknown> {
  return {
    document: { type: 'excalidraw', version: 2 },
    sdk: EXCALIDRAW_SDK_VERSION,
    attribution:
      'Excalidraw data format compatible with @excalidraw/excalidraw 0.18.1 (MIT License; Copyright Excalidraw contributors).',
    actions: ['create', 'get', 'edit', 'rollback', 'export'],
    elementFormat: {
      required: ['id', 'type', 'x', 'y', 'width', 'height'],
      types: ['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'text', 'image', 'frame'],
      stableIdentity: 'Choose a unique id once and reuse it for update/delete operations.',
      text: 'Text elements use text/fontSize and may bind to a shape with containerId.',
      connectors: 'Line/arrow points are relative [x,y] pairs; bindings use stable elementId values.',
      optionalStyle: [
        'strokeColor',
        'backgroundColor',
        'fillStyle',
        'strokeWidth',
        'strokeStyle',
        'roughness',
        'opacity',
      ],
    },
    editFormat: {
      add: { op: 'add', elements: ['compact native elements'] },
      update: { op: 'update', id: 'stable-id', patch: { text: 'New label' } },
      delete: { op: 'delete', id: 'stable-id' },
    },
  };
}

export function createFlowDiagramService(
  options: CreateFlowDiagramServiceOptions,
): FlowDiagramService {
  const projectPath = path.resolve(options.projectPath);
  const revisionStore = options.revisionStore
    ?? createFlowDiagramRevisionStore(projectPath, options.stateRoot);
  const replaceFile = options.replaceFile ?? replaceFileAtomically;
  const renderExport = options.renderExport ?? renderFlowDiagramExport;
  const notify = (filePath: string) => options.notifyFileChange?.(filePath);

  const executeUnlocked = async (input: FlowDiagramActionInput): Promise<FlowDiagramResult> => {
    const action = input.action;
    if (action === 'read_format') return success(action, formatDescription());

    if (action === 'create') {
      try {
        const target = input.file_path
          ? resolveProjectOwnedPath(projectPath, input.file_path, '.excalidraw')
          : collisionSafePath(resolveProjectOwnedPath(
              projectPath,
              path.join('diagrams', `${safeName(input.name)}.excalidraw`),
              '.excalidraw',
            ));
        if (input.file_path && fs.existsSync(target)) {
          throw new FlowDiagramOperationError(
            'FILE_EXISTS',
            'The requested Flow Diagram already exists; no file was overwritten.',
          );
        }
        const created = createFlowDiagramScene(input.elements ?? []);
        await writeNewFileAtomically(target, serializeFlowDiagramScene(created));
        notify(target);
        return success(action, { ...fileData(projectPath, target), scene: created });
      } catch (error) {
        return failure(action, error, 'CREATE_FAILED');
      }
    }

    if (!('file_path' in input) || !input.file_path?.trim()) {
      return failure(
        action,
        new FlowDiagramOperationError(
          'TARGET_REQUIRED',
          `${action} requires an explicit Flow Diagram file_path.`,
        ),
        'TARGET_REQUIRED',
      );
    }

    let target: string;
    try {
      target = resolveProjectOwnedPath(projectPath, input.file_path, '.excalidraw');
      if (
        action !== 'rollback'
        && (!fs.existsSync(target) || !fs.statSync(target).isFile())
      ) {
        throw new FlowDiagramOperationError('SOURCE_NOT_FOUND', 'The Flow Diagram source file does not exist.');
      }
    } catch (error) {
      return failure(action, error, 'SOURCE_NOT_FOUND');
    }

    if (action === 'get') {
      try {
        const current = parseFlowDiagramScene(fs.readFileSync(target));
        return success(action, { ...fileData(projectPath, target), scene: current });
      } catch (error) {
        return failure(action, error, 'READ_FAILED');
      }
    }

    if (action === 'edit') {
      const originalBytes = fs.readFileSync(target);
      let original: ExcalidrawScene;
      try {
        original = parseFlowDiagramScene(originalBytes);
      } catch (error) {
        return failure(action, error, 'INVALID_SCENE');
      }
      let revisionToken: string;
      try {
        revisionToken = await revisionStore.record(target, originalBytes);
      } catch (error) {
        return failure(
          action,
          new FlowDiagramOperationError('REVISION_FAILED', safeMessage(error)),
          'REVISION_FAILED',
        );
      }
      let candidate: ReturnType<typeof applyOperations>;
      try {
        candidate = applyOperations(original, input.operations ?? []);
      } catch (error) {
        try {
          await revisionStore.consumeLatest(target, revisionToken);
        } catch (cleanupError) {
          return failure(
            action,
            new FlowDiagramOperationError('REVISION_FAILED', safeMessage(cleanupError)),
            'REVISION_FAILED',
          );
        }
        return failure(action, error, 'INVALID_OPERATION');
      }
      try {
        await replaceFile(target, serializeFlowDiagramScene(candidate.scene));
        notify(target);
        return success(action, {
          ...fileData(projectPath, target),
          summary: candidate.summary,
        });
      } catch (error) {
        try {
          if (!fs.readFileSync(target).equals(originalBytes)) {
            await replaceFileAtomically(target, originalBytes);
          }
          await revisionStore.consumeLatest(target, revisionToken);
        } catch (cleanupError) {
          return failure(
            action,
            new FlowDiagramOperationError('REVISION_FAILED', safeMessage(cleanupError)),
            'REVISION_FAILED',
          );
        }
        return failure(
          action,
          new FlowDiagramOperationError('WRITE_FAILED', safeMessage(error)),
          'WRITE_FAILED',
        );
      }
    }

    if (action === 'rollback') {
      const currentBytes = fs.existsSync(target) ? fs.readFileSync(target) : null;
      let sourceWasReplaced = false;
      try {
        const revision = await revisionStore.peekLatest(target);
        if (!revision) {
          throw new FlowDiagramOperationError(
            'NO_REVISION',
            'No applicable Agent edit revision is available for this Flow Diagram.',
          );
        }
        parseFlowDiagramScene(revision.sourceBytes);
        await replaceFile(target, revision.sourceBytes);
        sourceWasReplaced = true;
        await revisionStore.consumeLatest(target, revision.token);
        notify(target);
        return success(action, fileData(projectPath, target));
      } catch (error) {
        if (sourceWasReplaced) {
          try {
            if (currentBytes) await replaceFileAtomically(target, currentBytes);
            else await fs.promises.rm(target, { force: true });
          } catch {
            return failure(
              action,
              new FlowDiagramOperationError(
                'ROLLBACK_RESTORE_FAILED',
                'Rollback failed and the previous source could not be restored.',
              ),
              'ROLLBACK_RESTORE_FAILED',
            );
          }
        }
        return failure(action, error, 'ROLLBACK_FAILED');
      }
    }

    try {
      const currentBytes = fs.readFileSync(target);
      const current = parseFlowDiagramScene(currentBytes);
      if (input.format !== 'svg' && input.format !== 'png') {
        throw new FlowDiagramOperationError('FORMAT_REQUIRED', 'Export format must be png or svg.');
      }
      const expectedExtension = `.${input.format}`;
      const requestedOutput = input.output_path
        ? resolveProjectOwnedPath(projectPath, input.output_path, expectedExtension)
        : collisionSafePath(resolveProjectOwnedPath(
            projectPath,
            path.join(
              path.dirname(path.relative(projectPath, target)),
              `${path.basename(target, '.excalidraw')}${expectedExtension}`,
            ),
            expectedExtension,
          ));
      if (input.output_path && fs.existsSync(requestedOutput)) {
        throw new FlowDiagramOperationError(
          'FILE_EXISTS',
          'The requested export already exists; no file was overwritten.',
        );
      }
      let artifact: FlowDiagramExportArtifact;
      try {
        artifact = await renderExport(current, input.format);
      } catch {
        throw new FlowDiagramOperationError(
          'EXPORT_FAILED',
          'The Flow Diagram could not be rendered for export.',
        );
      }
      await writeNewFileAtomically(requestedOutput, artifact.bytes);
      notify(requestedOutput);
      const relativePath = path.relative(projectPath, requestedOutput).replace(/\\/g, '/');
      return success(action, {
        filePath: requestedOutput,
        relativePath,
        mimeType: artifact.mimeType,
        artifact: {
          kind: 'file',
          path: requestedOutput,
          title: path.basename(requestedOutput),
          mimeType: artifact.mimeType,
          displayMarkdown: input.format === 'svg' || input.format === 'png'
            ? `![${path.basename(requestedOutput)}](${requestedOutput})`
            : `[${path.basename(requestedOutput)}](${requestedOutput})`,
        },
      });
    } catch (error) {
      return failure(action, error, 'EXPORT_FAILED');
    }
  };

  return {
    execute: (input) => runProjectFileMutation(
      projectPath,
      () => executeUnlocked(input),
    ),
  };
}
