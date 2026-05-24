# Master Agent 调用其它 Agent 最小闭环

## Assumptions

- 主聊天入口仍然只使用项目默认 Master Agent。
- 其它 Agent 作为 Master Agent 可委派的 DeepAgents subagent，不在主页面切换。
- 第一期只做 runtime 能力闭环，不做工作流编排、ReactFlow、子 Agent 独立 UI。

## Plan

1. Runtime 查询同项目非默认 Agent，并转换为 DeepAgents `subagents`。
2. 每个子 Agent 使用自己的 provider、system prompt、MCP、Skills 绑定。
3. 复用当前虚拟项目根 `/`、文件权限和写操作审批策略。
4. 在 Master Agent 系统提示里说明可通过 `task` 委派其它 Agent。
5. 补 runtime 单元测试并跑 node 类型检查。

## Success Criteria

- `createDeepAgent()` 收到非默认 Agent 转换出的 `subagents`。
- Master Agent 自身不被注册成 subagent。
- 子 Agent 的 Skills 按自己的 `agent_skills` 过滤。
- 子 Agent 的 MCP 工具按自己的绑定加载。
- 旧的主会话绑定逻辑不变。
