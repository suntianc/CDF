import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// All hoisted variables for vi.mock factories must be declared via vi.hoisted.
// Note: FakeFSWatcher is a plain class (not extending EventEmitter) to avoid
// the `Cannot access '__vi_import_0__' before initialization` error from
// vitest's module hoisting conflicting with Node's `events` import order.
const mocks = vi.hoisted(() => {
  class FakeFSWatcher {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    close = vi.fn().mockResolvedValue(undefined);
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event)!.push(listener);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      const ls = this.listeners.get(event) ?? [];
      for (const l of ls) l(...args);
    }
    removeAllListeners() {
      this.listeners.clear();
    }
  }
  const fakeWatchInstances: FakeFSWatcher[] = [];
  const chokidarMock = {
    watch: vi.fn((_p: string, _opts: unknown) => {
      const w = new FakeFSWatcher();
      fakeWatchInstances.push(w);
      return w;
    }),
  };
  const sendMock = vi.fn();
  const browserWindowMock = vi.fn(() => ({ webContents: { send: sendMock } }));
  return { FakeFSWatcher, fakeWatchInstances, chokidarMock, sendMock, browserWindowMock };
});

vi.mock('chokidar', () => ({
  default: mocks.chokidarMock,
  watch: mocks.chokidarMock.watch,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [mocks.browserWindowMock()],
  },
}));

vi.mock('../logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { watchSystemCommandsDir, watchProjectCommandsDir, ensureProjectWatcher, __resetDegradedForTests } from './chokidar-watcher';

describe('chokidar-watcher', () => {
  beforeEach(() => {
    mocks.fakeWatchInstances.length = 0;
    mocks.sendMock.mockClear();
    mocks.browserWindowMock.mockClear();
    mocks.chokidarMock.watch.mockClear();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

  it('fires on add event after debounce', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const stop = watchSystemCommandsDir(onChange);
    expect(mocks.fakeWatchInstances).toHaveLength(1);
    mocks.fakeWatchInstances[0].emit('add', '/some/path/test.md');
    await new Promise((r) => setTimeout(r, 150));
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('fires on change event after debounce', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const stop = watchSystemCommandsDir(onChange);
    mocks.fakeWatchInstances[0].emit('change', '/some/path/test.md');
    await new Promise((r) => setTimeout(r, 150));
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('fires on unlink event after debounce', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const stop = watchSystemCommandsDir(onChange);
    mocks.fakeWatchInstances[0].emit('unlink', '/some/path/test.md');
    await new Promise((r) => setTimeout(r, 150));
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('debounces a burst of events into a single onChange call', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const stop = watchSystemCommandsDir(onChange);
    mocks.fakeWatchInstances[0].emit('add', '/a.md');
    mocks.fakeWatchInstances[0].emit('change', '/a.md');
    mocks.fakeWatchInstances[0].emit('change', '/a.md');
    mocks.fakeWatchInstances[0].emit('unlink', '/a.md');
    mocks.fakeWatchInstances[0].emit('add', '/b.md');
    await new Promise((r) => setTimeout(r, 150));
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('passes awaitWriteFinish options to chokidar.watch (stabilityThreshold 200)', () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const stop = watchSystemCommandsDir(onChange);
    expect(mocks.chokidarMock.watch).toHaveBeenCalledWith(
      expect.stringContaining('.cdf/commands'),
      expect.objectContaining({
        awaitWriteFinish: expect.objectContaining({ stabilityThreshold: 200 }),
        depth: 0,
        ignoreInitial: true,
        usePolling: false,
      })
    );
    stop();
  });

  it('sends commands:changed to all windows after debounce (D-13 IPC push channel)', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const stop = watchSystemCommandsDir(onChange);
    mocks.fakeWatchInstances[0].emit('add', '/a.md');
    await new Promise((r) => setTimeout(r, 150));
    expect(mocks.sendMock).toHaveBeenCalledWith('commands:changed', { source: 'chokidar' });
    stop();
  });

  it('logs error on chokidar error event but does not crash (D-24)', () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const stop = watchSystemCommandsDir(onChange);
    expect(() => mocks.fakeWatchInstances[0].emit('error', new Error('fs failure'))).not.toThrow();
    stop();
  });

  it('does not crash when onChange callback rejects (catch + log)', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('callback failed'));
    const stop = watchSystemCommandsDir(onChange);
    mocks.fakeWatchInstances[0].emit('add', '/a.md');
    await new Promise((r) => setTimeout(r, 150));
    expect(mocks.sendMock).toHaveBeenCalledWith('commands:changed', { source: 'chokidar' });
    stop();
  });

  it('watchProjectCommandsDir watches project .cdf/commands', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const stop = watchProjectCommandsDir('/my/project', onChange);
    expect(mocks.chokidarMock.watch).toHaveBeenCalledWith(
      expect.stringContaining('/my/project/.cdf/commands'),
      expect.any(Object)
    );
    mocks.fakeWatchInstances[mocks.fakeWatchInstances.length - 1].emit('add', '/my/project/.cdf/commands/x.md');
    await new Promise((r) => setTimeout(r, 150));
    expect(onChange).toHaveBeenCalled();
    stop();
  });

  it('ensureProjectWatcher is idempotent for the same path (does not duplicate watchers)', () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    // First call sets currentProjectPath = '/idem/path' and creates a watcher.
    ensureProjectWatcher('/idem/path');
    const callsBefore = mocks.chokidarMock.watch.mock.calls.length;
    // Subsequent calls with the same path should be no-ops.
    ensureProjectWatcher('/idem/path');
    ensureProjectWatcher('/idem/path');
    expect(mocks.chokidarMock.watch.mock.calls.length).toBe(callsBefore);
  });

  it('ensureProjectWatcher restarts watcher on path change', () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const stop1 = watchProjectCommandsDir('/first/path', onChange);
    const callsBefore = mocks.chokidarMock.watch.mock.calls.length;
    ensureProjectWatcher('/second/path');
    expect(mocks.chokidarMock.watch.mock.calls.length).toBe(callsBefore + 1);
    stop1();
  });
});

