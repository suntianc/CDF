import { describe, expect, it } from 'vitest';
import { isTransientRuntimeError } from './runtime-errors';

describe('isTransientRuntimeError', () => {
  it('treats undici stream termination as transient', () => {
    expect(isTransientRuntimeError(Object.assign(new TypeError('terminated'), { name: 'TypeError' }))).toBe(true);
  });

  it('treats connection reset as transient', () => {
    expect(isTransientRuntimeError(new Error('read ECONNRESET'))).toBe(true);
  });

  it('does not treat permanent provider misconfiguration as transient', () => {
    expect(isTransientRuntimeError(new Error('provider connection failed'))).toBe(false);
    expect(isTransientRuntimeError(new Error('Invalid API key'))).toBe(false);
  });
});
