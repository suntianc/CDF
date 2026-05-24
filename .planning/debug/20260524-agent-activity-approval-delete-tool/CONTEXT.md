# Agent 活动、审批弹出与删除工具修复

## Symptoms

- Agent 活动面板展示所有工具调用，与主聊天面板里的工具调用过程重复，信息过重。
- 触发工具审批时右侧 Agent 活动面板没有自动打开，用户难以发现审批等待。
- Master Agent 运行时没有实际可用的删除文件工具；DeepAgents JS 默认工具集中不存在 `delete_file`。

## Assumptions

- 主聊天面板继续保留工具过程卡片，右侧面板聚焦运行状态、审批和异常摘要。
- 删除工具第一期只支持项目内文件删除，不删除目录；删除动作必须走 DeepAgents interrupt 审批。
- 继续保持主页面只使用 Master Agent，不引入 Agent 选择或工作流编排。

## Success Criteria

- 审批事件到达 renderer 后自动打开 Agent 活动面板。
- Agent 活动面板不再逐条展示所有成功工具调用。
- Master Agent 工具集中包含受审批保护的 `delete_file`。
- TypeScript 和相关单元测试通过。
