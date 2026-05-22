# Summary: Fix stream listener race in chat send flow

## Problem
渲染进程原先在 `await window.electronAPI.llm.chat(...)` 之后才注册 `onChunk` 监听，而主进程 `llm:chat` 调用在返回前就已经持续发送流式事件。结果是前端会错过 `chunk/done/error`，界面卡在“生成中”，输入框一直被禁用。

## Changes

1. **调整监听与请求顺序**
   - 在 `src/renderer/src/stores/sessionStore.ts` 中改为先注册 `onChunk`，再发起 `llm.chat`。
   - 将流式完成过程包装为 `streamPromise`，在 `done` 时保存助手消息、恢复 `isStreaming`，并继续执行上下文阈值检查。

2. **补充失败兜底**
   - 如果 `llm.chat` 自身 `invoke` 失败，立即清理监听并恢复前端流状态，避免再次卡死。
   - 如果流式事件返回 `error`，统一回收 `isStreaming` 和 `streamingMessageId`。

3. **增加回归测试**
   - 新增 `src/renderer/src/stores/sessionStore.test.ts`。
   - 通过 mock `electronAPI.llm` 验证“监听必须先于 chat 注册”这一行为，并断言流结束后状态能正常恢复。

## Verification

- `npm run test` 通过，共 `4` 个测试文件、`5` 个测试全部通过。
- 手动启动 `npm run dev` 后在 Electron 界面发送“请简单回复‘收到’”，应用成功返回“收到”，输入框恢复可用，不再卡在生成中。
