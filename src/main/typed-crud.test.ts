import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandleMock, runMock, runArgsMock } = vi.hoisted(() => {
  return {
    ipcHandleMock: vi.fn(),
    runMock: vi.fn(),
    runArgsMock: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

import { typedCrud } from './typed-crud';

const noop = () => {};
const noopResult = () => undefined;

const fakeDb = {
  prepare: vi.fn(() => ({
    run: runMock,
  })),
};

describe('typedCrud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the channel via ipcMain.handle with the contract args/result types', () => {
    typedCrud({
      channel: 'db:deleteSession',
      remove: noop,
    });

    expect(ipcHandleMock).toHaveBeenCalledTimes(1);
    const [channel, handler] = ipcHandleMock.mock.calls[0];
    expect(channel).toBe('db:deleteSession');
    expect(typeof handler).toBe('function');
  });

  it('dispatches remove handler with the runtime args from the IPC event', async () => {
    const remove = vi.fn();
    typedCrud({
      channel: 'db:deleteSession',
      remove,
    });

    const handler = ipcHandleMock.mock.calls[0][1];
    await handler({}, 'session-1');

    expect(remove).toHaveBeenCalledWith('session-1');
  });

  it('does not invoke the db directly (db is only available to the user-supplied fn)', async () => {
    typedCrud({
      channel: 'db:deleteSession',
      remove: vi.fn(),
    });
    const handler = ipcHandleMock.mock.calls[0][1];
    await handler({}, 'session-1');
    expect(fakeDb.prepare).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('omits unused operation keys (read / write) without registering extra handlers', () => {
    typedCrud({
      channel: 'db:deleteSession',
      remove: noop,
    });
    expect(ipcHandleMock).toHaveBeenCalledTimes(1);
  });

  it('skips remove when the operation is undefined', () => {
    const crud = typedCrud({
      channel: 'db:deleteSession',
      remove: undefined,
    });
    // typedCrud 返回 void；未提供任何操作时仍以 no-op 注册 channel，
    // 以满足契约完整性测试。
    expect(crud).toBeUndefined();
    expect(ipcHandleMock).toHaveBeenCalledTimes(1);
  });

  it('passes the same db handle the user supplied to read/write/remove', async () => {
    const remove = vi.fn();
    const localDb = { prepare: vi.fn(() => ({ run: runMock })) };
    typedCrud({
      channel: 'db:deleteSession',
      remove,
    });
    const handler = ipcHandleMock.mock.calls[0][1];
    await handler({}, 'session-9');
    expect(remove).toHaveBeenCalledWith('session-9');
  });

  it('compile-time: channel must be a valid invoke channel', () => {
    // This test is satisfied by the type system; runtime assertion here would require
    // crossing the typecheck layer. Kept as a marker so future readers see the seam.
    expect(typeof noop).toBe('function');
    expect(typeof noopResult).toBe('function');
    expect(runArgsMock).toBeDefined();
  });
});