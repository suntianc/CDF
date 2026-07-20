import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MINIMAX_TOKEN_PLAN_MUSIC_MODELS } from '../../shared/ai-subscriptions';
import { getSubscriptionSecret } from '../ai-subscription-credentials';
import { getAISubscriptionEntries } from '../ai-subscription-store';
import { resolveCapabilityRoute } from './capability-route';

export type MusicModel = (typeof MINIMAX_TOKEN_PLAN_MUSIC_MODELS)[number];

export interface GenerateMusicInput {
  prompt?: string;
  lyrics?: string;
  model?: MusicModel;
  is_instrumental?: boolean;
  lyrics_optimizer?: boolean;
}

export interface MusicArtifact {
  path: string;
  mimeType: string;
}

export type GenerateMusicResult =
  | {
      ok: true;
      model: string;
      routeId: 'minimax-token-plan';
      artifacts: MusicArtifact[];
      displayMarkdown: string;
    }
  | { ok: false; error: string; code?: string };

export interface TokenPlanMusicRoute {
  accessToken: string;
  enabled: boolean;
}

export interface GenerateMusicDeps {
  resolveTokenPlanMusicRoute: () => TokenPlanMusicRoute | null;
  httpPostJson: (
    url: string,
    headers: Record<string, string>,
    body: unknown
  ) => Promise<{ status: number; body: unknown }>;
  writeArtifact: (bytes: Buffer, options: { extension: string }) => Promise<string>;
}

const MUSIC_URL = 'https://api.minimaxi.com/v1/music_generation';
const DEFAULT_MODEL: MusicModel = MINIMAX_TOKEN_PLAN_MUSIC_MODELS[0];
const MUSIC_ALLOWLIST = new Set<string>(MINIMAX_TOKEN_PLAN_MUSIC_MODELS);

/**
 * Music generation via MiniMax Token Plan (music-3.0 only).
 * @see https://platform.minimaxi.com/docs/api-reference/music-generation
 */
export async function generateMusic(
  input: GenerateMusicInput,
  deps: GenerateMusicDeps
): Promise<GenerateMusicResult> {
  const model = (input.model ?? DEFAULT_MODEL) as string;
  if (!MUSIC_ALLOWLIST.has(model)) {
    return {
      ok: false,
      error: `Model ${model} is not in the Token Plan music allowlist (music-3.0 only)`,
      code: 'MODEL_NOT_ALLOWED',
    };
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const lyrics = typeof input.lyrics === 'string' ? input.lyrics.trim() : '';
  const isInstrumental = Boolean(input.is_instrumental);
  const lyricsOptimizer = Boolean(input.lyrics_optimizer);

  if (isInstrumental) {
    if (!prompt) {
      return {
        ok: false,
        error: 'instrumental music requires prompt',
        code: 'INVALID_INPUT',
      };
    }
  } else if (!lyrics && !lyricsOptimizer) {
    return {
      ok: false,
      error: 'lyrics are required unless is_instrumental or lyrics_optimizer is true',
      code: 'INVALID_INPUT',
    };
  }

  const route = deps.resolveTokenPlanMusicRoute();
  const notConnected = 'MiniMax Token Plan is not connected for music generation';
  const resolution = resolveCapabilityRoute<'minimax-token-plan'>('auto', [
    {
      id: 'minimax-token-plan',
      connected: Boolean(route?.accessToken?.trim()),
      operationEnabled: route?.enabled === true,
      unavailableError: notConnected,
      disabledError: 'MiniMax Token Plan music generation is disabled',
    },
  ]);
  if (!resolution.ok) {
    return { ok: false, error: resolution.error, code: resolution.code };
  }
  if (!route) {
    return { ok: false, error: notConnected, code: 'ROUTE_UNAVAILABLE' };
  }

  const body: Record<string, unknown> = {
    model,
    stream: false,
    output_format: 'hex',
    audio_setting: {
      sample_rate: 44100,
      bitrate: 256000,
      format: 'mp3',
    },
  };
  if (prompt) body.prompt = prompt;
  if (lyrics) body.lyrics = lyrics;
  if (isInstrumental) body.is_instrumental = true;
  if (lyricsOptimizer) body.lyrics_optimizer = true;

  const response = await deps.httpPostJson(
    MUSIC_URL,
    {
      Authorization: `Bearer ${route.accessToken.trim()}`,
      'Content-Type': 'application/json',
    },
    body
  );

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      error: `MiniMax music_generation failed (${response.status})`,
      code: 'PROVIDER_HTTP_ERROR',
    };
  }

  const parsed = parseMusicResponse(response.body);
  if (!parsed.ok) return parsed;

  const filePath = await deps.writeArtifact(parsed.audioBytes, { extension: 'mp3' });
  const label = prompt || lyrics || 'generated music';
  return {
    ok: true,
    model,
    routeId: 'minimax-token-plan',
    artifacts: [{ path: filePath, mimeType: 'audio/mpeg' }],
    displayMarkdown: `[${sanitizeLinkLabel(label)}](${filePath})`,
  };
}

