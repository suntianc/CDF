import path from 'path';
import {
  createFlowDiagramDocumentStore,
  type FlowDiagramDocumentStore,
  FlowDiagramOperationError,
} from './flow-diagram-document-store';
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
import type { FlowDiagramDocumentChangeEvent } from '../../shared/flow-diagrams';

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
  documentStore?: FlowDiagramDocumentStore;
  renderExport?: (
    scene: ExcalidrawScene,
    format: FlowDiagramExportFormat,
  ) => Promise<FlowDiagramExportArtifact>;
  notifyFileChange?: (filePath: string) => void;
  notifyDocumentChange?: (event: FlowDiagramDocumentChangeEvent) => void;
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
    if (typeof element.frameId === 'string' && deletedIds.has(element.frameId)) {
      element.frameId = null;
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
  const documentStore = options.documentStore ?? createFlowDiagramDocumentStore({
    projectPath,
    stateRoot: options.stateRoot,
    notifyFileChange: options.notifyFileChange,
    notifyDocumentChange: options.notifyDocumentChange,
  });
  const renderExport = options.renderExport ?? renderFlowDiagramExport;

  const execute = async (input: FlowDiagramActionInput): Promise<FlowDiagramResult> => {
    const action = input.action;
    if (action === 'read_format') return success(action, formatDescription());

    if (action === 'create') {
      try {
        const created = createFlowDiagramScene(input.elements ?? []);
        const requestedPath = input.file_path
          ?? path.join('diagrams', `${safeName(input.name)}.excalidraw`);
        const result = await documentStore.createDocument(
          requestedPath,
          serializeFlowDiagramScene(created).toString('utf-8'),
          { collisionSafe: !input.file_path },
        );
        if (!result.ok) {
          return failure(
            action,
            new FlowDiagramOperationError(result.error.code, result.error.message),
            'CREATE_FAILED',
          );
        }
        return success(action, {
          ...fileData(projectPath, result.filePath),
          scene: created,
        });
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

    if (action === 'rollback') {
      const result = await documentStore.rollbackDocument(input.file_path);
      if (!result.ok) {
        return failure(
          action,
          new FlowDiagramOperationError(result.error.code, result.error.message),
          'ROLLBACK_FAILED',
        );
      }
      return success(action, fileData(projectPath, result.filePath));
    }

    const currentResult = await documentStore.readDocument(input.file_path);
    if (!currentResult.ok) {
      return failure(
        action,
        new FlowDiagramOperationError(
          currentResult.error.code,
          currentResult.error.message,
        ),
        action === 'export' ? 'EXPORT_FAILED' : 'READ_FAILED',
      );
    }
    const target = path.resolve(projectPath, input.file_path);
    let current: ExcalidrawScene;
    try {
      current = parseFlowDiagramScene(currentResult.document.content);
    } catch (error) {
      return failure(action, error, 'INVALID_SCENE');
    }

    if (action === 'get') {
      return success(action, { ...fileData(projectPath, target), scene: current });
    }

    if (action === 'edit') {
      let candidate: ReturnType<typeof applyOperations>;
      try {
        candidate = applyOperations(current, input.operations ?? []);
      } catch (error) {
        return failure(action, error, 'INVALID_OPERATION');
      }
      const result = await documentStore.applyAgentEdit(
        input.file_path,
        serializeFlowDiagramScene(candidate.scene).toString('utf-8'),
        currentResult.document.version,
      );
      if (!result.ok) {
        return failure(
          action,
          new FlowDiagramOperationError(result.error.code, result.error.message),
          'WRITE_FAILED',
        );
      }
      return success(action, {
        ...fileData(projectPath, result.filePath),
        summary: candidate.summary,
      });
    }

    try {
      if (input.format !== 'svg' && input.format !== 'png') {
        throw new FlowDiagramOperationError('FORMAT_REQUIRED', 'Export format must be png or svg.');
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
      const writeResult = await documentStore.createExport({
        sourceFilePath: input.file_path,
        requestedOutputPath: input.output_path,
        format: input.format,
        bytes: artifact.bytes,
      });
      if (!writeResult.ok) {
        throw new FlowDiagramOperationError(
          writeResult.error.code,
          writeResult.error.message,
        );
      }
      const relativePath = path.relative(projectPath, writeResult.filePath).replace(/\\/g, '/');
      return success(action, {
        filePath: writeResult.filePath,
        relativePath,
        mimeType: artifact.mimeType,
        artifact: {
          kind: 'file',
          path: writeResult.filePath,
          title: path.basename(writeResult.filePath),
          mimeType: artifact.mimeType,
          displayMarkdown: `![${path.basename(writeResult.filePath)}](${writeResult.filePath})`,
        },
      });
    } catch (error) {
      return failure(action, error, 'EXPORT_FAILED');
    }
  };

  return {
    execute,
  };
}
