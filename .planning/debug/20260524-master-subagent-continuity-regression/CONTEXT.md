# Master Agent 连贯性回归

## Symptom

增加 DeepAgents declarative `subagents` 后，主聊天里的 Master Agent 不再连贯执行用户要求，出现自我说明、等待用户继续、没有主动调用工具的行为。

## Diagnosis

DeepAgents 的 `subagents` 会向主 Agent 注入 `task` 工具和委派提示。对 CDF 的主入口来说，这改变了 Master Agent 的决策重心：模型更容易先解释“可委派/可搜索”，而不是沿主线直接调用文件工具完成任务。

## Fix Strategy

先撤掉 runtime 自动注册 `subagents`，恢复 Master Agent 连贯执行。后续其它 Agent 调用改为 CDF 自己的显式委派工具，避免 DeepAgents 默认 subagent prompt 接管主循环。
