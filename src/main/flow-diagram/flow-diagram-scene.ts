import crypto from 'crypto';

export const EXCALIDRAW_DOCUMENT_VERSION = 2 as const;
export const EXCALIDRAW_SDK_VERSION = '@excalidraw/excalidraw@0.18.1' as const;

export interface ExcalidrawElementData {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted: boolean;
  [key: string]: unknown;
}

export interface ExcalidrawScene {
  type: 'excalidraw';
  version: 2;
  source?: string;
  elements: ExcalidrawElementData[];
  appState: Record<string, unknown>;
  files: Record<string, Record<string, unknown>>;
}

export class FlowDiagramSceneError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FlowDiagramSceneError';
  }
}

const NATIVE_ELEMENT_TYPES = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'line',
  'arrow',
  'freedraw',
  'text',
  'image',
  'frame',
  'magicframe',
  'embeddable',
  'iframe',
  'laser',
]);

function finiteNumber(value: unknown, field: string, id: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FlowDiagramSceneError(
      'INVALID_ELEMENT',
      `Element "${id}" requires a finite ${field}.`,
    );
  }
  return value;
}

function randomPositiveInteger(): number {
  return crypto.randomBytes(4).readUInt32BE(0) || 1;
}

export function normalizeFlowDiagramElement(
  raw: Record<string, unknown>,
): ExcalidrawElementData {
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  if (!id) {
    throw new FlowDiagramSceneError('INVALID_ELEMENT', 'Every element requires a stable non-empty id.');
  }
  if (!NATIVE_ELEMENT_TYPES.has(type)) {
    throw new FlowDiagramSceneError(
      'INVALID_ELEMENT',
      `Element "${id}" has unsupported type "${type || 'missing'}".`,
    );
  }

  const x = finiteNumber(raw.x, 'x', id);
  const y = finiteNumber(raw.y, 'y', id);
  const width = finiteNumber(raw.width, 'width', id);
  const height = finiteNumber(raw.height, 'height', id);
  if (width < 0 || height < 0) {
    throw new FlowDiagramSceneError(
      'INVALID_ELEMENT',
      `Element "${id}" width and height cannot be negative.`,
    );
  }

  const textValue = type === 'text'
    ? String(raw.text ?? raw.originalText ?? '')
    : undefined;
  const seed = typeof raw.seed === 'number' ? raw.seed : randomPositiveInteger();
  const versionNonce = typeof raw.versionNonce === 'number'
    ? raw.versionNonce
    : randomPositiveInteger();

  return {
    angle: 0,
    strokeColor: '#1b1b1f',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    seed,
    version: 1,
    versionNonce,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    ...raw,
    id,
    type,
    x,
    y,
    width,
    height,
    isDeleted: raw.isDeleted === true,
    ...(type === 'text'
      ? {
          fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : 20,
          fontFamily: typeof raw.fontFamily === 'number' ? raw.fontFamily : 1,
          text: textValue,
          rawText: String(raw.rawText ?? textValue),
          originalText: String(raw.originalText ?? textValue),
          textAlign: raw.textAlign ?? 'left',
          verticalAlign: raw.verticalAlign ?? 'top',
          containerId: raw.containerId ?? null,
          autoResize: raw.autoResize ?? true,
          lineHeight: typeof raw.lineHeight === 'number' ? raw.lineHeight : 1.25,
        }
      : {}),
  };
}

function validatePoints(element: ExcalidrawElementData): void {
  const minimum = element.type === 'freedraw' || element.type === 'laser' ? 1 : 2;
  if (!Array.isArray(element.points) || element.points.length < minimum) {
    throw new FlowDiagramSceneError(
      'INVALID_ELEMENT',
      `Element "${element.id}" requires at least ${minimum} valid point(s).`,
    );
  }
  for (const point of element.points) {
    if (
      !Array.isArray(point)
      || point.length < 2
      || typeof point[0] !== 'number'
      || !Number.isFinite(point[0])
      || typeof point[1] !== 'number'
      || !Number.isFinite(point[1])
    ) {
      throw new FlowDiagramSceneError(
        'INVALID_ELEMENT',
        `Element "${element.id}" contains an invalid point.`,
      );
    }
  }
}

function validateElementDetails(
  element: ExcalidrawElementData,
  files: Record<string, Record<string, unknown>>,
): void {
  finiteNumber(element.angle, 'angle', element.id);
  finiteNumber(element.strokeWidth, 'strokeWidth', element.id);
  const opacity = finiteNumber(element.opacity, 'opacity', element.id);
  if (numberOutside(opacity, 0, 100)) {
    throw new FlowDiagramSceneError(
      'INVALID_ELEMENT',
      `Element "${element.id}" opacity must be between 0 and 100.`,
    );
  }
  if (typeof element.strokeColor !== 'string' || typeof element.backgroundColor !== 'string') {
    throw new FlowDiagramSceneError(
      'INVALID_ELEMENT',
      `Element "${element.id}" requires string stroke and background colors.`,
    );
  }
  if (['line', 'arrow', 'freedraw', 'laser'].includes(element.type)) validatePoints(element);
  if (element.type === 'text') {
    if (
      typeof element.text !== 'string'
      || typeof element.originalText !== 'string'
      || typeof element.fontSize !== 'number'
      || element.fontSize <= 0
      || typeof element.lineHeight !== 'number'
      || element.lineHeight <= 0
    ) {
      throw new FlowDiagramSceneError(
        'INVALID_ELEMENT',
        `Text element "${element.id}" has invalid text metrics.`,
      );
    }
  }
  if (element.type === 'image' && !element.isDeleted) {
    const fileId = typeof element.fileId === 'string' ? element.fileId : '';
    const file = fileId ? files[fileId] : undefined;
    if (!file || typeof file.dataURL !== 'string' || typeof file.mimeType !== 'string') {
      throw new FlowDiagramSceneError(
        'INVALID_ELEMENT',
        `Image element "${element.id}" references a missing embedded file.`,
      );
    }
  }
}

