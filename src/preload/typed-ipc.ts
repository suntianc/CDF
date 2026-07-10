import { ipcRenderer } from 'electron';
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
} from '../shared/ipc-contract';

// preload 侧契约包装器：channel 名限定为契约 key，参数与返回值从契约推导。
export function typedInvoke<C extends IpcInvokeChannel>(
  channel: C,
  // NoInfer：泛型 C 只由 channel 字面量决定，不从实参反推。
  ...args: IpcInvokeArgs<NoInfer<C>>
): Promise<IpcInvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<C>>;
}
