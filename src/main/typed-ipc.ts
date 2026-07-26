import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcEventChannel,
  IpcEventPayload,
} from '../shared/ipc-contract';

// 主进程 → renderer 事件的契约包装器：channel 名限定为 IpcEventContract 的 key，
// payload 类型从契约推导。拼错通道名或传错 payload 都是编译错误（不再裸 webContents.send）。
export function typedSend<C extends IpcEventChannel>(
  webContents: WebContents,
  channel: C,
  payload: IpcEventPayload<NoInfer<C>>,
): void {
  webContents.send(channel, payload);
}

// 主进程侧契约包装器：channel 名限定为契约 key，回调参数与返回值从契约推导。
export function typedHandle<C extends IpcInvokeChannel>(
  channel: C,
  // NoInfer：泛型 C 只由 channel 字面量决定，不从 handler 反推
  //（否则契约中 result: unknown 的条目会成为反推候选，破坏其他调用点的字面量收窄）。
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeArgs<NoInfer<C>>
  ) => IpcInvokeResult<NoInfer<C>> | Promise<IpcInvokeResult<NoInfer<C>>>,
): void {
  ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
}