function numberOutside(value: number, minimum: number, maximum: number): boolean {
  return value < minimum || value > maximum;
}

function validateReference(
  elementId: string,
  field: string,
  target: unknown,
  ids: Set<string>,
): void {
  if (target === null || target === undefined) return;
  if (typeof target !== 'object' || Array.isArray(target)) {
    throw new FlowDiagramSceneError(
      'INVALID_BINDING',
      `Element "${elementId}" has an invalid ${field}.`,
    );
  }
  const targetId = (target as Record<string, unknown>).elementId;
  if (typeof targetId !== 'string' || !ids.has(targetId)) {
    throw new FlowDiagramSceneError(
      'INVALID_BINDING',
      `Element "${elementId}" ${field} references a missing element.`,
    );
  }
}

export function validateFlowDiagramScene(value: unknown): ExcalidrawScene {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FlowDiagramSceneError('INVALID_SCENE', 'Flow Diagram document must be a JSON object.');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== 'excalidraw' || candidate.version !== EXCALIDRAW_DOCUMENT_VERSION) {
    throw new FlowDiagramSceneError(
      'INVALID_SCENE',
      'Flow Diagram must be an Excalidraw version 2 document.',
    );
  }
  if (!Array.isArray(candidate.elements)) {
    throw new FlowDiagramSceneError('INVALID_SCENE', 'Flow Diagram elements must be an array.');
  }
  if (!candidate.appState || typeof candidate.appState !== 'object' || Array.isArray(candidate.appState)) {
    throw new FlowDiagramSceneError('INVALID_SCENE', 'Flow Diagram appState must be an object.');
  }
  if (!candidate.files || typeof candidate.files !== 'object' || Array.isArray(candidate.files)) {
    throw new FlowDiagramSceneError('INVALID_SCENE', 'Flow Diagram files must be an object.');
  }

  const files = structuredClone(candidate.files as Record<string, Record<string, unknown>>);
  const elements = candidate.elements.map((element) => {
    if (!element || typeof element !== 'object' || Array.isArray(element)) {
      throw new FlowDiagramSceneError('INVALID_ELEMENT', 'Every Flow Diagram element must be an object.');
    }
    const normalized = normalizeFlowDiagramElement(element as Record<string, unknown>);
    validateElementDetails(normalized, files);
    return normalized;
  });
  const ids = new Set<string>();
  for (const element of elements) {
    if (ids.has(element.id)) {
      throw new FlowDiagramSceneError(
        'INVALID_SCENE',
        `Flow Diagram contains duplicate element id "${element.id}".`,
      );
    }
    ids.add(element.id);
  }

  for (const element of elements) {
    validateReference(element.id, 'startBinding', element.startBinding, ids);
    validateReference(element.id, 'endBinding', element.endBinding, ids);
    if (element.containerId !== null && element.containerId !== undefined) {
      if (typeof element.containerId !== 'string' || !ids.has(element.containerId)) {
        throw new FlowDiagramSceneError(
          'INVALID_BINDING',
          `Element "${element.id}" containerId references a missing element.`,
        );
      }
    }
    if (element.boundElements !== null && element.boundElements !== undefined) {
      if (!Array.isArray(element.boundElements)) {
        throw new FlowDiagramSceneError(
          'INVALID_BINDING',
          `Element "${element.id}" boundElements must be an array or null.`,
        );
      }
      for (const binding of element.boundElements) {
        const bindingId = binding && typeof binding === 'object'
          ? (binding as Record<string, unknown>).id
          : null;
        if (typeof bindingId !== 'string' || !ids.has(bindingId)) {
          throw new FlowDiagramSceneError(
            'INVALID_BINDING',
            `Element "${element.id}" boundElements references a missing element.`,
          );
        }
      }
    }
  }

  return {
    type: 'excalidraw',
    version: EXCALIDRAW_DOCUMENT_VERSION,
    ...(typeof candidate.source === 'string' ? { source: candidate.source } : {}),
    elements,
    appState: structuredClone(candidate.appState as Record<string, unknown>),
    files,
  };
}

export function parseFlowDiagramScene(content: Buffer | string): ExcalidrawScene {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : content);
  } catch {
    throw new FlowDiagramSceneError('INVALID_SCENE', 'Flow Diagram source is not valid JSON.');
  }
  return validateFlowDiagramScene(parsed);
}

export function serializeFlowDiagramScene(scene: ExcalidrawScene): Buffer {
  return Buffer.from(`${JSON.stringify(scene, null, 2)}\n`, 'utf8');
}

export function createFlowDiagramScene(
  elements: Array<Record<string, unknown>>,
): ExcalidrawScene {
  return validateFlowDiagramScene({
    type: 'excalidraw',
    version: EXCALIDRAW_DOCUMENT_VERSION,
    source: 'https://cdf.local',
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    files: {},
  });
}
