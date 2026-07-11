import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandleMock } = vi.hoisted(() => {
  return {
    ipcHandleMock: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

import { typedCrud } from './typed-crud';

describe('typedCrud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the channel via ipcMain.handle', () => {
    typedCrud({
      channel: 'db:deleteSession',
      remove: () => {},
    });

    expect(ipcHandleMock).toHaveBeenCalledTimes(1);
    const [channel, handler] = ipcHandleMock.mock.calls[0];
    expect(channel).toBe('db:deleteSession');
    expect(typeof handler).toBe('function');
  });

  it('dispatches the remove callback with the runtime args from the IPC event', async () => {
    const remove = vi.fn();
    typedCrud({
      channel: 'db:deleteSession',
      remove,
    });

    const handler = ipcHandleMock.mock.calls[0][1];
    await handler({}, 'session-1');

    expect(remove).toHaveBeenCalledWith('session-1');
  });

  it('dispatches the read callback and surfaces its return value', async () => {
    const rows = [{ id: 'run-1' }];
    typedCrud({
      channel: 'db:getAgentRuns',
      read: () => rows as never,
    });

    const handler = ipcHandleMock.mock.calls[0][1];
    const result = await handler({}, 'session-1');
    expect(result).toBe(rows);
  });

  it('write callback returns its value to the IPC handler', async () => {
    // channel 选择只为契约类型：write 需要一个「有返回值」的通道形态。
    typedCrud({
      channel: 'db:renameProject',
      write: (id, name) => ({ id, name, updated_at: 1234 }),
    });
    const handler = ipcHandleMock.mock.calls[0][1];
    const result = await handler({}, 'proj-1', 'new-name');
    expect(result).toEqual({ id: 'proj-1', name: 'new-name', updated_at: 1234 });
  });

  it('throws at registration when no operation is provided', () => {
    expect(() =>
      typedCrud({
        channel: 'db:deleteSession',
      }),
    ).toThrow(/exactly one of read\/write\/remove, got 0/);
    expect(ipcHandleMock).not.toHaveBeenCalled();
  });

  it('throws at registration when more than one operation is provided', () => {
    expect(() =>
      typedCrud({
        channel: 'db:deleteSession',
        read: (() => undefined) as never,
        remove: () => {},
      }),
    ).toThrow(/exactly one of read\/write\/remove, got 2/);
    expect(ipcHandleMock).not.toHaveBeenCalled();
  });
});
