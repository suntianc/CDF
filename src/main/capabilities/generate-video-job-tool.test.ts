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
      prompt: 'a cat playing with a ball',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '720p',
    }, '/project', 'session-1');
  });
});
