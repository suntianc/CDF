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
// - 只接受单条 SQL 路径的 handler；任何字段裁剪 / JSON 合并 / 加密 / mask /
//   写后合成返回行，必须留在手写 typedHandle。
// - channel 名仍是契约的唯一身份（走 typedHandle 注册，ADR-0051 的完整性测试无需感知本 helper）。
// - read / write / remove 恰好提供一个，注册期强制（多传或漏传都在启动时抛错，
//   不静默注册 no-op——空 handler 会让契约完整性测试对漏实现视而不见）。
// - 回调只接收 IPC 运行时 args；db 由回调闭包捕获，helper 不接触 SQL。
type CrudOperation<C extends IpcInvokeChannel> = (
  ...args: IpcInvokeArgs<C>
) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;

export interface CrudSpec<C extends IpcInvokeChannel> {
  channel: C;
  read?: CrudOperation<C>;
  write?: CrudOperation<C>;
  remove?: CrudOperation<C>;
}

export function typedCrud<C extends IpcInvokeChannel>(spec: CrudSpec<C>): void {
  const { channel, read, write, remove } = spec;
  const operations = [read, write, remove].filter((op) => op !== undefined);
  if (operations.length !== 1) {
    throw new Error(
      `typedCrud('${channel}') needs exactly one of read/write/remove, got ${operations.length}`,
    );
  }
  const operation = operations[0] as CrudOperation<C>;

  typedHandle(channel, (_event: IpcMainInvokeEvent, ...args: IpcInvokeArgs<C>) => {
    return operation(...args);
  });
}
