import crypto from 'node:crypto';
import { BrowserWindow, net } from 'electron';
import { getOAuthCredential } from '../ai-subscription-credentials';
import { createOAuthAuthenticatedFetch } from '../ai-subscription-runtime';
import { getAISubscriptionEntries } from '../ai-subscription-store';
import db from '../database';
import { BackgroundCapabilityJobService } from './background-capability-jobs';

let service: BackgroundCapabilityJobService | null = null;

function getBackgroundCapabilityJobService(): BackgroundCapabilityJobService {
  if (service) return service;
  service = new BackgroundCapabilityJobService(db, {
    resolveProject: (projectPath) => {
      if (!projectPath) return null;
      const project = db.prepare('SELECT id, path FROM projects WHERE path = ?').get(projectPath) as
        | { id: string; path: string }
        | undefined;
      return project ?? null;
    },
    resolveRoute: () => {
      const credential = getOAuthCredential('xai-oauth');
      if (!credential?.accessToken || credential.terminalStatus) return null;
      const entry = getAISubscriptionEntries().find((item) => item.id === 'xai-oauth');
      if (!entry || entry.status !== 'connected') return null;
      const capability = entry.capabilities.find((item) => item.capabilityId === 'video.generate');
      return {
        enabled: capability?.enabled !== false,
        fetch: createOAuthAuthenticatedFetch('xai-oauth'),
      };
    },
    download: async (url) => {
      const response = await net.fetch(url);
      if (!response.ok) throw new Error(`Failed to download generated video (${response.status})`);
      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        bytes,
        mimeType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4',
      };
    },
    recordTerminal: (job) => {
      if (!job.sourceSessionId) return;
      try {
        const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(job.sourceSessionId);
        if (!session) return;
        const content = job.status === 'completed'
          ? JSON.stringify({
              type: 'capability_job_result',
              jobId: job.id,
              status: job.status,
              artifacts: job.artifacts,
              displayMarkdown: job.artifacts[0]
                ? `[generated video](${job.artifacts[0].path})`
                : undefined,
            })
          : JSON.stringify({
              type: 'capability_job_result',
              jobId: job.id,
              status: job.status,
              error: job.error,
            });
        db.prepare(
          'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(crypto.randomUUID(), job.sourceSessionId, 'assistant', content, job.updatedAt);
      } catch {
        // Conversation projection is best-effort and must not alter the durable Job result.
      }
    },
    emit: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        try {
          window.webContents.send('capability-jobs:changed', event);
        } catch {
          // A closing renderer must not affect the durable Job transition.
        }
      }
    },
  });
  return service;
}

export const backgroundCapabilityJobs = {
  submitVideo: (...args: Parameters<BackgroundCapabilityJobService['submitVideo']>) =>
    getBackgroundCapabilityJobService().submitVideo(...args),
  list: (...args: Parameters<BackgroundCapabilityJobService['list']>) =>
    getBackgroundCapabilityJobService().list(...args),
  get: (...args: Parameters<BackgroundCapabilityJobService['get']>) =>
    getBackgroundCapabilityJobService().get(...args),
  cancel: (...args: Parameters<BackgroundCapabilityJobService['cancel']>) =>
    getBackgroundCapabilityJobService().cancel(...args),
  stopTracking: (...args: Parameters<BackgroundCapabilityJobService['stopTracking']>) =>
    getBackgroundCapabilityJobService().stopTracking(...args),
  resumeTracking: (...args: Parameters<BackgroundCapabilityJobService['resumeTracking']>) =>
    getBackgroundCapabilityJobService().resumeTracking(...args),
  resubmit: (...args: Parameters<BackgroundCapabilityJobService['resubmit']>) =>
    getBackgroundCapabilityJobService().resubmit(...args),
  resumePending: () => getBackgroundCapabilityJobService().resumePending(),
};
