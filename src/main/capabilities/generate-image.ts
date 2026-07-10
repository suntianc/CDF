import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MINIMAX_TOKEN_PLAN_IMAGE_MODELS } from '../../shared/ai-subscriptions';
import { getOAuthCredential, getSubscriptionSecret } from '../ai-subscription-credentials';
import {
  CODEX_RESPONSES_API_BASE_URL,
  XAI_RESPONSES_API_BASE_URL,
  createOAuthAuthenticatedFetch,
} from '../ai-subscription-runtime';
import { getAISubscriptionEntries } from '../ai-subscription-store';

export type GenerateImageRouteHint = 'auto' | 'minimax-token-plan' | 'codex-oauth' | 'xai-oauth';
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
      routeId: 'minimax-token-plan' | 'codex-oauth' | 'xai-oauth';
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

const IMAGE_GENERATION_URL = 'https://api.minimaxi.com/v1/image_generation';
const DEFAULT_MODEL = MINIMAX_TOKEN_PLAN_IMAGE_MODELS[0];
const CODEX_IMAGE_MAIN_MODEL = 'gpt-5.4-mini';
const CODEX_IMAGE_TOOL_MODEL = 'gpt-image-2';
const XAI_IMAGE_MODEL = 'grok-imagine-image-quality';

/**
 * Provider-neutral image generation entry for Agents.
 * MiniMax Token Plan → image-01 (text-to-image and subject-reference image-to-image).
 * Codex OAuth → Responses image_generation + gpt-image-2 (text-to-image and image editing).
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

  const routeHint = input.route_hint ?? 'auto';
  const route = deps.resolveTokenPlanImageRoute();
  const codexRoute = deps.resolveCodexImageRoute?.() ?? null;
  const xaiRoute = deps.resolveXaiImageRoute?.() ?? null;
  const tokenPlanOperationEnabled = operation === 'edit'
    ? route?.editEnabled === true
    : route?.generateEnabled === true;
  const codexOperationEnabled = operation === 'edit'
    ? codexRoute?.editEnabled === true
    : codexRoute?.generateEnabled === true;
  const xaiOperationEnabled = operation === 'edit'
    ? xaiRoute?.editEnabled === true
    : xaiRoute?.generateEnabled === true;
  const shouldUseCodex = routeHint === 'codex-oauth'
    || (
      routeHint === 'auto'
      && !tokenPlanOperationEnabled
      && codexOperationEnabled
    );
  const shouldUseXai = routeHint === 'xai-oauth'
    || (
      routeHint === 'auto'
      && !tokenPlanOperationEnabled
      && !codexOperationEnabled
      && xaiOperationEnabled
    );

  if (shouldUseCodex) {
    if (!codexRoute) {
      return {
        ok: false,
        error: 'Codex OAuth is not connected for image generation',
        code: 'ROUTE_UNAVAILABLE',
      };
    }
    if (!codexOperationEnabled) {
      return {
        ok: false,
        error: `Codex OAuth image ${operation === 'edit' ? 'editing' : 'generation'} is disabled`,
        code: 'CAPABILITY_DISABLED',
      };
    }
    return generateCodexImage(prompt, input, codexRoute, deps);
  }

  if (shouldUseXai) {
    if (!xaiRoute) {
      return {
        ok: false,
        error: 'xAI Grok OAuth is not connected for image generation',
        code: 'ROUTE_UNAVAILABLE',
      };
    }
    if (!xaiOperationEnabled) {
      return {
        ok: false,
        error: `xAI Grok OAuth image ${operation === 'edit' ? 'editing' : 'generation'} is disabled`,
        code: 'CAPABILITY_DISABLED',
      };
    }
    return generateXaiImage(prompt, input, operation, xaiRoute, deps);
  }

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

async function generateXaiImage(
  prompt: string,
  input: GenerateImageInput,
  operation: GenerateImageOperation,
  route: XaiImageRoute,
  deps: GenerateImageDeps
): Promise<GenerateImageResult> {
  let inputImageUrls: string[] = [];
  if (operation === 'edit') {
    try {
      inputImageUrls = await buildInputImageUrls(input.input_images ?? [], deps);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'INVALID_INPUT',
      };
    }
  }

  let response: Response;
  try {
    const body: Record<string, unknown> = {
      model: XAI_IMAGE_MODEL,
      prompt,
      response_format: 'url',
      n: clampCount(input.count),
    };
    if (input.aspect_ratio) body.aspect_ratio = input.aspect_ratio;
    if (operation === 'edit') {
      const imageReferences = inputImageUrls.map((url) => ({ type: 'image_url', url }));
      if (imageReferences.length === 1) body.image = imageReferences[0];
      else body.images = imageReferences;
    }
    const endpoint = operation === 'edit' ? 'edits' : 'generations';
    response = await route.fetch(`${XAI_RESPONSES_API_BASE_URL}/images/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: 'PROVIDER_REQUEST_ERROR',
    };
  }

  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: `xAI image_generation failed (${response.status}): ${providerErrorMessage(raw)}`,
      code: 'PROVIDER_HTTP_ERROR',
    };
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'Invalid xAI image response', code: 'PROVIDER_RESPONSE' };
  }
  const urls = Array.isArray(body.data)
    ? body.data.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const url = (item as Record<string, unknown>).url;
      return typeof url === 'string' && url.trim() ? [url.trim()] : [];
    })
    : [];
  if (urls.length === 0) {
    return { ok: false, error: 'xAI image_generation returned no images', code: 'EMPTY_RESULT' };
  }

  const downloadArtifact = deps.downloadArtifact ?? downloadRemoteArtifact;
  const artifacts: GenerateImageArtifact[] = [];
  try {
    for (const url of urls) {
      const downloaded = await downloadArtifact(url);
      const extension = imageExtension(downloaded.mimeType, url);
      const filePath = await deps.writeArtifact(downloaded.bytes, { extension });
      artifacts.push({ path: filePath, mimeType: downloaded.mimeType });
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: 'ARTIFACT_DOWNLOAD_ERROR',
    };
  }

  return {
    ok: true,
    model: XAI_IMAGE_MODEL,
    routeId: 'xai-oauth',
    operation,
    artifacts,
    displayMarkdown: buildDisplayMarkdown(prompt, artifacts),
  };
}

async function downloadRemoteArtifact(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download generated image (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('Downloaded generated image is empty');
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  return { bytes, mimeType };
}

function imageExtension(mimeType: string, url: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (/\.png(?:$|[?#])/i.test(url)) return 'png';
  if (/\.webp(?:$|[?#])/i.test(url)) return 'webp';
  return 'jpg';
}

async function generateCodexImage(
  prompt: string,
  input: GenerateImageInput,
  route: CodexImageRoute,
  deps: GenerateImageDeps
): Promise<GenerateImageResult> {
  let inputImageUrls: string[] = [];
  if (input.operation === 'edit' || (input.input_images?.length ?? 0) > 0) {
    try {
      inputImageUrls = await buildInputImageUrls(input.input_images ?? [], deps);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'INVALID_INPUT',
      };
    }
  }
  const count = clampCount(input.count);
  const artifacts: GenerateImageArtifact[] = [];

  for (let index = 0; index < count; index += 1) {
    let response: Response;
    try {
      response = await route.fetch(
        `${CODEX_RESPONSES_API_BASE_URL}/responses`,
        {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildCodexImageRequest(
            prompt,
            input.operation ?? (inputImageUrls.length > 0 ? 'edit' : 'generate'),
            inputImageUrls,
            input.aspect_ratio
          )),
        }
      );
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'PROVIDER_REQUEST_ERROR',
      };
    }

    const parsed = await parseCodexImageResponse(response);
    if (!parsed.ok) return parsed;
    for (const image of parsed.images) {
      const bytes = Buffer.from(stripDataUrlPrefix(image.base64), 'base64');
      const output = normalizeCodexOutputFormat(image.outputFormat);
      const filePath = await deps.writeArtifact(bytes, { extension: output.extension });
      artifacts.push({ path: filePath, mimeType: output.mimeType });
    }
  }

  if (artifacts.length === 0) {
    return {
      ok: false,
      error: 'Codex image_generation returned no images',
      code: 'EMPTY_RESULT',
    };
  }

  return {
    ok: true,
    model: CODEX_IMAGE_TOOL_MODEL,
    routeId: 'codex-oauth',
    operation: input.operation ?? (inputImageUrls.length > 0 ? 'edit' : 'generate'),
    artifacts,
    displayMarkdown: buildDisplayMarkdown(prompt, artifacts),
  };
}

async function buildInputImageUrls(
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

function buildCodexImageRequest(
  prompt: string,
  operation: GenerateImageOperation,
  inputImageUrls: string[],
  aspectRatio?: string
): Record<string, unknown> {
  const imageTool: Record<string, unknown> = {
    type: 'image_generation',
    action: operation,
    model: CODEX_IMAGE_TOOL_MODEL,
    output_format: 'png',
  };
  const size = codexSizeForAspectRatio(aspectRatio);
  if (size) imageTool.size = size;

  const content: Array<Record<string, string>> = [{ type: 'input_text', text: prompt }];
  for (const imageUrl of inputImageUrls) {
    content.push({ type: 'input_image', image_url: imageUrl });
  }

  return {
    instructions: 'Create the requested image with the image generation tool.',
    stream: true,
    reasoning: { effort: 'medium', summary: 'auto' },
    parallel_tool_calls: true,
    include: ['reasoning.encrypted_content'],
    model: CODEX_IMAGE_MAIN_MODEL,
    store: false,
    tool_choice: { type: 'image_generation' },
    input: [
      {
        type: 'message',
        role: 'user',
        content,
      },
    ],
    tools: [imageTool],
  };
}

function codexSizeForAspectRatio(aspectRatio?: string): string | undefined {
  const sizes: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1536x864',
    '4:3': '1536x1152',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '3:4': '1152x1536',
    '9:16': '864x1536',
    '21:9': '1792x768',
  };
  return aspectRatio ? sizes[aspectRatio] : undefined;
}

interface CodexImagePayload {
  base64: string;
  outputFormat?: string;
}

async function parseCodexImageResponse(
  response: Response
): Promise<{ ok: true; images: CodexImagePayload[] } | GenerateImageResult & { ok: false }> {
  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: `Codex image_generation failed (${response.status}): ${providerErrorMessage(raw)}`,
      code: 'PROVIDER_HTTP_ERROR',
    };
  }

  const payloads = parseCodexPayloads(raw);
  const images: CodexImagePayload[] = [];
  const seen = new Set<string>();
  let providerError: string | undefined;
  let imageGenerationFailed = false;
  let providerMessage: string | undefined;

  const collectOutput = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const output = item as Record<string, unknown>;
      if (output.type === 'message' && Array.isArray(output.content)) {
        for (const content of output.content) {
          if (!content || typeof content !== 'object') continue;
          const part = content as Record<string, unknown>;
          const message = part.type === 'output_text' && typeof part.text === 'string'
            ? part.text
            : part.type === 'refusal' && typeof part.refusal === 'string'
              ? part.refusal
              : undefined;
          if (message?.trim() && !providerMessage) providerMessage = message.trim().slice(0, 500);
        }
        continue;
      }
      if (output.type !== 'image_generation_call') continue;
      if (output.status === 'failed') imageGenerationFailed = true;
      if (typeof output.result !== 'string') continue;
      const base64 = output.result.trim();
      if (!base64 || seen.has(base64)) continue;
      seen.add(base64);
      images.push({
        base64,
        outputFormat: typeof output.output_format === 'string' ? output.output_format : undefined,
      });
    }
  };

  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    const event = payload as Record<string, unknown>;
    if (event.type === 'response.output_item.done') collectOutput([event.item]);
    if (event.type === 'response.completed') {
      const completed = event.response as Record<string, unknown> | undefined;
      collectOutput(completed?.output);
    }
    collectOutput(event.output);
    if (event.type === 'response.failed' || event.type === 'error') {
      providerError = providerErrorMessage(JSON.stringify(event));
    }
  }

  if (images.length > 0) return { ok: true, images };
  if (imageGenerationFailed && !providerError) {
    providerError = providerMessage
      ? `Codex image_generation failed: ${providerMessage}`
      : 'Codex image_generation failed';
  }
  return {
    ok: false,
    error: providerError || 'Codex image_generation returned no images',
    code: providerError ? 'PROVIDER_RESPONSE' : 'EMPTY_RESULT',
  };
}

function parseCodexPayloads(raw: string): unknown[] {
  const payloads: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // Ignore malformed keepalive/event lines and continue to the terminal payload.
    }
  }
  if (payloads.length > 0) return payloads;
  try {
    return [JSON.parse(raw)];
  } catch {
    return [];
  }
}

function providerErrorMessage(raw: string): string {
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

function stripDataUrlPrefix(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value;
}

function normalizeCodexOutputFormat(value?: string): { extension: string; mimeType: string } {
  switch (value?.trim().toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return { extension: 'jpg', mimeType: 'image/jpeg' };
    case 'webp':
      return { extension: 'webp', mimeType: 'image/webp' };
    default:
      return { extension: 'png', mimeType: 'image/png' };
  }
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

/** Resolve Codex OAuth image capabilities through the shared authenticated Responses transport. */
export function resolveCodexImageRoute(): CodexImageRoute | null {
  const credential = getOAuthCredential('codex-oauth');
  if (!credential?.accessToken || credential.terminalStatus) return null;

  const entry = getAISubscriptionEntries().find((item) => item.id === 'codex-oauth');
  if (!entry || entry.status !== 'connected') return null;
  const generateCapability = entry.capabilities.find(
    (capability) => capability.capabilityId === 'image.generate'
  );
  const editCapability = entry.capabilities.find(
    (capability) => capability.capabilityId === 'image.edit'
  );
  return {
    generateEnabled: generateCapability?.enabled !== false,
    editEnabled: editCapability?.enabled !== false,
    fetch: createOAuthAuthenticatedFetch('codex-oauth'),
  };
}

