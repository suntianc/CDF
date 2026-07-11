import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MINIMAX_TOKEN_PLAN_SPEECH_MODELS } from '../../shared/ai-subscriptions';
import { getSubscriptionSecret } from '../ai-subscription-credentials';
import { getAISubscriptionEntries } from '../ai-subscription-store';
import { resolveCapabilityRoute } from './capability-route';

export type SpeechModel = (typeof MINIMAX_TOKEN_PLAN_SPEECH_MODELS)[number];

export interface SynthesizeSpeechInput {
  text: string;
  model?: SpeechModel;
  voice_id?: string;
  speed?: number;
  emotion?: string;
  language_boost?: string;
}

export interface SpeechArtifact {
  path: string;
  mimeType: string;
}

export type SynthesizeSpeechResult =
  | {
      ok: true;
      model: string;
      routeId: 'minimax-token-plan';
      artifacts: SpeechArtifact[];
      displayMarkdown: string;
    }
  | { ok: false; error: string; code?: string };

export interface TokenPlanSpeechRoute {
  accessToken: string;
  enabled: boolean;
}

export interface SynthesizeSpeechDeps {
  resolveTokenPlanSpeechRoute: () => TokenPlanSpeechRoute | null;
  httpPostJson: (
    url: string,
    headers: Record<string, string>,
    body: unknown
  ) => Promise<{ status: number; body: unknown }>;
  writeArtifact: (bytes: Buffer, options: { extension: string }) => Promise<string>;
}

const T2A_URL = 'https://api.minimaxi.com/v1/t2a_v2';
const DEFAULT_MODEL: SpeechModel = MINIMAX_TOKEN_PLAN_SPEECH_MODELS[0];
const DEFAULT_VOICE_ID = 'male-qn-qingse';

const SPEECH_ALLOWLIST = new Set<string>(MINIMAX_TOKEN_PLAN_SPEECH_MODELS);

/**
 * Synchronous speech synthesis via MiniMax Token Plan (Speech 2.8 only).
 * @see https://platform.minimaxi.com/docs/api-reference/speech-t2a-http
 */
export async function synthesizeSpeech(
  input: SynthesizeSpeechInput,
  deps: SynthesizeSpeechDeps
): Promise<SynthesizeSpeechResult> {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) {
    return { ok: false, error: 'text is required', code: 'INVALID_INPUT' };
  }
  if (text.length > 10_000) {
    return { ok: false, error: 'text must be at most 10000 characters', code: 'INVALID_INPUT' };
  }

  const model = (input.model ?? DEFAULT_MODEL) as string;
  if (!SPEECH_ALLOWLIST.has(model)) {
    return {
      ok: false,
      error: `Model ${model} is not in the Token Plan Speech 2.8 allowlist`,
      code: 'MODEL_NOT_ALLOWED',
    };
  }

  const route = deps.resolveTokenPlanSpeechRoute();
  const notConnected = 'MiniMax Token Plan is not connected for speech synthesis';
  const resolution = resolveCapabilityRoute<'minimax-token-plan'>('auto', [
    {
      id: 'minimax-token-plan',
      connected: Boolean(route?.accessToken?.trim()),
      operationEnabled: route?.enabled === true,
      unavailableError: notConnected,
      disabledError: 'MiniMax Token Plan speech synthesis is disabled',
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
    text,
    stream: false,
    output_format: 'hex',
    voice_setting: {
      voice_id: input.voice_id?.trim() || DEFAULT_VOICE_ID,
      ...(typeof input.speed === 'number' ? { speed: input.speed } : {}),
      ...(input.emotion ? { emotion: input.emotion } : {}),
    },
    audio_setting: {
      format: 'mp3',
      sample_rate: 32000,
      bitrate: 128000,
      channel: 1,
    },
  };
  if (input.language_boost) body.language_boost = input.language_boost;

  const response = await deps.httpPostJson(
    T2A_URL,
    {
      Authorization: `Bearer ${route.accessToken.trim()}`,
      'Content-Type': 'application/json',
    },
    body
  );

  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      error: `MiniMax t2a_v2 failed (${response.status})`,
      code: 'PROVIDER_HTTP_ERROR',
    };
  }

  const parsed = parseSpeechResponse(response.body);
  if (!parsed.ok) return parsed;

  const filePath = await deps.writeArtifact(parsed.audioBytes, { extension: 'mp3' });
  return {
    ok: true,
    model,
    routeId: 'minimax-token-plan',
    artifacts: [{ path: filePath, mimeType: 'audio/mpeg' }],
    displayMarkdown: buildSpeechDisplayMarkdown(text, filePath),
  };
}

