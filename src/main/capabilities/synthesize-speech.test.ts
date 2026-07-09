import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSynthesizeSpeechTool,
  resolveTokenPlanSpeechRoute,
  synthesizeSpeech,
  writeSpeechArtifact,
} from './synthesize-speech';

const { getEntriesMock, getSecretMock } = vi.hoisted(() => ({
  getEntriesMock: vi.fn(),
  getSecretMock: vi.fn(),
}));

vi.mock('../ai-subscription-store', () => ({
  getAISubscriptionEntries: getEntriesMock,
}));

vi.mock('../ai-subscription-credentials', () => ({
  getSubscriptionSecret: getSecretMock,
}));

function connectedSpeechRoute(enabled = true) {
  return {
    id: 'minimax-token-plan' as const,
    displayName: 'MiniMax Token Plan',
    status: 'connected' as const,
    usageSummaries: [],
    capabilities: [
      {
        capabilityId: 'speech.synthesize' as const,
        label: 'Speech generation',
        enabled,
        switchDisabled: false,
        availability: enabled ? ('available' as const) : ('disabled' as const),
      },
    ],
  };
}

describe('synthesizeSpeech', () => {
  it('creates a local audio artifact from MiniMax Speech 2.8 hex audio', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/project/artifacts/speech-1.mp3');
    // hex for "hi"
    const httpPostJson = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        data: { audio: Buffer.from('hi', 'utf8').toString('hex'), status: 2 },
        base_resp: { status_code: 0, status_msg: 'success' },
      },
    });

    const result = await synthesizeSpeech(
      { text: '你好，世界' },
      {
        resolveTokenPlanSpeechRoute: () => ({ accessToken: 'sk-token', enabled: true }),
        httpPostJson,
        writeArtifact,
      }
    );

    expect(result).toEqual({
      ok: true,
      model: 'speech-2.8-hd',
      routeId: 'minimax-token-plan',
      artifacts: [{ path: '/tmp/project/artifacts/speech-1.mp3', mimeType: 'audio/mpeg' }],
      displayMarkdown: '[你好，世界](/tmp/project/artifacts/speech-1.mp3)',
    });

    expect(httpPostJson).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v1/t2a_v2',
      expect.objectContaining({ Authorization: 'Bearer sk-token' }),
      expect.objectContaining({
        model: 'speech-2.8-hd',
        text: '你好，世界',
        stream: false,
        output_format: 'hex',
        voice_setting: expect.objectContaining({ voice_id: 'male-qn-qingse' }),
      })
    );
    expect(writeArtifact).toHaveBeenCalledWith(
      Buffer.from('hi', 'utf8'),
      expect.objectContaining({ extension: 'mp3' })
    );
  });

  it('allows speech-2.8-turbo from the Token Plan allowlist', async () => {
    const httpPostJson = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        data: { audio: '6162', status: 2 },
        base_resp: { status_code: 0, status_msg: 'success' },
      },
    });

    await synthesizeSpeech(
      { text: 'fast', model: 'speech-2.8-turbo' },
      {
        resolveTokenPlanSpeechRoute: () => ({ accessToken: 'sk-token', enabled: true }),
        httpPostJson,
        writeArtifact: vi.fn().mockResolvedValue('/tmp/a.mp3'),
      }
    );

    expect(httpPostJson.mock.calls[0][2]).toEqual(
      expect.objectContaining({ model: 'speech-2.8-turbo' })
    );
  });

  it('rejects models outside the Speech 2.8 allowlist', async () => {
    const httpPostJson = vi.fn();
    const result = await synthesizeSpeech(
      { text: 'x', model: 'speech-2.6-hd' as any },
      {
        resolveTokenPlanSpeechRoute: () => ({ accessToken: 'sk-token', enabled: true }),
        httpPostJson,
        writeArtifact: vi.fn(),
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MODEL_NOT_ALLOWED');
    expect(httpPostJson).not.toHaveBeenCalled();
  });

  it('fails when speech capability is disabled', async () => {
    const httpPostJson = vi.fn();
    const result = await synthesizeSpeech(
      { text: 'x' },
      {
        resolveTokenPlanSpeechRoute: () => ({ accessToken: 'sk-token', enabled: false }),
        httpPostJson,
        writeArtifact: vi.fn(),
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CAPABILITY_DISABLED');
  });

  it('fails when Token Plan is not connected', async () => {
    const result = await synthesizeSpeech(
      { text: 'x' },
      {
        resolveTokenPlanSpeechRoute: () => null,
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn(),
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ROUTE_UNAVAILABLE');
  });
});

describe('resolveTokenPlanSpeechRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEntriesMock.mockReturnValue([]);
    getSecretMock.mockReturnValue(undefined);
  });

  it('returns enabled route when speech.synthesize is on', () => {
    getSecretMock.mockReturnValue('sk-sub');
    getEntriesMock.mockReturnValue([connectedSpeechRoute(true)]);
    expect(resolveTokenPlanSpeechRoute()).toEqual({ accessToken: 'sk-sub', enabled: true });
  });

  it('returns enabled:false when speech.synthesize is off', () => {
    getSecretMock.mockReturnValue('sk-sub');
    getEntriesMock.mockReturnValue([connectedSpeechRoute(false)]);
    expect(resolveTokenPlanSpeechRoute()).toEqual({ accessToken: 'sk-sub', enabled: false });
  });
});

describe('writeSpeechArtifact', () => {
  let tempProject: string;
  beforeEach(() => {
    tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-speech-'));
  });
  afterEach(() => {
    fs.rmSync(tempProject, { recursive: true, force: true });
  });

  it('writes under project .cdf/artifacts/audio', async () => {
    const filePath = await writeSpeechArtifact(tempProject, Buffer.from('mp3'), { extension: 'mp3' });
    expect(filePath.startsWith(path.join(tempProject, '.cdf', 'artifacts', 'audio'))).toBe(true);
    expect(fs.readFileSync(filePath)).toEqual(Buffer.from('mp3'));
  });
});

describe('createSynthesizeSpeechTool', () => {
  it('exposes synthesize_speech tool', () => {
    const speechTool = createSynthesizeSpeechTool('/tmp/project');
    expect(speechTool.name).toBe('synthesize_speech');
    expect(speechTool.description).toMatch(/speech-2\.8/i);
  });
});
