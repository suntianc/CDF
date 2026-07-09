import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MINIMAX_TOKEN_PLAN_IMAGE_MODELS } from '../../shared/ai-subscriptions';
import { getSubscriptionSecret } from '../ai-subscription-credentials';
import { getAISubscriptionEntries } from '../ai-subscription-store';

export type GenerateImageRouteHint = 'auto' | 'minimax-token-plan';
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
      routeId: 'minimax-token-plan';
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

/** Agent-facing rule: always show images via markdown, never bare paths only. */
export const GENERATE_IMAGE_DISPLAY_RULE =
  'After success, you MUST display each image in your reply using markdown image syntax ' +
  '![alt](path-or-url). Use the returned artifact path (local absolute path) or any https URL. ' +
  'Do not only mention the file path as plain text — the chat UI renders ![alt](…) as an image. ' +
  'Prefer the displayMarkdown field from the tool result when present.';

export interface TokenPlanImageRoute {
  accessToken: string;
  generateEnabled: boolean;
  editEnabled: boolean;
}

export interface GenerateImageDeps {
  resolveTokenPlanImageRoute: () => TokenPlanImageRoute | null;
  httpPostJson: (
    url: string,
    headers: Record<string, string>,
    body: unknown
  ) => Promise<{ status: number; body: unknown }>;
  writeArtifact: (
    bytes: Buffer,
    options: { extension: string }
  ) => Promise<string>;
  /** Load a local image file as a MiniMax-compatible data URL. */
  readLocalImageAsDataUrl?: (filePath: string) => Promise<string>;
}

const IMAGE_GENERATION_URL = 'https://api.minimaxi.com/v1/image_generation';
const DEFAULT_MODEL = MINIMAX_TOKEN_PLAN_IMAGE_MODELS[0];

/**
 * Provider-neutral image generation entry for Agents.
 * MiniMax Token Plan → image-01 (text-to-image and subject-reference image-to-image).
 */
export async function generateImage(
  input: GenerateImageInput,
  deps: GenerateImageDeps
): Promise<GenerateImageResult> {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) {
    return { ok: false, error: 'prompt is required', code: 'INVALID_INPUT' };
  }

  const inputImages = Array.isArray(input.input_images) ? input.input_images : [];
  const operation: GenerateImageOperation =
    input.operation
    ?? (inputImages.length > 0 ? 'edit' : 'generate');

  if (operation === 'edit' && inputImages.length === 0) {
    return {
      ok: false,
      error: 'image edit requires at least one input_images reference',
      code: 'INVALID_INPUT',
    };
  }

  const route = deps.resolveTokenPlanImageRoute();
  if (!route || !route.accessToken?.trim()) {
    return {
      ok: false,
      error: 'MiniMax Token Plan is not connected for image generation',
      code: 'ROUTE_UNAVAILABLE',
    };
  }
  if (operation === 'generate' && !route.generateEnabled) {
    return {
      ok: false,
      error: 'MiniMax Token Plan image generation is disabled',
      code: 'CAPABILITY_DISABLED',
    };
  }
  if (operation === 'edit' && !route.editEnabled) {
    return {
      ok: false,
      error: 'MiniMax Token Plan image edit is disabled',
      code: 'CAPABILITY_DISABLED',
    };
  }

  let subjectReference: Array<{ type: 'character'; image_file: string }> | undefined;
  if (operation === 'edit') {
    try {
      subjectReference = await buildSubjectReferences(inputImages, deps);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'INVALID_INPUT',
      };
    }
  }

  const count = clampCount(input.count);
  const body: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    prompt,
    response_format: 'base64',
    n: count,
  };
  if (input.aspect_ratio) body.aspect_ratio = input.aspect_ratio;
  if (typeof input.seed === 'number') body.seed = input.seed;
  if (subjectReference?.length) body.subject_reference = subjectReference;

  const response = await deps.httpPostJson(
    IMAGE_GENERATION_URL,
    {
      Authorization: `Bearer ${route.accessToken.trim()}`,
      'Content-Type': 'application/json',
    },
    body
  );

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      error: `MiniMax image_generation failed (${response.status})`,
      code: 'PROVIDER_HTTP_ERROR',
    };
  }

  const parsed = parseImageResponse(response.body);
  if (!parsed.ok) return parsed;

  const artifacts: GenerateImageArtifact[] = [];
  for (const base64 of parsed.imagesBase64) {
    const bytes = Buffer.from(base64, 'base64');
    const filePath = await deps.writeArtifact(bytes, { extension: 'png' });
    artifacts.push({ path: filePath, mimeType: 'image/png' });
  }

  if (artifacts.length === 0) {
    return {
      ok: false,
      error: 'MiniMax image_generation returned no images',
      code: 'EMPTY_RESULT',
    };
  }

  return {
    ok: true,
    model: DEFAULT_MODEL,
    routeId: 'minimax-token-plan',
    operation,
    artifacts,
    displayMarkdown: buildDisplayMarkdown(prompt, artifacts),
  };
}

async function buildSubjectReferences(
  inputImages: GenerateImageInputRef[],
  deps: GenerateImageDeps
): Promise<Array<{ type: 'character'; image_file: string }>> {
  const refs: Array<{ type: 'character'; image_file: string }> = [];
  for (const image of inputImages) {
    if (image.kind === 'url') {
      const url = image.url?.trim();
      if (!url) throw new Error('input_images url is empty');
      refs.push({ type: 'character', image_file: url });
      continue;
    }
    const filePath = image.path?.trim();
    if (!filePath) throw new Error('input_images local_file path is empty');
    const reader = deps.readLocalImageAsDataUrl ?? readLocalImageAsDataUrl;
    const dataUrl = await reader(filePath);
    refs.push({ type: 'character', image_file: dataUrl });
  }
  return refs;
}

