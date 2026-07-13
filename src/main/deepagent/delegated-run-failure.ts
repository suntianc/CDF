export interface DelegatedRunFailure {
  code: string;
  message: string;
}

export function classifyDelegatedRunFailure(error: unknown): DelegatedRunFailure {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return { code: 'TIMEOUT', message };
  if (lower === 'terminated' || lower.includes('network') || lower.includes('fetch failed')) {
    return { code: 'NETWORK', message };
  }
  if (lower.includes('rate limit') || lower.includes('429')) return { code: 'RATE_LIMIT', message };
  if (lower.includes('permission') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return { code: 'PERMISSION_DENIED', message };
  }
  if (lower.includes('abort') || lower.includes('cancel') || lower.includes('interrupt')) {
    return { code: 'INTERRUPTED', message };
  }
  return { code: 'DELEGATED_RUNTIME_FAILED', message };
}
