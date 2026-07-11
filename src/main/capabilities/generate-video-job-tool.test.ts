import { beforeEach, describe, expect, it, vi } from 'vitest';

const { submitVideo } = vi.hoisted(() => ({ submitVideo: vi.fn() }));

vi.mock('./background-capability-runtime', () => ({
  backgroundCapabilityJobs: { submitVideo },
}));

import { createGenerateVideoJobTool } from './generate-video-job-tool';

describe('createGenerateVideoJobTool', () => {
  beforeEach(() => {
    submitVideo.mockReset();
    submitVideo.mockResolvedValue({
      ok: true,
      jobId: 'job-stable-1',
      type: 'video.generate',
      status: 'queued',
    });
  });

  it('returns the CDF Job Receipt without waiting for background completion', async () => {
    const tool = createGenerateVideoJobTool('/project', 'session-1');

    const raw = await tool.invoke({
      mode: 'text',
      prompt: 'a cat playing with a ball',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '720p',
    });

    expect(JSON.parse(String(raw))).toEqual({
      ok: true,
      jobId: 'job-stable-1',
      type: 'video.generate',
      status: 'queued',
    });
    expect(submitVideo).toHaveBeenCalledWith({
      mode: 'text',
      prompt: 'a cat playing with a ball',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '720p',
    }, '/project', 'session-1');
  });

  it('requires an explicit text or first-frame mode with provider-neutral image roles', async () => {
    const tool = createGenerateVideoJobTool('/project', 'session-1');

    await expect(tool.invoke({
      mode: 'first-frame',
      prompt: 'animate the opening frame',
      images: [{ role: 'first-frame', source: '/project/opening.png' }],
      route_hint: 'xai-oauth',
    })).resolves.toBeTruthy();
    await expect(tool.invoke({
      prompt: 'implicit mode',
    } as never)).rejects.toThrow();
    expect(submitVideo).toHaveBeenLastCalledWith({
      mode: 'first-frame',
      prompt: 'animate the opening frame',
      images: [{ role: 'first-frame', source: '/project/opening.png' }],
      route_hint: 'xai-oauth',
    }, '/project', 'session-1');
  });
});
