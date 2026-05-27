# Spike Manifest

## Idea

验证 deepagents.js 的 `agent.stream()` + `subgraphs` API 能否完整替代当前 `streamEvents v3` 的事件处理需求。项目当前使用 `streamEvents` v3 获取流式事件，官方推荐迁移到 `stream()` + `streamMode` + `subgraphs: true`。需要验证迁移可行性后再决定是否正式迁移。

## Requirements

- 必须能区分主代理和子代理的事件流
- 必须支持 reasoning token 的流式输出
- 必须支持工具调用事件的实时推送
- 迁移后不能丢失现有的 todo 轮询机制

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | stream-subgraph-namespace | standard | 子代理事件通过 namespace 隔离 | INVALIDATED ✗ | streaming, subagent, namespace |
| 002 | stream-messages-reasoning | standard | reasoning token 流式输出 | SKIPPED (001 invalidated premise) | streaming, reasoning, tokens |
| 003 | stream-tool-events | standard | 工具调用事件格式兼容 | SKIPPED (001 invalidated premise) | streaming, tools, events |
| 004 | stream-combined-modes | standard | 多模式组合一次遍历 | SKIPPED (001 invalidated premise) | streaming, combined, subgraphs |
