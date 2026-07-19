import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { ExcalidrawElementData, ExcalidrawScene } from './flow-diagram-scene';

export type FlowDiagramExportFormat = 'svg' | 'png';

export interface FlowDiagramExportArtifact {
  bytes: Buffer;
  mimeType: 'image/svg+xml' | 'image/png';
}

interface SceneBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

const EXPORT_PADDING = 24;
const MAX_RASTER_EDGE = 4096;

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function visibleElements(scene: ExcalidrawScene): ExcalidrawElementData[] {
  return scene.elements.filter((element) => !element.isDeleted);
}

function sceneBounds(scene: ExcalidrawScene): SceneBounds {
  const elements = visibleElements(scene);
  if (elements.length === 0) {
    return { minX: 0, minY: 0, width: 640, height: 360 };
  }
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.width));
  const maxY = Math.max(...elements.map((element) => element.y + element.height));
  return {
    minX: minX - EXPORT_PADDING,
    minY: minY - EXPORT_PADDING,
    width: Math.max(1, maxX - minX + EXPORT_PADDING * 2),
    height: Math.max(1, maxY - minY + EXPORT_PADDING * 2),
  };
}

function opacity(element: ExcalidrawElementData): number {
  return Math.max(0, Math.min(1, number(element.opacity, 100) / 100));
}

function transform(element: ExcalidrawElementData): string {
  const angle = number(element.angle);
  if (!angle) return '';
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  return ` transform="rotate(${angle * 180 / Math.PI} ${centerX} ${centerY})"`;
}

function shapeStyle(element: ExcalidrawElementData, fillOverride?: string): string {
  const fill = fillOverride ?? color(element.backgroundColor, 'transparent');
  const stroke = color(element.strokeColor, '#1b1b1f');
  const dash = element.strokeStyle === 'dashed'
    ? ' stroke-dasharray="10 8"'
    : element.strokeStyle === 'dotted'
      ? ' stroke-dasharray="2 6"'
      : '';
  return `fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${number(element.strokeWidth, 2)}" opacity="${opacity(element)}"${dash}`;
}

function pointsFor(element: ExcalidrawElementData): Array<[number, number]> {
  if (!Array.isArray(element.points)) return [];
  return element.points.flatMap((point) => (
    Array.isArray(point)
    && typeof point[0] === 'number'
    && typeof point[1] === 'number'
      ? [[element.x + point[0], element.y + point[1]] as [number, number]]
      : []
  ));
}

function renderTextElement(element: ExcalidrawElementData): string {
  const fontSize = Math.max(1, number(element.fontSize, 20));
  const lineHeight = Math.max(0.5, number(element.lineHeight, 1.25));
  const lines = String(element.text ?? '').split('\n');
  const align = element.textAlign === 'center'
    ? 'middle'
    : element.textAlign === 'right'
      ? 'end'
      : 'start';
  const x = align === 'middle'
    ? element.x + element.width / 2
    : align === 'end'
      ? element.x + element.width
      : element.x;
  const firstY = element.y + fontSize;
  const tspans = lines.map((line, index) => (
    `<tspan x="${x}" y="${firstY + index * fontSize * lineHeight}">${escapeXml(line)}</tspan>`
  )).join('');
  return `<text${transform(element)} fill="${escapeXml(color(element.strokeColor, '#1b1b1f'))}" opacity="${opacity(element)}" font-family="Arial, sans-serif" font-size="${fontSize}" text-anchor="${align}">${tspans}</text>`;
}

function renderImageElement(
  element: ExcalidrawElementData,
  scene: ExcalidrawScene,
): string {
  const fileId = typeof element.fileId === 'string' ? element.fileId : '';
  const file = fileId ? scene.files[fileId] : undefined;
  const dataUrl = typeof file?.dataURL === 'string' ? file.dataURL : '';
  if (!dataUrl) return '';
  return `<image${transform(element)} x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" opacity="${opacity(element)}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(dataUrl)}"/>`;
}

function renderElement(element: ExcalidrawElementData, scene: ExcalidrawScene): string {
  if (element.type === 'text') return renderTextElement(element);
  if (element.type === 'image') return renderImageElement(element, scene);

  const style = shapeStyle(element);
  if (element.type === 'ellipse') {
    return `<ellipse${transform(element)} cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" ${style}/>`;
  }
  if (element.type === 'diamond') {
    const points = [
      `${element.x + element.width / 2},${element.y}`,
      `${element.x + element.width},${element.y + element.height / 2}`,
      `${element.x + element.width / 2},${element.y + element.height}`,
      `${element.x},${element.y + element.height / 2}`,
    ].join(' ');
    return `<polygon${transform(element)} points="${points}" ${style}/>`;
  }
  if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw' || element.type === 'laser') {
    const points = pointsFor(element).map(([x, y]) => `${x},${y}`).join(' ');
    if (!points) return '';
    const arrow = element.type === 'arrow' && element.endArrowhead !== null
      ? ' marker-end="url(#cdf-arrowhead)"'
      : '';
    return `<polyline${transform(element)} points="${points}" ${shapeStyle(element, 'none')} stroke-linecap="round" stroke-linejoin="round"${arrow}/>`;
  }
  if (element.type === 'embeddable' || element.type === 'iframe') {
    return `<rect${transform(element)} x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="8" ${style}/>`;
  }

  const radius = element.roundness ? Math.min(12, element.width / 4, element.height / 4) : 0;
  return `<rect${transform(element)} x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${radius}" ${style}/>`;
}

export function renderFlowDiagramSvg(scene: ExcalidrawScene): string {
  const bounds = sceneBounds(scene);
  const background = color(scene.appState.viewBackgroundColor, '#ffffff');
  const body = visibleElements(scene).map((element) => renderElement(element, scene)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" role="img"><defs><marker id="cdf-arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker></defs><rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="${escapeXml(background)}"/>${body}</svg>`;
}

export async function renderFlowDiagramExport(
  scene: ExcalidrawScene,
  format: FlowDiagramExportFormat,
): Promise<FlowDiagramExportArtifact> {
  const svg = renderFlowDiagramSvg(scene);
  if (format === 'svg') {
    return { bytes: Buffer.from(svg, 'utf8'), mimeType: 'image/svg+xml' };
  }

  const bounds = sceneBounds(scene);
  const scale = Math.min(1, MAX_RASTER_EDGE / Math.max(bounds.width, bounds.height));
  const width = Math.max(1, Math.ceil(bounds.width * scale));
  const height = Math.max(1, Math.ceil(bounds.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const image = await loadImage(Buffer.from(svg, 'utf8'));
  context.drawImage(image, 0, 0, width, height);
  return { bytes: canvas.toBuffer('image/png'), mimeType: 'image/png' };
}
