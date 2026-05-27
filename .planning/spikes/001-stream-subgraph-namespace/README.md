---
spike: 001
name: stream-subgraph-namespace
type: standard
validates: "Given a deepagent with subagents, when streaming events, then subagent events can be isolated from main agent events"
verdict: INVALIDATED
related: []
tags: [streaming, subagent, namespace, streamEvents, stream]
---

# Spike 001: 子代理事件隔离

## What This Validates

Given a deepagent with subagents, when streaming events, then subagent events can be isolated from main agent events.

## Research

### 关键发现：streamEvents v3 不是 LangGraph 的 streamEvents

deepagents.js 的 `streamEvents` v3 是一个**自定义的高级投影式流式接口**，不是 LangGraph 底层的 `streamEvents`。

从 `node_modules/deepagents/dist/index.d.ts:2903-2981` 分析：

```typescript
interface DeepAgent<TTypes> extends ReactAgent<TTypes> {
  streamEvents: (state, config: { version: "v3" }) => Promise<DeepAgentRunStream>;
}
```

`DeepAgentRunStream` 提供的投影：

| 投影 | 类型 | 说明 |
|------|------|------|
| `run.messages` | `AsyncIterable<ChatModelStream>` | 消息生命周期，含 `.text` 和 `.reasoning` 迭代器 |
| `run.toolCalls` | `AsyncIterable<ToolCallStreamUnion>` | 工具调用流，含 `.input`、`.output`、`.status` |
| `run.subagents` | `AsyncIterable<SubagentRunStreamUnion>` | **子代理委派流，已内置隔离** |
| `run.middleware` | — | 中间件生命周期事件 |
| `run.values` | — | 状态快照 |
| `run.output` | — | 最终状态 |
| `run.subgraphs` | — | 子图运行流 |

### 子代理流式接口（已内置）

```typescript
interface SubagentRunStream<TOutput> {
  readonly name: string;                    // 子代理名称
  readonly taskInput: Promise<string>;      // 任务输入
  readonly output: Promise<TOutput>;        // 任务输出
  readonly messages: AsyncIterable<ChatModelStream>;   // 子代理消息流
  readonly toolCalls: AsyncIterable<ToolCallStreamUnion>; // 子代理工具调用流
  readonly subagents: AsyncIterable<SubagentRunStream>;   // 嵌套子代理
}
```

### 结论

**不需要迁移！** 当前使用的 `streamEvents` v3 已经是 deepagents 的高级流式接口，它：

1. ✅ 已内置子代理事件隔离（`run.subagents`）
2. ✅ 已支持 reasoning token 流式输出（`msg.reasoning`）
3. ✅ 已支持工具调用事件（`run.toolCalls`）
4. ✅ 已支持嵌套子代理（`subagent.subagents`）

LangGraph 的 `agent.stream()` + `subgraphs: true` 是**底层 API**，返回 `[namespace, data]` 元组，需要手动解析。迁移到这个 API 意味着**从高级接口降级到低级接口**，需要重写所有事件处理逻辑。

## How to Run

源码分析，无需运行。

## Investigation Trail

1. 阅读 `deepagents/dist/index.d.ts` 的 `DeepAgent` 接口定义
2. 发现 `streamEvents` v3 返回 `DeepAgentRunStream`，包含 `run.subagents` 投影
3. 阅读 `SubagentRunStream` 接口，发现子代理已有独立的 `messages`、`toolCalls`、`subagents` 流
4. 对比 LangGraph 的 `agent.stream()` + `subgraphs: true`，确认这是底层 API
5. 结论：当前 API 已满足需求，迁移是降级而非升级

## Results

**Verdict: INVALIDATED ✗**

研究假设「需要迁移到 `stream()` API」被推翻。当前 `streamEvents` v3 已是 deepagents 的高级流式接口，内置子代理事件隔离、reasoning token 支持、工具调用事件等所有需要的功能。

**影响：** 取消 Spike 002-004，无需继续验证。迁移方案不成立。
