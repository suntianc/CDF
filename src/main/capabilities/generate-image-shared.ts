import fs from 'fs';
import path from 'path';

export type GenerateImageRouteId = 'minimax-token-plan' | 'codex-oauth' | 'xai-oauth';
export type GenerateImageRouteHint = 'auto' | GenerateImageRouteId;
export type GenerateImageOperation = 'generate' | 'edit';

export type GenerateImageInputRef =
  | { kind: 'url'; url: string }
  | { kind: 'local_file'; path: string };

export interface GenerateImageInput {
  prompt: string;
  operation?: GenerateImageOperation;
  route_hint?: GenerateImageRouteHint;
  input_images?: GenerateImageInputRef[];
  aspect_ratio?: string;
  count?: number;
  seed?: number;
}

export interface GenerateImageArtifact {
  path: string;
  mimeType: string;
}

export type GenerateImageResult =
  | {
      ok: true;
      model: string;
      routeId: GenerateImageRouteId;
      operation: GenerateImageOperation;
      artifacts: GenerateImageArtifact[];
      /** Ready-to-paste markdown so the chat UI renders the image, not a bare path. */
      displayMarkdown: string;
    }
  | {
      ok: false;
      error: string;
      code?: string;
    };

export interface TokenPlanImageRoute {
  accessToken: string;
  generateEnabled: boolean;
  editEnabled: boolean;
}

export interface CodexImageRoute {
  generateEnabled: boolean;
  editEnabled: boolean;
  fetch: typeof fetch;
}

export interface XaiImageRoute {
  generateEnabled: boolean;
  editEnabled: boolean;
  fetch: typeof fetch;
}

export interface GenerateImageDeps {
  resolveTokenPlanImageRoute: () => TokenPlanImageRoute | null;
  resolveCodexImageRoute?: () => CodexImageRoute | null;
  resolveXaiImageRoute?: () => XaiImageRoute | null;
  httpPostJson: (
    url: string,
    headers: Record<string, string>,
    body: unknown
  ) => Promise<{ status: number; body: unknown }>;
  writeArtifact: (
    bytes: Buffer,
    options: { extension: string }
  ) => Promise<string>;
  downloadArtifact?: (url: string) => Promise<{ bytes: Buffer; mimeType: string }>;
  /** Load a local image file as a provider-compatible data URL. */
  readLocalImageAsDataUrl?: (filePath: string) => Promise<string>;
}

/** Whether the requested operation is switched on for a resolved image route. */
export function imageOperationEnabled(
  route: { generateEnabled: boolean; editEnabled: boolean } | null,
  operation: GenerateImageOperation
): boolean {
  if (!route) return false;
  return operation === 'edit' ? route.editEnabled : route.generateEnabled;
}

export function clampCount(count: number | undefined): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 1;
  return Math.min(9, Math.max(1, Math.floor(count)));
}

export function buildDisplayMarkdown(prompt: string, artifacts: GenerateImageArtifact[]): string {
  const alt = sanitizeAltText(prompt);
  return artifacts.map((artifact) => `![${alt}](${artifact.path})`).join('\n');
}

function sanitizeAltText(prompt: string): string {
  const cleaned = prompt.replace(/[\[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'generated image';
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

export function providerErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const error = parsed.error as Record<string, unknown> | undefined;
    const response = parsed.response as Record<string, unknown> | undefined;
    const responseError = response?.error as Record<string, unknown> | undefined;
    const code = error?.code ?? responseError?.code;
    const message = error?.message ?? responseError?.message;
    if (code && message) return `${String(code)}: ${String(message)}`;
    if (message) return String(message);
    if (code) return String(code);
  } catch {
    // Fall through to a bounded raw-text summary.
  }
  return raw.trim().slice(0, 500) || 'unknown provider error';
}

/** Resolve input image references (url or local file) to provider-ready URLs. */
export async function buildInputImageUrls(
  inputImages: GenerateImageInputRef[],
  deps: GenerateImageDeps
): Promise<string[]> {
  const imageUrls: string[] = [];
  for (const image of inputImages) {
    if (image.kind === 'url') {
      const url = image.url?.trim();
      if (!url) throw new Error('input_images url is empty');
      imageUrls.push(url);
      continue;
    }
    const filePath = image.path?.trim();
    if (!filePath) throw new Error('input_images local_file path is empty');
    const reader = deps.readLocalImageAsDataUrl ?? readLocalImageAsDataUrl;
    imageUrls.push(await reader(filePath));
  }
  return imageUrls;
}

/** Read a local image as a data URL for provider image inputs. */
export async function readLocalImageAsDataUrl(filePath: string): Promise<string> {
  const absolute = path.resolve(filePath);
  const bytes = await fs.promises.readFile(absolute);
  if (bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error('Reference image must be smaller than 10MB');
  }
  const ext = path.extname(absolute).toLowerCase();
  const mime =
    ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
        : 'image/jpeg';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
