export type CapabilityJobType = 'video.generate';
export type CapabilityJobStatus = 'queued' | 'running' | 'downloading' | 'completed' | 'failed';

export interface CapabilityJobArtifact {
  path: string;
  mimeType: string;
}

export interface CapabilityJobSnapshot {
  id: string;
  sourceSessionId?: string;
  projectId: string;
  type: CapabilityJobType;
  status: CapabilityJobStatus;
  provider: 'xai-oauth';
  artifacts: CapabilityJobArtifact[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
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

export interface CapabilityJobEvent {
  projectId: string;
  job: CapabilityJobSnapshot;
}