// ===== Phase 8 — D-16 + D-19: chokidar fallback + no retry =====
describe('Phase 8 chokidar fallback (D-16..D-19)', () => {
  // The `degraded` flag is module-scope. Use the test-only reset hook so
  // each test starts with a clean `degraded = false` and the D-19 no-retry
  // assertion is meaningful. Also clear sendMock (sibling describe has its
  // own beforeEach, so the outer one does NOT clear it for us).
  beforeEach(() => {
    mocks.sendMock.mockClear();
    mocks.chokidarMock.watch.mockClear();
    __resetDegradedForTests();
  });

  it('D-16: emits "commands:fallback" IPC + readdir one-shot when chokidar.watch throws', () => {
    mocks.chokidarMock.watch.mockImplementationOnce(() => {
      throw new Error('EPERM: operation not permitted');
    });

    // Must trigger degradeAndFallback on sync failure
    const stop = watchSystemCommandsDir(vi.fn().mockResolvedValue(undefined));

    // commands:fallback event emitted
    expect(mocks.sendMock).toHaveBeenCalledWith(
      'commands:fallback',
      expect.objectContaining({ scope: 'system', error: expect.stringContaining('EPERM') })
    );
    // stop function is no-op (per degradeAndFallback)
    expect(typeof stop).toBe('function');
  });

  it('D-19: does not retry after degraded — second chokidar.watch call returns no-op', () => {
    // First call degrades
    mocks.chokidarMock.watch.mockImplementationOnce(() => {
      throw new Error('first failure');
    });
    watchSystemCommandsDir(vi.fn().mockResolvedValue(undefined));
    expect(mocks.sendMock).toHaveBeenCalledTimes(1);

    // Second call (after degraded flag set) should still throw inside chokidar.watch
    // (mock throw bypasses degraded-flag check because the throw is in chokidar.watch
    // itself, not in degradeAndFallback). But degradeAndFallback is guarded by the
    // `degraded` flag and will NOT emit a second commands:fallback IPC.
    mocks.chokidarMock.watch.mockImplementationOnce(() => {
      throw new Error('second failure');
    });
    const callsBefore = mocks.sendMock.mock.calls.length;
    watchSystemCommandsDir(vi.fn().mockResolvedValue(undefined));
    // sendMock calls count must NOT increase (degraded flag prevents re-emit)
    expect(mocks.sendMock.mock.calls.length).toBe(callsBefore);
  });
});