function sanitizeLinkLabel(text: string): string {
  const cleaned = text.replace(/[\[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'generated music';
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

function parseMusicResponse(
  body: unknown
): { ok: true; audioBytes: Buffer } | GenerateMusicResult & { ok: false } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid MiniMax music response', code: 'PROVIDER_RESPONSE' };
  }
  const root = body as Record<string, unknown>;
  const baseResp = root.base_resp as Record<string, unknown> | undefined;
  if (baseResp && typeof baseResp.status_code === 'number' && baseResp.status_code !== 0) {
    const msg = typeof baseResp.status_msg === 'string' ? baseResp.status_msg : 'provider error';
    return {
      ok: false,
      error: `MiniMax music_generation error: ${msg}`,
      code: `PROVIDER_${baseResp.status_code}`,
    };
  }
  const data = root.data as Record<string, unknown> | undefined;
  const hex = typeof data?.audio === 'string' ? data.audio : '';
  if (!hex) {
    return { ok: false, error: 'MiniMax music_generation returned no audio', code: 'EMPTY_RESULT' };
  }
  try {
    return { ok: true, audioBytes: Buffer.from(hex, 'hex') };
  } catch {
    return { ok: false, error: 'Failed to decode MiniMax music hex', code: 'PROVIDER_RESPONSE' };
  }
}

export function resolveTokenPlanMusicRoute(): TokenPlanMusicRoute | null {
  const accessToken = getSubscriptionSecret('minimax-token-plan');
  if (!accessToken?.trim()) return null;
  const entry = getAISubscriptionEntries().find((item) => item.id === 'minimax-token-plan');
  if (!entry || entry.status !== 'connected') return null;
  const music = entry.capabilities.find((c) => c.capabilityId === 'music.generate');
  return {
    accessToken: accessToken.trim(),
    enabled: music?.enabled !== false,
  };
}

export async function writeMusicArtifact(
  projectPath: string,
  bytes: Buffer,
  options: { extension: string }
): Promise<string> {
  const ext = options.extension.replace(/^\./, '') || 'mp3';
  const dir = path.join(projectPath, '.cdf', 'artifacts', 'audio');
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `music-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
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

export function createGenerateMusicDeps(projectPath: string): GenerateMusicDeps {
  return {
    resolveTokenPlanMusicRoute,
    httpPostJson: defaultHttpPostJson,
    writeArtifact: (bytes, options) => writeMusicArtifact(projectPath, bytes, options),
  };
}

export function createGenerateMusicTool(projectPath: string) {
  const deps = createGenerateMusicDeps(projectPath);
  return tool(
    async (input: GenerateMusicInput) => {
      const result = await generateMusic(input, deps);
      return JSON.stringify(result);
    },
    {
      name: 'generate_music',
      description:
        'Generate a song with MiniMax Token Plan music-3.0 only (not cover models). ' +
        'Provide prompt (style/mood) and lyrics (use \\n and structure tags like [verse]/[chorus]). ' +
        'For instrumental-only set is_instrumental=true (prompt required, lyrics optional). ' +
        'Returns a local audio path; include displayMarkdown or [title](path) in your reply.',
      schema: z.object({
        prompt: z.string().optional().describe('Style/mood/scene description (required for instrumental)'),
        lyrics: z
          .string()
          .optional()
          .describe('Lyrics with \\n line breaks; structure tags like [verse], [chorus] supported'),
        model: z.literal('music-3.0').optional().describe('Only music-3.0 is allowed on Token Plan in CDF'),
        is_instrumental: z.boolean().optional().describe('Generate instrumental only (no vocals)'),
        lyrics_optimizer: z
          .boolean()
          .optional()
          .describe('Auto-generate lyrics from prompt when lyrics is empty'),
      }),
    }
  );
}
