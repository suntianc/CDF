import { describe, expect, it, vi } from 'vitest';

const { electronNetFetchMock, globalFetchMock } = vi.hoisted(() => ({
  electronNetFetchMock: vi.fn(),
  globalFetchMock: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: electronNetFetchMock },
}));

import { createGenerateVideoDeps, generateVideo } from './generate-video';

describe('generateVideo', () => {
  it('generates a Grok OAuth video, polls until done, and persists the temporary URL', async () => {
    const xaiFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'video-request-1' }), {
        status: 200,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'pending',
        progress: 35,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'done',
        video: {
          url: 'https://vidgen.x.ai/xai-video/temporary.mp4',
          duration: 6,
        },
      }), { status: 200 }));
    const downloadArtifact = vi.fn().mockResolvedValue({
      bytes: Buffer.from('mp4-bytes'),
      mimeType: 'video/mp4',
    });
    const writeArtifact = vi.fn().mockResolvedValue('/tmp/project/artifacts/grok-video.mp4');
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await generateVideo(
      {
        prompt: 'a cat playing with a ball',
        route_hint: 'xai-oauth',
        duration: 6,
        aspect_ratio: '16:9',
        resolution: '720p',
      },
      {
        resolveXaiVideoRoute: () => ({ enabled: true, fetch: xaiFetch }),
        downloadArtifact,
        writeArtifact,
        sleep,
      }
    );

    expect(result).toEqual({
      ok: true,
      model: 'grok-imagine-video',
      routeId: 'xai-oauth',
      artifacts: [{ path: '/tmp/project/artifacts/grok-video.mp4', mimeType: 'video/mp4' }],
      displayMarkdown: '[generated video](/tmp/project/artifacts/grok-video.mp4)',
    });
    expect(xaiFetch).toHaveBeenNthCalledWith(
      1,
      'https://api.x.ai/v1/videos/generations',
      expect.objectContaining({ method: 'POST' })
    );
    expect(JSON.parse(String(xaiFetch.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'grok-imagine-video',
      prompt: 'a cat playing with a ball',
      duration: 6,
      aspect_ratio: '16:9',
      resolution: '720p',
    });
    expect(xaiFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.x.ai/v1/videos/video-request-1',
      expect.objectContaining({ method: 'GET' })
    );
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(downloadArtifact).toHaveBeenCalledWith('https://vidgen.x.ai/xai-video/temporary.mp4');
    expect(writeArtifact).toHaveBeenCalledWith(Buffer.from('mp4-bytes'), { extension: 'mp4' });
  });

  it('rejects unsupported route hints with the video-specific message', async () => {
    const xaiFetch = vi.fn();
    const result = await generateVideo(
      { prompt: 'a cat playing with a ball', route_hint: 'minimax-token-plan' as any },
      {
        resolveXaiVideoRoute: () => ({ enabled: true, fetch: xaiFetch }),
        writeArtifact: vi.fn(),
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'Unsupported video route: minimax-token-plan',
      code: 'ROUTE_UNAVAILABLE',
    });
    expect(xaiFetch).not.toHaveBeenCalled();
  });

  it('downloads the temporary video through Electron transport without OAuth headers', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = globalFetchMock as typeof fetch;
    electronNetFetchMock.mockResolvedValue(new Response(Buffer.from('proxy-video'), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    }));
    globalFetchMock.mockResolvedValue(new Response(Buffer.from('global-video'), { status: 200 }));

    try {
      const deps = createGenerateVideoDeps('/tmp/project');
      const downloaded = await deps.downloadArtifact?.(
        'https://vidgen.x.ai/xai-video/temporary.mp4'
      );

      expect(downloaded).toEqual({
        bytes: Buffer.from('proxy-video'),
        mimeType: 'video/mp4',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(electronNetFetchMock).toHaveBeenCalledWith(
      'https://vidgen.x.ai/xai-video/temporary.mp4'
    );
    expect(globalFetchMock).not.toHaveBeenCalled();
  });
});
