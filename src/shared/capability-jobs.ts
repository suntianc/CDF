export type CapabilityJobType = 'video.generate';
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

export interface CapabilityJobArtifact {
  path: string;
  mimeType: string;
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
  provider: 'xai-oauth';
  connectionId: 'xai-oauth';
  queuePosition: number | null;
  relatedJobId: string | null;
  availableActions: CapabilityJobAction[];
  artifacts: CapabilityJobArtifact[];
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
