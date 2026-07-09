import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGenerateMusicTool,
  generateMusic,
  resolveTokenPlanMusicRoute,
  writeMusicArtifact,
} from './generate-music';

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

describe('generateMusic', () => {
  it('creates a local music artifact from MiniMax music-2.6 hex audio', async () => {
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/project/artifacts/music-1.mp3');
    const httpPostJson = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        data: { audio: Buffer.from('song', 'utf8').toString('hex'), status: 2 },
        base_resp: { status_code: 0, status_msg: 'success' },
      },
    });

    const result = await generateMusic(
      {
        prompt: 'indie folk, rainy night',
        lyrics: '[verse]\nwalking alone\n[chorus]\ncoffee shop lights',
      },
      {
        resolveTokenPlanMusicRoute: () => ({ accessToken: 'sk-token', enabled: true }),
        httpPostJson,
        writeArtifact,
      }
    );

    expect(result).toEqual({
      ok: true,
      model: 'music-2.6',
      routeId: 'minimax-token-plan',
      artifacts: [{ path: '/tmp/project/artifacts/music-1.mp3', mimeType: 'audio/mpeg' }],
      displayMarkdown: '[indie folk, rainy night](/tmp/project/artifacts/music-1.mp3)',
    });

    expect(httpPostJson).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v1/music_generation',
      expect.objectContaining({ Authorization: 'Bearer sk-token' }),
      expect.objectContaining({
        model: 'music-2.6',
        prompt: 'indie folk, rainy night',
        lyrics: '[verse]\nwalking alone\n[chorus]\ncoffee shop lights',
        stream: false,
        output_format: 'hex',
      })
    );
  });

  it('allows instrumental music without lyrics when is_instrumental is true', async () => {
    const httpPostJson = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        data: { audio: '6162', status: 2 },
        base_resp: { status_code: 0, status_msg: 'success' },
      },
    });

    const result = await generateMusic(
      { prompt: 'ambient piano', is_instrumental: true },
      {
        resolveTokenPlanMusicRoute: () => ({ accessToken: 'sk-token', enabled: true }),
        httpPostJson,
        writeArtifact: vi.fn().mockResolvedValue('/tmp/m.mp3'),
      }
    );

    expect(result.ok).toBe(true);
    expect(httpPostJson.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        model: 'music-2.6',
        is_instrumental: true,
        prompt: 'ambient piano',
      })
    );
  });

  it('requires lyrics for non-instrumental music unless lyrics_optimizer is true', async () => {
    const result = await generateMusic(
      { prompt: 'pop song' },
      {
        resolveTokenPlanMusicRoute: () => ({ accessToken: 'sk-token', enabled: true }),
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn(),
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    expect(result.error).toMatch(/lyrics/i);
  });

  it('rejects models outside the music-2.6 allowlist', async () => {
    const result = await generateMusic(
      { prompt: 'x', lyrics: 'y', model: 'music-cover' as any },
      {
        resolveTokenPlanMusicRoute: () => ({ accessToken: 'sk-token', enabled: true }),
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn(),
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MODEL_NOT_ALLOWED');
  });

  it('fails when music capability is disabled', async () => {
    const result = await generateMusic(
      { prompt: 'x', lyrics: 'y' },
      {
        resolveTokenPlanMusicRoute: () => ({ accessToken: 'sk-token', enabled: false }),
        httpPostJson: vi.fn(),
        writeArtifact: vi.fn(),
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CAPABILITY_DISABLED');
  });
});

describe('resolveTokenPlanMusicRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEntriesMock.mockReturnValue([]);
    getSecretMock.mockReturnValue(undefined);
  });

  it('returns enabled route when music.generate is on', () => {
    getSecretMock.mockReturnValue('sk-sub');
    getEntriesMock.mockReturnValue([
      {
        id: 'minimax-token-plan',
        displayName: 'MiniMax Token Plan',
        status: 'connected',
        usageSummaries: [],
        capabilities: [
          {
            capabilityId: 'music.generate',
            label: 'Music generation',
            enabled: true,
            switchDisabled: false,
            availability: 'available',
          },
        ],
      },
    ]);
    expect(resolveTokenPlanMusicRoute()).toEqual({ accessToken: 'sk-sub', enabled: true });
  });
});

describe('writeMusicArtifact', () => {
  let tempProject: string;
  beforeEach(() => {
    tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-music-'));
  });
  afterEach(() => {
    fs.rmSync(tempProject, { recursive: true, force: true });
  });

  it('writes under project .cdf/artifacts/audio', async () => {
    const filePath = await writeMusicArtifact(tempProject, Buffer.from('mp3'), { extension: 'mp3' });
    expect(filePath.startsWith(path.join(tempProject, '.cdf', 'artifacts', 'audio'))).toBe(true);
  });
});

describe('createGenerateMusicTool', () => {
  it('exposes generate_music tool for music-2.6 only', () => {
    const musicTool = createGenerateMusicTool('/tmp/project');
    expect(musicTool.name).toBe('generate_music');
    expect(musicTool.description).toMatch(/music-2\.6/i);
  });
});
