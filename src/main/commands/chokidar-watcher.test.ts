import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

// All hoisted variables for vi.mock factories must be declared via vi.hoisted.
const mocks = vi.hoisted(() => {
  class FakeFSWatcher extends EventEmitter {
    close = vi.fn().mockResolvedValue(undefined);
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

import { watchSystemCommandsDir, watchProjectCommandsDir, ensureProjectWatcher } from './chokidar-watcher';

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
    const stop1 = watchProjectCommandsDir('/idem/path', onChange);
    const callsBefore = mocks.chokidarMock.watch.mock.calls.length;
    ensureProjectWatcher('/idem/path');
    ensureProjectWatcher('/idem/path');
    expect(mocks.chokidarMock.watch.mock.calls.length).toBe(callsBefore);
    stop1();
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
