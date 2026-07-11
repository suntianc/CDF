import { describe, expect, it, vi } from 'vitest';

vi.mock('../database', () => ({
  default: { prepare: vi.fn(() => ({ get: vi.fn() })) },
}));
vi.mock('./background-capability-runtime', () => ({
  backgroundCapabilityJobs: {},
}));
import { createManageBackgroundJobsTool } from './manage-background-jobs-tool';

const snapshot = {
  id: 'job-1',
  projectId: 'project-1',
  type: 'video.generate' as const,
  status: 'submission_unknown' as const,
  provider: 'xai-oauth' as const,
  connectionId: 'xai-oauth' as const,
  queuePosition: null,
  relatedJobId: null,
  availableActions: ['resubmit' as const],
  artifacts: [],
  error: 'connection reset',
  statusMessage: 'submission_unknown_no_retry' as const,
  createdAt: 1,
  updatedAt: 2,
};

describe('manage_background_jobs', () => {
  it('lists renderer-safe Project snapshots', async () => {
    const list = vi.fn(() => [snapshot]);
    const tool = createManageBackgroundJobsTool('/project', {
      resolveProjectId: () => 'project-1',
      list,
      get: vi.fn(),
      command: vi.fn(),
    });

    const result = JSON.parse(String(await tool.invoke({ action: 'list' })));

    expect(result).toEqual({ ok: true, jobs: [snapshot] });
    expect(list).toHaveBeenCalledWith('project-1');
    expect(JSON.stringify(result)).not.toContain('provider_task_id');
  });

  it('routes explicit resubmission through the persistent Job command seam', async () => {
    const command = vi.fn(() => ({ ok: true as const, job: { ...snapshot, id: 'job-2', status: 'queued' as const, relatedJobId: 'job-1' } }));
    const tool = createManageBackgroundJobsTool('/project', {
      resolveProjectId: () => 'project-1',
      list: vi.fn(),
      get: vi.fn(),
      command,
    });

    const result = JSON.parse(String(await tool.invoke({ action: 'resubmit', job_id: 'job-1' })));

    expect(result).toMatchObject({ ok: true, job: { id: 'job-2', relatedJobId: 'job-1' } });
    expect(command).toHaveBeenCalledWith('project-1', 'job-1', 'resubmit');
  });
});
