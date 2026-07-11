import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { net } from 'electron';
import { z } from 'zod';
import { getOAuthCredential } from '../ai-subscription-credentials';
import {
  XAI_RESPONSES_API_BASE_URL,
  createOAuthAuthenticatedFetch,
} from '../ai-subscription-runtime';
import { getAISubscriptionEntries } from '../ai-subscription-store';
import { resolveCapabilityRoute } from './capability-route';

export type GenerateVideoRouteHint = 'auto' | 'xai-oauth';

export interface GenerateVideoInput {
  prompt: string;
  route_hint?: GenerateVideoRouteHint;
  duration?: number;
  aspect_ratio?: string;
  resolution?: '480p' | '720p';
}

export interface VideoArtifact {
  path: string;
  mimeType: string;
}

export type GenerateVideoResult =
  | {
      ok: true;
      model: string;
      routeId: 'xai-oauth';
      artifacts: VideoArtifact[];
      displayMarkdown: string;
    }
  | { ok: false; error: string; code?: string };

export interface XaiVideoRoute {
  enabled: boolean;
  fetch: typeof fetch;
}

export interface GenerateVideoDeps {
  resolveXaiVideoRoute: () => XaiVideoRoute | null;
  downloadArtifact?: (url: string) => Promise<{ bytes: Buffer; mimeType: string }>;
  writeArtifact: (bytes: Buffer, options: { extension: string }) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const XAI_VIDEO_MODEL = 'grok-imagine-video';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export async function generateVideo(
  input: GenerateVideoInput,
  deps: GenerateVideoDeps
): Promise<GenerateVideoResult> {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) return { ok: false, error: 'prompt is required', code: 'INVALID_INPUT' };

  const route = deps.resolveXaiVideoRoute();
  const notConnected = 'xAI Grok OAuth is not connected for video generation';
  const resolution = resolveCapabilityRoute<'xai-oauth'>(input.route_hint ?? 'auto', [
    {
      id: 'xai-oauth',
      connected: route !== null,
      operationEnabled: route?.enabled === true,
      unavailableError: notConnected,
      disabledError: 'xAI Grok OAuth video generation is disabled',
    },
  ]);
  if (!resolution.ok) {
    return { ok: false, error: resolution.error, code: resolution.code };
  }
  if (!route) {
    return { ok: false, error: notConnected, code: 'ROUTE_UNAVAILABLE' };
  }

  const requestBody: Record<string, unknown> = {
    model: XAI_VIDEO_MODEL,
    prompt,
  };
  if (input.duration !== undefined) requestBody.duration = input.duration;
  if (input.aspect_ratio) requestBody.aspect_ratio = input.aspect_ratio;
  if (input.resolution) requestBody.resolution = input.resolution;

