import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BrowserWindow, net } from 'electron';
import { getOAuthCredential, getSubscriptionSecret } from '../ai-subscription-credentials';
import { createOAuthAuthenticatedFetch } from '../ai-subscription-runtime';
import { getAISubscriptionEntries } from '../ai-subscription-store';
import db from '../database';
import log from '../logger';
import {
  BackgroundCapabilityJobService,
  createMiniMaxAuthenticatedFetch,
} from './background-capability-jobs';
import {
  CapabilityJobContinuationCoordinator,
  type CapabilityJobContinuationBatch,
} from './capability-job-continuations';
import { decodeVideoInputImage } from './video-input-snapshot';

let service: BackgroundCapabilityJobService | null = null;
let continuationCoordinator: CapabilityJobContinuationCoordinator | null = null;
let retentionMaintenanceTimer: NodeJS.Timeout | null = null;
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

function resolveXaiVideoRoute() {
  const credential = getOAuthCredential('xai-oauth');
  if (!credential?.accessToken || credential.terminalStatus) return null;
  const entry = getAISubscriptionEntries().find((item) => item.id === 'xai-oauth');
  if (!entry || entry.status !== 'connected') return null;
  const capability = entry.capabilities.find((item) => item.capabilityId === 'video.generate');
  return {
    id: 'xai-oauth' as const,
    enabled: capability?.enabled !== false,
    fetch: createOAuthAuthenticatedFetch('xai-oauth'),
  };
}

function resolveMiniMaxVideoRoute() {
  const subscriptionKey = getSubscriptionSecret('minimax-token-plan')?.trim();
  if (!subscriptionKey) return null;
  const entry = getAISubscriptionEntries().find((item) => item.id === 'minimax-token-plan');
  if (!entry || entry.status !== 'connected') return null;
  const capability = entry.capabilities.find((item) => item.capabilityId === 'video.generate');
  const transport: typeof fetch = (url, init) =>
    net.fetch(url instanceof URL ? url.toString() : url, init);
  const authenticatedFetch = createMiniMaxAuthenticatedFetch(subscriptionKey, transport);
  return {
    id: 'minimax-token-plan' as const,
    enabled: capability?.enabled !== false,
    fetch: authenticatedFetch,
  };
}

function isPrivateNetworkAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (isIP(value) === 4) {
    const [a, b, c] = value.split('.').map(Number);
    return a === 10
      || a === 127
      || a === 0
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  if (isIP(value) === 6) {
    const mappedSuffix = value.match(/^::ffff:(.+)$/)?.[1];
    if (mappedSuffix) {
      if (mappedSuffix.includes('.')) return isPrivateNetworkAddress(mappedSuffix);
      const [high, low] = mappedSuffix.split(':').map((part) => Number.parseInt(part, 16));
      if (Number.isInteger(high) && Number.isInteger(low)) {
        return isPrivateNetworkAddress([
          high >>> 8,
          high & 0xff,
          low >>> 8,
          low & 0xff,
        ].join('.'));
      }
      return true;
    }
    const first = Number.parseInt(value.split(':')[0] || '0', 16);
    const globallyRoutable = first >= 0x2000 && first <= 0x3fff;
    return !globallyRoutable || value.startsWith('2001:db8:');
  }
  return true;
}

async function assertPublicInputUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('First-frame URL must use http or https');
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
    throw new Error('First-frame URL must resolve only to public network addresses');
  }
}

async function fetchPublicInput(
  input: string | URL | Request,
  init?: RequestInit,
  redirectsRemaining = 5
): Promise<Response> {
  const current = input instanceof URL
    ? input
    : new URL(typeof input === 'string' ? input : input.url);
  await assertPublicInputUrl(current);
  const response = await net.fetch(current.toString(), { ...init, redirect: 'manual' });
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;
  if (redirectsRemaining === 0) throw new Error('First-frame URL redirected too many times');
  const location = response.headers.get('location');
  if (!location) throw new Error('First-frame URL redirect is missing a location');
  await response.body?.cancel();
  return fetchPublicInput(new URL(location, current), init, redirectsRemaining - 1);
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
    resolveRoute: (connectionId) => {
      if (connectionId === 'xai-oauth') return resolveXaiVideoRoute();
      if (connectionId === 'minimax-token-plan') return resolveMiniMaxVideoRoute();
      const routes = [resolveXaiVideoRoute(), resolveMiniMaxVideoRoute()].filter(
        (route): route is NonNullable<typeof route> => route !== null
      );
      return routes.find((route) => route.enabled) ?? routes[0] ?? null;
    },
    fetchInput: fetchPublicInput,
    decodeInputImage: decodeVideoInputImage,
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

export function startBackgroundCapabilityJobMaintenance(): void {
  if (retentionMaintenanceTimer) return;
  const cleanup = () => {
    void getBackgroundCapabilityJobService().cleanupExpired().catch((error: unknown) => {
      log.warn('[capability-jobs] Retention maintenance failed:', error);
    });
  };
  cleanup();
  retentionMaintenanceTimer = setInterval(cleanup, 24 * 60 * 60 * 1_000);
  retentionMaintenanceTimer.unref();
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
  cleanupExpired: () => getBackgroundCapabilityJobService().cleanupExpired(),
};
