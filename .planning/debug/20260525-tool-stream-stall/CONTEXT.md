# Tool Stream Stall Regression

## Symptom

Master Agent 在触发读取 README 等文件工具前后卡住，renderer 一直保持 streaming 状态，`agent_tool_calls` 没有新增记录。

## Assumption

原始 DeepAgents 集成可以处理工具调用，因此本次按回归处理，不把问题优先归因到 provider。

## Fix Strategy

恢复接近原始工具流消费路径：

1. 移除 `llm-adapter` 对 `_generate`、`_stream`、`_streamResponseChunks` 的低层 monkey patch，避免破坏 LangChain/OpenAI 的工具调用流式解析。
2. 将 `run.output`、message stream、tool stream 改回并行等待，避免主循环在某条流未推进时卡住另一条流。
3. 对 `run.output` 不 resolve 的边界情况增加短 grace fallback：message/tool stream 已完成后不再无限等待，审批中断从 `run.interrupts` 兜底读取。
4. 消费 `msg.reasoning`，按现有 UI 的 `<think>...</think>` 格式流到主消息，避免 reasoning-only 输出看起来像“只出了两个 token 后卡住”。

旧会话 system message 问题由 runtime 侧只加载 `user` / `assistant` 消息兜底，不再在 provider adapter 里改写低层消息流。
