---
status: reverted
completed_at: "2026-05-24T23:41:00+08:00"
---

# Summary

实现过 Master Agent 调用其它 Agent 的最小 runtime 闭环，但随后发现该方案引入严重连贯性回归，已撤回 runtime 自动注册 `subagents`。

- 回归表现：主 Agent 容易进入自我说明/等待用户继续，不再连续调用文件工具执行任务。
- 原因：DeepAgents declarative `subagents` 会注入 `task` 工具和委派提示，改变主 Agent 的决策重心。
- 当前状态：已撤掉 `subagents` 注入，恢复 Master Agent 主线执行。
- 后续方向：改为 CDF 自己实现显式委派工具，不使用 DeepAgents 默认 subagent prompt 接管主循环。

## Verification

- `npm run test -- src/main/deepagent/runtime.test.ts src/main/deepagent/file-tools.test.ts src/main/deepagent/skill-manager.test.ts`
- `npx tsc -p tsconfig.node.json --noEmit`
- `npm run test -- src/main/llm.test.ts src/main/deepagent/runtime.test.ts src/main/deepagent/file-tools.test.ts src/main/deepagent/skill-manager.test.ts`
- `npm run build`
