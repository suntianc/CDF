export const CONVERSATION_WORKING_STATE_BLOCK_REASONS = {
  ACTIVE_AGENT_RUN: 'ACTIVE_AGENT_RUN',
  ACTIVE_DELEGATED_AGENT_RUN: 'ACTIVE_DELEGATED_AGENT_RUN',
  ACTIVE_CAPABILITY_JOB: 'ACTIVE_CAPABILITY_JOB',
} as const;

export const CONVERSATION_WORKING_STATE_FAILURE_REASONS = {
  STARTUP_RECONCILIATION_FAILED: 'STARTUP_RECONCILIATION_FAILED',
  STORAGE_INSPECTION_FAILED: 'STORAGE_INSPECTION_FAILED',
  INSUFFICIENT_DISK_SPACE: 'INSUFFICIENT_DISK_SPACE',
  INTEGRITY_CHECK_FAILED: 'INTEGRITY_CHECK_FAILED',
  COMPACTION_FAILED: 'COMPACTION_FAILED',
} as const;

export type ConversationWorkingStateBlockReason =
  (typeof CONVERSATION_WORKING_STATE_BLOCK_REASONS)[keyof typeof CONVERSATION_WORKING_STATE_BLOCK_REASONS];

export type ConversationWorkingStateFailureReason =
  (typeof CONVERSATION_WORKING_STATE_FAILURE_REASONS)[keyof typeof CONVERSATION_WORKING_STATE_FAILURE_REASONS];

export type ConversationWorkingStateMaintenancePhase =
  | 'preparing'
  | 'reconciling'
  | 'checkingSpace'
  | 'rebuilding'
  | 'validating'
  | 'replacing'
  | 'reopening';

export interface ConversationWorkingStateStorageStatus {
  phase: 'normal' | 'analyzing' | 'optimizing' | 'failed';
  maintenancePhase: ConversationWorkingStateMaintenancePhase | null;
  physicalBytes: number;
  estimatedReclaimableBytes: number;
  blockedReason: ConversationWorkingStateBlockReason | null;
  failureReason: ConversationWorkingStateFailureReason | null;
}
