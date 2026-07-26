import { describe, expect, it } from 'vitest';
import { classifyDelegatedRunFailure } from './delegated-run-failure';

describe('classifyDelegatedRunFailure', () => {
  it.each([
    ['Request timed out after 60s', 'TIMEOUT'],
    ['fetch failed: socket hang up', 'NETWORK'],
    ['terminated', 'NETWORK'],
    ['429 rate limit exceeded', 'RATE_LIMIT'],
    ['permission denied for tool bash', 'PERMISSION_DENIED'],
    ['Unauthorized: invalid API key', 'PERMISSION_DENIED'],
    ['The operation was aborted', 'INTERRUPTED'],
    ['Delegated tool approval is not available for this run', 'DELEGATED_RUNTIME_FAILED'],
    ['something unexpected exploded', 'DELEGATED_RUNTIME_FAILED'],
  ])('classifies "%s" as %s', (message, code) => {
    expect(classifyDelegatedRunFailure(new Error(message))).toEqual({ code, message });
  });

  it('stringifies non-Error failures and keeps the default code', () => {
    expect(classifyDelegatedRunFailure('boom')).toEqual({
      code: 'DELEGATED_RUNTIME_FAILED',
      message: 'boom',
    });
  });
});