function buildDisplayMarkdown(prompt: string, artifacts: GenerateImageArtifact[]): string {
  const alt = sanitizeAltText(prompt);
  return artifacts.map((artifact) => `![${alt}](${artifact.path})`).join('\n');
}

function sanitizeAltText(prompt: string): string {
  const cleaned = prompt.replace(/[\[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'generated image';
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

/**
 * Resolve the MiniMax Token Plan image route from app-wide subscription state.
 * Returns null when logged out or missing vault key.
 */
export function resolveTokenPlanImageRoute(): TokenPlanImageRoute | null {
  const accessToken = getSubscriptionSecret('minimax-token-plan');
  if (!accessToken?.trim()) return null;

  const entry = getAISubscriptionEntries().find((item) => item.id === 'minimax-token-plan');
  if (!entry || entry.status !== 'connected') return null;

  const generateCapability = entry.capabilities.find(
    (capability) => capability.capabilityId === 'image.generate'
  );
  const editCapability = entry.capabilities.find(
    (capability) => capability.capabilityId === 'image.edit'
  );
  return {
    accessToken: accessToken.trim(),
    generateEnabled: generateCapability?.enabled !== false,
    editEnabled: editCapability?.enabled !== false,
  };
}

/** Persist generated image bytes under `<project>/.cdf/artifacts/images/`. */
export async function writeImageArtifact(
  projectPath: string,
  bytes: Buffer,
  options: { extension: string }
): Promise<string> {
  const ext = options.extension.replace(/^\./, '') || 'png';
  const dir = path.join(projectPath, '.cdf', 'artifacts', 'images');
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `image-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
}

/** Read a local JPG/PNG as a data URL for MiniMax subject_reference. */
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

export async function defaultHttpPostJson(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

export function createGenerateImageDeps(projectPath: string): GenerateImageDeps {
  return {
    resolveTokenPlanImageRoute,
    httpPostJson: defaultHttpPostJson,
    writeArtifact: (bytes, options) => writeImageArtifact(projectPath, bytes, options),
    readLocalImageAsDataUrl,
  };
}

/**
 * Public Agent Tool: generate_image (text-to-image and image-to-image via Token Plan image-01).
 */
export function createGenerateImageTool(projectPath: string) {
  const deps = createGenerateImageDeps(projectPath);
  return tool(
    async (input: {
      prompt: string;
      operation?: GenerateImageOperation;
      route_hint?: GenerateImageRouteHint;
      input_images?: GenerateImageInputRef[];
      aspect_ratio?: string;
      count?: number;
      seed?: number;
    }) => {
      const result = await generateImage(
        {
          prompt: input.prompt,
          operation: input.operation,
          route_hint: input.route_hint,
          input_images: input.input_images,
          aspect_ratio: input.aspect_ratio,
          count: input.count,
          seed: input.seed,
        },
        deps
      );
      return JSON.stringify(result);
    },
    {
      name: 'generate_image',
      description:
        'Generate or edit an image. Text-to-image uses prompt only; image-to-image (edit) uses prompt plus input_images ' +
        'as MiniMax character subject references (best: single frontal person photo). ' +
        'Uses connected MiniMax Token Plan (image-01). Returns local artifact paths plus displayMarkdown. ' +
        GENERATE_IMAGE_DISPLAY_RULE,
      schema: z.object({
        prompt: z.string().describe('Image description or edit instruction (max ~1500 characters)'),
        operation: z
          .enum(['generate', 'edit'])
          .optional()
          .describe('Defaults to edit when input_images is set, otherwise generate'),
        route_hint: z
          .enum(['auto', 'minimax-token-plan'])
          .optional()
          .describe('Preferred capability route; defaults to auto'),
        input_images: z
          .array(
            z.union([
              z.object({
                kind: z.literal('url'),
                url: z.string().describe('Public https image URL'),
              }),
              z.object({
                kind: z.literal('local_file'),
                path: z.string().describe('Absolute local path to a JPG/PNG reference image (<10MB)'),
              }),
            ])
          )
          .optional()
          .describe('Reference images for image-to-image (subject_reference). Prefer one clear face photo.'),
        aspect_ratio: z
          .enum(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'])
          .optional()
          .describe('Output aspect ratio'),
        count: z.number().int().min(1).max(9).optional().describe('Number of images (1-9)'),
        seed: z.number().int().optional().describe('Optional seed for reproducibility'),
      }),
    }
  );
}

function clampCount(count: number | undefined): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 1;
  return Math.min(9, Math.max(1, Math.floor(count)));
}

function parseImageResponse(
  body: unknown
): { ok: true; imagesBase64: string[] } | GenerateImageResult & { ok: false } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid MiniMax image response', code: 'PROVIDER_RESPONSE' };
  }
  const root = body as Record<string, unknown>;
  const baseResp = root.base_resp as Record<string, unknown> | undefined;
  if (baseResp && typeof baseResp.status_code === 'number' && baseResp.status_code !== 0) {
    const msg = typeof baseResp.status_msg === 'string' ? baseResp.status_msg : 'provider error';
    return {
      ok: false,
      error: `MiniMax image_generation error: ${msg}`,
      code: `PROVIDER_${baseResp.status_code}`,
    };
  }

  const data = root.data as Record<string, unknown> | undefined;
  const imagesBase64 = Array.isArray(data?.image_base64)
    ? data.image_base64.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];

  return { ok: true, imagesBase64 };
}
