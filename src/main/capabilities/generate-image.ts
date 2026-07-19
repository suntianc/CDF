import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getOAuthCredential, getSubscriptionSecret } from '../ai-subscription-credentials';
import { createOAuthAuthenticatedFetch } from '../ai-subscription-runtime';
import { getAISubscriptionEntries } from '../ai-subscription-store';
import { resolveCapabilityRoute } from './capability-route';
import { generateCodexImage } from './generate-image-codex';
import { generateMinimaxImage } from './generate-image-minimax';
import {
  imageOperationEnabled,
  readLocalImageAsDataUrl,
  type CodexImageRoute,
  type GenerateImageDeps,
  type GenerateImageInput,
  type GenerateImageInputRef,
  type GenerateImageOperation,
  type GenerateImageResult,
  type GenerateImageRouteHint,
  type GenerateImageRouteId,
  type TokenPlanImageRoute,
  type XaiImageRoute,
} from './generate-image-shared';
import { downloadRemoteArtifact, generateXaiImage } from './generate-image-xai';

export type {
  CodexImageRoute,
  GenerateImageArtifact,
  GenerateImageDeps,
  GenerateImageInput,
  GenerateImageInputRef,
  GenerateImageOperation,
  GenerateImageResult,
  GenerateImageRouteHint,
  GenerateImageRouteId,
  TokenPlanImageRoute,
  XaiImageRoute,
} from './generate-image-shared';
export { readLocalImageAsDataUrl } from './generate-image-shared';

/** Agent-facing rule: always show images via markdown, never bare paths only. */
export const GENERATE_IMAGE_DISPLAY_RULE =
  'After success, you MUST display each image in your reply using markdown image syntax ' +
  '![alt](path-or-url). Use the returned artifact path (local absolute path) or any https URL. ' +
  'Do not only mention the file path as plain text — the chat UI renders ![alt](…) as an image. ' +
  'Prefer the displayMarkdown field from the tool result when present.';

/**
 * Provider-neutral image generation entry for Agents. Route selection is shared
 * with the other capabilities via {@link resolveCapabilityRoute}; each provider
 * lives in its own adapter module (minimax / codex / xai).
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
  const minimaxNotConnected = 'MiniMax Token Plan is not connected for image generation';

  const resolution = resolveCapabilityRoute<GenerateImageRouteId>(routeHint, [
    {
      id: 'minimax-token-plan',
      connected: Boolean(route?.accessToken?.trim()),
      operationEnabled: imageOperationEnabled(route, operation),
      unavailableError: minimaxNotConnected,
      disabledError: operation === 'edit'
        ? 'MiniMax Token Plan image edit is disabled'
        : 'MiniMax Token Plan image generation is disabled',
    },
    {
      id: 'codex-oauth',
      connected: codexRoute !== null,
      operationEnabled: imageOperationEnabled(codexRoute, operation),
      unavailableError: 'Codex OAuth is not connected for image generation',
      disabledError: `Codex OAuth image ${operation === 'edit' ? 'editing' : 'generation'} is disabled`,
    },
    {
      id: 'xai-oauth',
      connected: xaiRoute !== null,
      operationEnabled: imageOperationEnabled(xaiRoute, operation),
      unavailableError: 'xAI Grok OAuth is not connected for image generation',
      disabledError: `xAI Grok OAuth image ${operation === 'edit' ? 'editing' : 'generation'} is disabled`,
    },
  ]);

  if (!resolution.ok) {
    return { ok: false, error: resolution.error, code: resolution.code };
  }
  if (resolution.id === 'codex-oauth' && codexRoute) {
    return generateCodexImage(prompt, input, codexRoute, deps);
  }
  if (resolution.id === 'xai-oauth' && xaiRoute) {
    return generateXaiImage(prompt, input, operation, xaiRoute, deps);
  }
  // MiniMax Token Plan path — the resolver already verified connectivity and
  // that the requested operation is enabled; the guard below just narrows `route`.
  if (!route) {
    return { ok: false, error: minimaxNotConnected, code: 'ROUTE_UNAVAILABLE' };
  }
  return generateMinimaxImage(prompt, input, operation, route, deps);
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
