import { z } from 'zod';

export type CapabilityJobType = 'video.generate';
export type CapabilityJobProvider = 'xai-oauth' | 'minimax-token-plan';
export type VideoGenerationMode = 'text' | 'first-frame';

export type CapabilityJobStatus =
  | 'queued'
  | 'submission_pending'
  | 'submission_unknown'
  | 'submitted'
  | 'running'
  | 'downloading'
  | 'blocked'
  | 'tracking_stopped'
  | 'completed'
  | 'failed'
  | 'canceled';

export const CapabilityJobArtifactSchema = z.object({
  path: z.string(),
  mimeType: z.string(),
});
export type CapabilityJobArtifact = z.infer<typeof CapabilityJobArtifactSchema>;

export const CapabilityJobTimelineEventSchema = z.object({
  type: z.literal('capability_job_event'),
  eventId: z.string(),
  jobId: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  status: z.enum(['completed', 'failed']),
  provider: z.enum(['xai-oauth', 'minimax-token-plan']).optional(),
  mode: z.enum(['text', 'first-frame']).optional(),
  artifacts: z.array(CapabilityJobArtifactSchema),
  error: z.string().nullable(),
});
export type CapabilityJobTimelineEvent = z.infer<typeof CapabilityJobTimelineEventSchema>;

export interface CapabilityJobInputSummary {
  mode: VideoGenerationMode;
  duration?: number;
  resolution?: string;
  firstFrame?: {
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    sizeBytes: number;
    width: number;
    height: number;
    aspectRatio: string;
    sha256: string;
  };
}

export type CapabilityJobAction =
  | 'cancel'
  | 'stop_tracking'
  | 'resume_tracking'
  | 'resubmit';

export type CapabilityJobStatusMessage =
  | 'waiting_connection_slot'
  | 'tracking_stopped_remote_continues'
  | 'explicit_resubmission_risk'
  | 'submission_unknown_no_retry'
  | 'route_blocked_no_fallback'
  | 'submitting_once'
  | 'provider_task_submitted'
  | 'temporary_provider_error'
  | 'reconnect_same_connection'
  | 'provider_preparing'
  | 'provider_queueing'
  | 'provider_processing'
  | 'downloading_provider_result'
  | 'temporary_download_error'
  | 'artifact_durable'
  | 'job_failed';

export type CapabilityJobContinuationStatus =
  | 'pending'
  | 'running'
  | 'failed'
  | 'consumed';

export interface CapabilityJobSnapshot {
  id: string;
  sourceSessionId?: string;
  projectId: string;
  type: CapabilityJobType;
  status: CapabilityJobStatus;
  provider: CapabilityJobProvider;
  connectionId: CapabilityJobProvider;
  queuePosition: number | null;
  relatedJobId: string | null;
  availableActions: CapabilityJobAction[];
  artifacts: CapabilityJobArtifact[];
  inputSummary?: CapabilityJobInputSummary;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  statusMessage: CapabilityJobStatusMessage | null;
  continuationStatus: CapabilityJobContinuationStatus | null;
  continuationError: string | null;
}

export interface CapabilityJobReceipt {
  ok: true;
  jobId: string;
  type: CapabilityJobType;
  status: 'queued';
}

export type CapabilityJobSubmissionResult =
  | CapabilityJobReceipt
  | { ok: false; error: string; code?: string };

export type CapabilityJobCommandResult =
  | { ok: true; job: CapabilityJobSnapshot }
  | { ok: false; error: string; code: string };

export interface CapabilityJobEvent {
  projectId: string;
  job: CapabilityJobSnapshot;
}