function buildSpeechDisplayMarkdown(text: string, filePath: string): string {
  const label = sanitizeLinkLabel(text);
  return `[${label}](${filePath})`;
}

function sanitizeLinkLabel(text: string): string {
  const cleaned = text.replace(/[\[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'speech audio';
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

function parseSpeechResponse(
  body: unknown
): { ok: true; audioBytes: Buffer } | SynthesizeSpeechResult & { ok: false } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid MiniMax speech response', code: 'PROVIDER_RESPONSE' };
  }
  const root = body as Record<string, unknown>;
  const baseResp = root.base_resp as Record<string, unknown> | undefined;
  if (baseResp && typeof baseResp.status_code === 'number' && baseResp.status_code !== 0) {
    const msg = typeof baseResp.status_msg === 'string' ? baseResp.status_msg : 'provider error';
    return {
      ok: false,
      error: `MiniMax t2a_v2 error: ${msg}`,
      code: `PROVIDER_${baseResp.status_code}`,
    };
  }
  const data = root.data as Record<string, unknown> | undefined;
  const hex = typeof data?.audio === 'string' ? data.audio : '';
  if (!hex) {
    return { ok: false, error: 'MiniMax t2a_v2 returned no audio', code: 'EMPTY_RESULT' };
  }
  try {
    return { ok: true, audioBytes: Buffer.from(hex, 'hex') };
  } catch {
    return { ok: false, error: 'Failed to decode MiniMax audio hex', code: 'PROVIDER_RESPONSE' };
  }
}

export function resolveTokenPlanSpeechRoute(): TokenPlanSpeechRoute | null {
  const accessToken = getSubscriptionSecret('minimax-token-plan');
  if (!accessToken?.trim()) return null;
  const entry = getAISubscriptionEntries().find((item) => item.id === 'minimax-token-plan');
  if (!entry || entry.status !== 'connected') return null;
  const speech = entry.capabilities.find((c) => c.capabilityId === 'speech.synthesize');
  return {
    accessToken: accessToken.trim(),
    enabled: speech?.enabled !== false,
  };
}

export async function writeSpeechArtifact(
  projectPath: string,
  bytes: Buffer,
  options: { extension: string }
): Promise<string> {
  const ext = options.extension.replace(/^\./, '') || 'mp3';
  const dir = path.join(projectPath, '.cdf', 'artifacts', 'audio');
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `speech-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
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

export function createSynthesizeSpeechDeps(projectPath: string): SynthesizeSpeechDeps {
  return {
    resolveTokenPlanSpeechRoute,
    httpPostJson: defaultHttpPostJson,
    writeArtifact: (bytes, options) => writeSpeechArtifact(projectPath, bytes, options),
  };
}

export function createSynthesizeSpeechTool(projectPath: string) {
  const deps = createSynthesizeSpeechDeps(projectPath);
  return tool(
    async (input: SynthesizeSpeechInput) => {
      const result = await synthesizeSpeech(input, deps);
      return JSON.stringify(result);
    },
    {
      name: 'synthesize_speech',
      description:
        'Synthesize speech from text using MiniMax Token Plan Speech 2.8 (speech-2.8-hd or speech-2.8-turbo only). ' +
        'Returns a local audio artifact path. Link it in your reply as [label](path) so the user can open the file. ' +
        'Prefer displayMarkdown from the tool result.',
      schema: z.object({
        text: z.string().describe('Text to speak (max 10000 characters)'),
        model: z
          .enum(['speech-2.8-hd', 'speech-2.8-turbo'])
          .optional()
          .describe('Defaults to speech-2.8-hd'),
        voice_id: z.string().optional().describe('System or cloned voice id; defaults to male-qn-qingse'),
        speed: z.number().min(0.5).max(2).optional().describe('Speech rate'),
        emotion: z
          .enum(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent'])
          .optional()
          .describe('Optional emotion (Speech 2.8)'),
        language_boost: z.string().optional().describe('Optional language boost, e.g. Chinese or auto'),
      }),
    }
  );
}
