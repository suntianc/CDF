# Plan: Fix stream listener race in chat send flow

## Goal
修复发送消息时渲染进程晚于主进程流事件注册监听，导致会话卡在生成中的问题。

## Checklist
- [x] 1. 修改 `src/renderer/src/stores/sessionStore.ts`，确保先注册 `onChunk` 监听，再发起 `llm:chat` 请求，并补齐 `invoke` 失败兜底。
- [x] 2. 新增针对该时序问题的 store 测试，覆盖“监听先注册，再允许 chat 调用”的核心行为。
- [x] 3. 运行 `npm run test` 验证修复未破坏现有逻辑。
