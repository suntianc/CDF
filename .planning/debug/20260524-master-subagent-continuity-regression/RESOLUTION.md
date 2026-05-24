# Resolution

## Changes

- 移除 `createDeepAgent()` 的 `subagents` 参数。
- 移除 Master Agent 系统提示里的 `[可委派 Agent]` 和 `task` 工具引导文案。
- 移除 runtime 中的 subagent 构建逻辑，保留 Master Agent 原有文件/MCP/Skills 能力。
- 更新测试，断言 `params.subagents` 为 `undefined`，避免再次自动注入。
- 注册 CDF harness profile，禁用 DeepAgents 默认 `general-purpose` subagent，并从可见工具中排除 `task`。
- checkpoint namespace 升级到 `cdf-master-runtime-v3`，隔离此前带 `task/subagent` 语义的运行状态。
- 将 `llm:chat` IPC 改为立即返回 `{ ok: true }`，DeepAgent 执行继续通过 `llm:chunk-*` 事件异步推送，避免长时间运行、审批等待或窗口刷新时触发 `reply was never sent`。
- DeepAgents harness profile 注册改为防御式处理，模型名格式异常或注册失败时只记录警告，不中断聊天运行时创建。

## Verification

- `npm run test -- src/main/deepagent/runtime.test.ts src/main/deepagent/skill-manager.test.ts src/main/deepagent/file-tools.test.ts src/main/llm.test.ts`
- `npm run test -- src/main/ipc-handlers.test.ts src/main/deepagent/runtime.test.ts src/main/llm.test.ts src/main/deepagent/skill-manager.test.ts src/main/deepagent/file-tools.test.ts`
- `npx tsc -p tsconfig.node.json --noEmit`
- `npm run build`

## Follow-up

其它 Agent 调用不再走 DeepAgents declarative `subagents`。下一版应实现 CDF 显式委派工具：由 Master Agent 主动调用一个受控 `delegate_agent` 工具，主循环仍由 Master Agent 掌控。
