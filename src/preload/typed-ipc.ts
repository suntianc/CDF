import { ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcEventChannel,
  IpcEventPayload,
} from '../shared/ipc-contract';

// preload 侧静态事件订阅的契约包装器：channel 名限定为 IpcEventContract 的 key，回调只收
// payload（丢弃原始 IpcRendererEvent，避免把 event.sender 暴露给渲染层）。返回退订闭包。
export function typedOn<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventPayload<C>) => void,
): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: IpcEventPayload<C>) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

// preload 侧契约包装器：channel 名限定为契约 key，参数与返回值从契约推导。
export function typedInvoke<C extends IpcInvokeChannel>(
  channel: C,
  // NoInfer：泛型 C 只由 channel 字面量决定，不从实参反推。
  ...args: IpcInvokeArgs<NoInfer<C>>
): Promise<IpcInvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<C>>;
}
