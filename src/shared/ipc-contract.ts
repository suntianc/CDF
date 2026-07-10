// IPC channel contract — 单一契约表：channel 名 → 请求参数元组 + 响应类型。
// preload 侧 typedInvoke 与主进程侧 typedHandle 均从这张表推导类型；
// 参数保持位置元组形态（与线上 invoke 形态一致），以 handler 实际消费为真。
// 纯类型层契约：不做运行时校验，运行时行为不变。
import type {
  KnowledgeEntryCreateInput,
  KnowledgeEntrySearchOptions,
  KnowledgeEntrySummary,
  KnowledgeEntryUpdateInput,
} from './types';

export interface IpcInvokeContract {
  // ===== Knowledge Base / Paper Library =====
  'knowledge:list': {
    args: [projectId: string, options?: KnowledgeEntrySearchOptions];
    result: KnowledgeEntrySummary[];
  };
  'knowledge:search': {
    args: [projectId: string, options?: KnowledgeEntrySearchOptions];
    result: KnowledgeEntrySummary[];
  };
  'knowledge:create': {
    args: [projectId: string, input: KnowledgeEntryCreateInput];
    result: KnowledgeEntrySummary;
  };
  'knowledge:read': {
    args: [projectId: string, relativePath: string];
    result: KnowledgeEntrySummary;
  };
  'knowledge:update': {
    args: [projectId: string, relativePath: string, input: KnowledgeEntryUpdateInput];
    result: KnowledgeEntrySummary;
  };
  'knowledge:delete': {
    args: [projectId: string, relativePath: string];
    result: { deleted: true };
  };
  'paper-library:openPdf': {
    args: [projectId: string, resource: string];
    result: { success: true };
  };
}

export type IpcInvokeChannel = keyof IpcInvokeContract;
export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C]['args'];
export type IpcInvokeResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result'];

// 契约 channel 的运行时清单，供注册完整性测试使用。
// satisfies 保证清单里只有合法 channel；下方 AssertNever 保证契约里没有漏列的 channel。
export const IPC_INVOKE_CHANNELS = [
  'knowledge:list',
  'knowledge:search',
  'knowledge:create',
  'knowledge:read',
  'knowledge:update',
  'knowledge:delete',
  'paper-library:openPdf',
] as const satisfies readonly IpcInvokeChannel[];

type AssertNever<T extends never> = T;
type MissingInvokeChannels = Exclude<IpcInvokeChannel, (typeof IPC_INVOKE_CHANNELS)[number]>;
// 契约新增 channel 却没有加进 IPC_INVOKE_CHANNELS 时，这里编译报错。
export type _AllInvokeChannelsListed = AssertNever<MissingInvokeChannels>;

// ===== 静态事件通道（main → renderer）：channel 名 → payload =====
// 各域迁移时填充（fs / commands / workflow）。
export interface IpcEventContract {}

export type IpcEventChannel = keyof IpcEventContract;
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C];

// ===== 动态模板通道（main → renderer，按 id 拼名）=====
// 通道名字符串携带 payload 类型，发送侧与监听侧共用同一工厂，不再手拼模板。
export type DynamicIpcChannel<P> = string & { readonly __ipcEventPayload?: P };

export function dynamicIpcChannel<P>(prefix: string): (id: string) => DynamicIpcChannel<P> {
  return (id) => `${prefix}${id}` as DynamicIpcChannel<P>;
}

export type DynamicIpcPayload<C> = C extends DynamicIpcChannel<infer P> ? P : never;
