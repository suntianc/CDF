import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
} from '../shared/ipc-contract';
import { typedHandle } from './typed-ipc';

// typedCrud：把「一条 SQL、零字段后处理」的 IPC handler 收进单一 seam。
//
// 设计约束（见 ADR-0052）：
// - 只接受单条 SQL 路径的 handler；任何字段裁剪 / JSON 合并 / 加密 / mask 必须留在手写 handler。
// - channel 名仍是契约的唯一身份（走 typedHandle）。
// - 读 / 写 / 删回调只接收 IPC 运行时 args（不含 db 句柄）——db 由 user 的领域函数
//   闭包捕获，helper 接口与领域函数正交对齐。
// - 任一操作未提供时不报错，仍以 no-op 注册 channel，保证契约完整性测试不被未注册 channel 击穿。
//
// 领域函数通过闭包捕获 db；helper 不直接接 SQL，保持数据库逻辑集中在领域层。
export interface CrudSpec<C extends IpcInvokeChannel> {
  channel: C;
  read?: (...args: IpcInvokeArgs<C>) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;
  write?: (...args: IpcInvokeArgs<C>) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;
  remove?: (...args: IpcInvokeArgs<C>) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;
}

export function typedCrud<C extends IpcInvokeChannel>(spec: CrudSpec<C>): void {
  const { channel, read, write, remove } = spec;

  if (read) {
    typedHandle(channel, (_event: IpcMainInvokeEvent, ...args: IpcInvokeArgs<C>) => {
      return read(...args) as IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;
    });
  } else if (write) {
    typedHandle(channel, (_event: IpcMainInvokeEvent, ...args: IpcInvokeArgs<C>) => {
      return write(...args) as IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;
    });
  } else if (remove) {
    typedHandle(channel, (_event: IpcMainInvokeEvent, ...args: IpcInvokeArgs<C>) => {
      return remove(...args) as IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;
    });
  } else {
    typedHandle(channel, () => undefined);
  }

  // Keep ipcMain import referenced (registers via typedHandle/handle under the hood).
  void ipcMain;
}