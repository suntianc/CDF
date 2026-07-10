import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcInvokeArgs, IpcInvokeChannel, IpcInvokeResult } from '../shared/ipc-contract';

// 主进程侧契约包装器：channel 名限定为契约 key，回调参数与返回值从契约推导。
export function typedHandle<C extends IpcInvokeChannel>(
  channel: C,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeArgs<C>
  ) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>,
): void {
  ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
}
