# Quick Task 260524-ojt: DeepAgents 原生上下文管理实施

## Goal

把 CDF 的 Agent 运行态上下文交给 DeepAgents/LangGraph checkpoint 管理，业务 `messages` 表仅保留 UI 展示和审计用途。

## Tasks

1. Runtime 接入官方 SQLite checkpointer，修复项目 memory 和文件沙箱。
   - Verify: runtime 单元测试覆盖 checkpointer、memory、virtual backend 和权限。

2. 调整 chat payload，只把当前用户消息交给 DeepAgents，旧会话无 checkpoint 时做一次 DB 历史 bootstrap。
   - Verify: llm 单元测试断言 `thread_id=sessionId` 和输入消息形态。

3. 同步 renderer/preload/shared 类型与测试。
   - Verify: renderer store 测试断言 `llm.chat` payload 包含当前用户消息。

## Verification

- `npm run build`
- `npm run test -- src/main/deepagent src/main/llm.test.ts src/renderer/src/stores/sessionStore.test.ts`
- `npx tsc -p tsconfig.node.json --noEmit`
