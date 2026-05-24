# Resolution

## Changes

- Agent 活动面板改为展示运行状态、审批卡片、工具摘要和失败工具，不再逐条展示所有成功工具调用。
- App 监听 `pendingApproval`，出现审批请求时自动打开右侧 Agent 活动面板。
- 新增 `delete_file` 工具并注入 Master Agent runtime；工具只允许删除项目内普通文件，并拒绝 `.env*`、`.git`、`node_modules`、`out`、`dist` 等受保护路径。

## Verification

- `npm run test -- src/main/deepagent/file-tools.test.ts src/main/deepagent/runtime.test.ts src/renderer/src/stores/sessionStore.test.ts`
- `npx tsc -p tsconfig.node.json --noEmit`
- `npm run build`
