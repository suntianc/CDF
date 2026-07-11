import { BrowserWindow, net } from 'electron';
import { getOAuthCredential } from '../ai-subscription-credentials';
import { createOAuthAuthenticatedFetch } from '../ai-subscription-runtime';
import { getAISubscriptionEntries } from '../ai-subscription-store';
import db from '../database';
import { BackgroundCapabilityJobService } from './background-capability-jobs';
import {
  CapabilityJobContinuationCoordinator,
  type CapabilityJobContinuationBatch,
} from './capability-job-continuations';

let service: BackgroundCapabilityJobService | null = null;
let continuationCoordinator: CapabilityJobContinuationCoordinator | null = null;
let continuationRunner = async (_batch: CapabilityJobContinuationBatch): Promise<void> => {
  throw new Error('Background Job continuation runner is not configured');
};

function emitCapabilityJob(projectId: string, jobId: string): void {
  const job = getBackgroundCapabilityJobService().get(projectId, jobId);
  if (!job) return;
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      window.webContents.send('capability-jobs:changed', { projectId, job });
    } catch {
      // A closing renderer must not affect durable continuation state.
    }
  }
}

function emitConversationMessagesChanged(sessionId: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      window.webContents.send('conversation:messages-changed', { sessionId });
    } catch {
      // A closing renderer must not affect durable Timeline state.
    }
  }
}

function getContinuationCoordinator(): CapabilityJobContinuationCoordinator {
  if (continuationCoordinator) return continuationCoordinator;
  continuationCoordinator = new CapabilityJobContinuationCoordinator(db, {
    runContinuation: (batch) => continuationRunner(batch),
    onStateChanged: emitCapabilityJob,
    onTimelineChanged: emitConversationMessagesChanged,
  });
  return continuationCoordinator;
}

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
    recordTerminal: (job) => getContinuationCoordinator().enqueue(job),
    emit: (event) => emitCapabilityJob(event.projectId, event.job.id),
  });
  return service;
}

export function configureCapabilityJobContinuationRunner(
  runner: (batch: CapabilityJobContinuationBatch) => Promise<void>
): void {
  continuationRunner = runner;
}

export const backgroundCapabilityContinuations = {
  notifyConversationIdle: (sessionId: string) =>
    getContinuationCoordinator().notifyConversationIdle(sessionId),
  listProjectStates: (projectId: string) =>
    getContinuationCoordinator().listProjectStates(projectId),
  resumePending: () => getContinuationCoordinator().resumePending(),
};

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