  let createResponse: Response;
  try {
    createResponse = await route.fetch(`${XAI_RESPONSES_API_BASE_URL}/videos/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    return providerRequestError(error);
  }
  const created = await readJsonResponse(createResponse);
  if (!created.ok) return created.error;
  const requestId = typeof created.body.request_id === 'string'
    ? created.body.request_id.trim()
    : '';
  if (!requestId) {
    return { ok: false, error: 'xAI video generation returned no request_id', code: 'PROVIDER_RESPONSE' };
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let videoUrl = '';

  while (now() - startedAt <= timeoutMs) {
    let pollResponse: Response;
    try {
      pollResponse = await route.fetch(
        `${XAI_RESPONSES_API_BASE_URL}/videos/${encodeURIComponent(requestId)}`,
        { method: 'GET' }
      );
    } catch (error) {
      return providerRequestError(error);
    }
    const polled = await readJsonResponse(pollResponse);
    if (!polled.ok) return polled.error;
    const status = typeof polled.body.status === 'string' ? polled.body.status : '';
    if (status === 'done') {
      const video = polled.body.video as Record<string, unknown> | undefined;
      videoUrl = typeof video?.url === 'string' ? video.url.trim() : '';
      if (!videoUrl) {
        return { ok: false, error: 'xAI video generation returned no video URL', code: 'EMPTY_RESULT' };
      }
      break;
    }
    if (status === 'failed' || status === 'expired') {
      return {
        ok: false,
        error: `xAI video generation ${status}`,
        code: 'PROVIDER_RESPONSE',
      };
    }
    if (status !== 'pending' && status !== 'in_progress') {
      return {
        ok: false,
        error: `Unknown xAI video generation status: ${status || 'missing'}`,
        code: 'PROVIDER_RESPONSE',
      };
    }
    await sleep(pollIntervalMs);
  }

  if (!videoUrl) {
    return { ok: false, error: 'xAI video generation timed out', code: 'PROVIDER_TIMEOUT' };
  }

  try {
    const downloadArtifact = deps.downloadArtifact ?? downloadRemoteVideo;
    const downloaded = await downloadArtifact(videoUrl);
    const filePath = await deps.writeArtifact(downloaded.bytes, { extension: 'mp4' });
    return {
      ok: true,
      model: XAI_VIDEO_MODEL,
      routeId: 'xai-oauth',
      artifacts: [{ path: filePath, mimeType: downloaded.mimeType }],
      displayMarkdown: `[generated video](${filePath})`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: 'ARTIFACT_DOWNLOAD_ERROR',
    };
  }
}

function providerRequestError(error: unknown): GenerateVideoResult & { ok: false } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    code: 'PROVIDER_REQUEST_ERROR',
  };
}

async function readJsonResponse(
  response: Response
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: GenerateVideoResult & { ok: false } }
> {
  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: {
        ok: false,
        error: `xAI video generation failed (${response.status}): ${providerErrorMessage(raw)}`,
        code: 'PROVIDER_HTTP_ERROR',
      },
    };
  }
  try {
    return { ok: true, body: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      error: { ok: false, error: 'Invalid xAI video response', code: 'PROVIDER_RESPONSE' },
    };
  }
}

function providerErrorMessage(raw: string): string {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const error = body.error as Record<string, unknown> | undefined;
    const message = error?.message ?? body.message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500);
  } catch {
    // Fall through to a bounded raw response.
  }
  return raw.trim().slice(0, 500) || 'unknown provider error';
}

async function downloadRemoteVideo(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await net.fetch(url);
  if (!response.ok) throw new Error(`Failed to download generated video (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('Downloaded generated video is empty');
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4';
  return { bytes, mimeType };
}

export function resolveXaiVideoRoute(): XaiVideoRoute | null {
  const credential = getOAuthCredential('xai-oauth');
  if (!credential?.accessToken || credential.terminalStatus) return null;
  const entry = getAISubscriptionEntries().find((item) => item.id === 'xai-oauth');
  if (!entry || entry.status !== 'connected') return null;
  const capability = entry.capabilities.find((item) => item.capabilityId === 'video.generate');
  return {
    enabled: capability?.enabled !== false,
    fetch: createOAuthAuthenticatedFetch('xai-oauth'),
  };
}

export async function writeVideoArtifact(
  projectPath: string,
  bytes: Buffer,
  options: { extension: string }
): Promise<string> {
  const extension = options.extension.replace(/^\./, '') || 'mp4';
  const dir = path.join(projectPath, '.cdf', 'artifacts', 'videos');
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(
    dir,
    `video-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`
  );
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
}

export function createGenerateVideoDeps(projectPath: string): GenerateVideoDeps {
  return {
    resolveXaiVideoRoute,
    downloadArtifact: downloadRemoteVideo,
    writeArtifact: (bytes, options) => writeVideoArtifact(projectPath, bytes, options),
  };
}

export function createGenerateVideoTool(projectPath: string) {
  const deps = createGenerateVideoDeps(projectPath);
  return tool(
    async (input: GenerateVideoInput) => JSON.stringify(await generateVideo(input, deps)),
    {
      name: 'generate_video',
      description:
        'Generate a video through connected xAI Grok OAuth using Grok Imagine. ' +
        'The tool waits for completion, downloads the temporary result, and returns a local MP4 artifact. ' +
        'Include displayMarkdown or a markdown link to the returned artifact in your reply.',
      schema: z.object({
        prompt: z.string().describe('Description of the video to generate'),
        route_hint: z.enum(['auto', 'xai-oauth']).optional(),
        duration: z.number().int().min(1).max(15).optional().describe('Video duration in seconds'),
        aspect_ratio: z.enum(['16:9', '9:16', '1:1']).optional(),
        resolution: z.enum(['480p', '720p']).optional(),
      }),
    }
  );
}
