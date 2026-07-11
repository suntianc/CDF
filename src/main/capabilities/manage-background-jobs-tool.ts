import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CapabilityJobAction, CapabilityJobCommandResult, CapabilityJobSnapshot } from '../../shared/capability-jobs';
import db from '../database';
import { backgroundCapabilityJobs } from './background-capability-runtime';

interface ManageBackgroundJobsDeps {
  resolveProjectId: (projectPath: string) => string | null;
  list: (projectId: string) => CapabilityJobSnapshot[];
  get: (projectId: string, jobId: string) => CapabilityJobSnapshot | null;
  command: (projectId: string, jobId: string, action: CapabilityJobAction) => CapabilityJobCommandResult;
}

const defaultDeps: ManageBackgroundJobsDeps = {
  resolveProjectId: (projectPath) => {
    const row = db.prepare('SELECT id FROM projects WHERE path = ?').get(projectPath) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  },
  list: (projectId) => backgroundCapabilityJobs.list(projectId),
  get: (projectId, jobId) => backgroundCapabilityJobs.get(projectId, jobId),
  command: (projectId, jobId, action) => {
    switch (action) {
      case 'cancel': return backgroundCapabilityJobs.cancel(projectId, jobId);
      case 'stop_tracking': return backgroundCapabilityJobs.stopTracking(projectId, jobId);
      case 'resume_tracking': return backgroundCapabilityJobs.resumeTracking(projectId, jobId);
      case 'resubmit': return backgroundCapabilityJobs.resubmit(projectId, jobId);
    }
  },
};

export function createManageBackgroundJobsTool(
  projectPath: string,
  deps: ManageBackgroundJobsDeps = defaultDeps
) {
  return tool(
    async ({ action, job_id }) => {
      const projectId = deps.resolveProjectId(projectPath);
      if (!projectId) return JSON.stringify({ ok: false, error: 'Project not found', code: 'PROJECT_NOT_FOUND' });
      if (action === 'list') return JSON.stringify({ ok: true, jobs: deps.list(projectId) });
      if (!job_id) return JSON.stringify({ ok: false, error: 'job_id is required', code: 'INVALID_INPUT' });
      if (action === 'get') {
        const job = deps.get(projectId, job_id);
        return JSON.stringify(job
          ? { ok: true, job }
          : { ok: false, error: 'Background Job not found', code: 'NOT_FOUND' });
      }
      return JSON.stringify(deps.command(projectId, job_id, action));
    },
    {
      name: 'manage_background_jobs',
      description:
        'List or inspect Project background jobs, cancel queued work, stop/resume local tracking, ' +
        'or explicitly resubmit an unknown provider submission. Resubmission can create a duplicate charge.',
      schema: z.object({
        action: z.enum(['list', 'get', 'cancel', 'stop_tracking', 'resume_tracking', 'resubmit']),
        job_id: z.string().optional(),
      }),
    }
  );
}