/** Resolve xAI OAuth image capabilities through the shared authenticated API transport. */
export function resolveXaiImageRoute(): XaiImageRoute | null {
  const credential = getOAuthCredential('xai-oauth');
  if (!credential?.accessToken || credential.terminalStatus) return null;

  const entry = getAISubscriptionEntries().find((item) => item.id === 'xai-oauth');
  if (!entry || entry.status !== 'connected') return null;
  const generateCapability = entry.capabilities.find(
    (capability) => capability.capabilityId === 'image.generate'
  );
  const editCapability = entry.capabilities.find(
    (capability) => capability.capabilityId === 'image.edit'
  );
  return {
    generateEnabled: generateCapability?.enabled !== false,
    editEnabled: editCapability?.enabled !== false,
    fetch: createOAuthAuthenticatedFetch('xai-oauth'),
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
    resolveCodexImageRoute,
    resolveXaiImageRoute,
    httpPostJson: defaultHttpPostJson,
    downloadArtifact: downloadRemoteArtifact,
    writeArtifact: (bytes, options) => writeImageArtifact(projectPath, bytes, options),
    readLocalImageAsDataUrl,
  };
}

/**
 * Public Agent Tool: generate_image across connected subscription capability routes.
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
        'as source image references. ' +
        'Image generation and editing can use connected MiniMax Token Plan (image-01), Codex OAuth (gpt-image-2), ' +
        'or xAI Grok OAuth (Grok Imagine). ' +
        'Returns local artifact paths plus displayMarkdown. ' +
        GENERATE_IMAGE_DISPLAY_RULE,
      schema: z.object({
        prompt: z.string().describe('Image description or edit instruction (max ~1500 characters)'),
        operation: z
          .enum(['generate', 'edit'])
          .optional()
          .describe('Defaults to edit when input_images is set, otherwise generate'),
        route_hint: z
          .enum(['auto', 'minimax-token-plan', 'codex-oauth', 'xai-oauth'])
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
