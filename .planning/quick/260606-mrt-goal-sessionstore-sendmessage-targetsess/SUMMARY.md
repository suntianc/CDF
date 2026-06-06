---
name: goal-sessionstore-sendmessage-targetsess
description: 给 sessionStore.sendMessage 增加 targetSessionId 参数，/goal 不再切 UI session
status: complete
---

## 变更摘要

给 `sessionStore.sendMessage` 增加可选第 4 参数 `targetSessionId`，使 `/goal` 可以向任意会话投递消息而不切换当前 UI 活跃会话。

## 具体改动

### `src/renderer/src/stores/sessionStore.ts`
- 接口声明：`sendMessage: (projectId, content, overrides?, targetSessionId?) => Promise<void>`
- 实现逻辑：
  - `targetSessionId ?? activeSessionId` 确定投递目标
  - 非 active session 走 `streamingSessionsCache` 检查 isStreaming（不阻塞 UI）
  - 仅当 `targetSessionId === activeSessionId` 时才更新 `isStreaming` 全局状态

### `src/renderer/src/hooks/useGoalJudge.ts`
- 移除两处 `selectSession` 切换 UI 的逻辑
- 首轮：`sendMessage(projectId, goal, undefined, sessionId)`
- 继续轮：`sendMessage(projectId, '继续：' + reason, undefined, sessionId)`

### `src/renderer/src/hooks/useGoalJudge.test.ts`
- 更新测试 A、C 的断言，反映新的 4 参数签名

## 测试结果
- `sessionStore.test.ts`: 10/10 通过 ✓
- `useGoalJudge.test.ts`: 6/6 通过 ✓