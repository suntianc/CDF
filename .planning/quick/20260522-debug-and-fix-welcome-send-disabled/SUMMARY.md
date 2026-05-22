# Quick Fix Summary: Welcome Send Button Disabled Fix

## Problem
在欢迎页面输入指令后，发送按钮依然置灰并无法点击。这是因为 `isStreaming` 状态在出现历史异常/未捕获错误（例如 LLM 404 错误）或数据保存失败等情况下，可能会卡在 `true` 状态。由于 `isStreaming` 是通过 Zustand 全局共享且没有在组件重新挂载时强制重置的机制，导致按钮渲染受限于 `disabled={!inputVal.trim() || isStreaming}` 而永久置灰。

## Changes

1. **[ChatArea.tsx](file:///Users/suntc/project/CDF/src/renderer/src/components/ChatArea/ChatArea.tsx)**:
   - 新增了防御性 `useEffect`，在 `ChatArea` 组件挂载时强制重置 `isStreaming` 状态为 `false`，清理挂起的 `streamingMessageId`。
   - 新增了 `console.log` 状态调试日志，输出渲染期间的 `activeSessionId`、`isStreaming`、`inputVal` 及 `currentProjectId`。

2. **[sessionStore.ts](file:///Users/suntc/project/CDF/src/renderer/src/stores/sessionStore.ts)**:
   - 在流接收完成后的 `done` 状态分支中加入了全面的 `try-catch` 块。
   - 保证了在保存消息至 SQLite 失败或级联总结抛出异常时，也能在 `catch` 逻辑中将 `isStreaming` 标记重置为 `false`，防止流状态悬挂导致前端整个界面无法发送消息。

## Verification
- 成功运行 `npm run build` 以确保 TypeScript 编译和打包一切正常。
- 成功运行 `npm run test`，单元测试 100% 通过。
