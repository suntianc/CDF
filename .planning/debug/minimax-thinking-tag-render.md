---
status: resolved
trigger: "当前项目，minimax 做了单独的适配，但是现在 thinking 标签转换没有成功转换出来从而无法在页面渲染"
created: "2026-05-25"
updated: "2026-05-25"
---

# Debug Session: minimax-thinking-tag-render

## Symptoms

- Expected behavior: MiniMax 响应中的 thinking 标签应被转换成页面可渲染的思考内容事件或结构。
- Actual behavior: thinking 标签没有成功转换，页面无法渲染。
- Error messages: 用户未提供明确报错。
- Timeline: MiniMax 单独适配后出现或暴露。
- Reproduction: 使用 MiniMax 模型触发带 thinking 标签的聊天输出。

## Current Focus

- hypothesis: MiniMax 适配或流式解析逻辑没有覆盖 `<thinking>` / thinking 分片跨 chunk 的情况，导致 renderer 收不到可渲染结构。
- test: 搜索 provider adapter、LLM runtime、stream event、renderer message rendering 相关代码与测试。
- expecting: 找到 thinking 标签转换入口及 MiniMax 特殊分支，确认丢失发生在主进程解析还是渲染消费。
- next_action: gather initial evidence

## Evidence

- 2026-05-25: `src/renderer/src/components/ChatArea/ChatArea.tsx` 的思考区只解析 `<think>...</think>`，不会渲染 `<thinking>...</thinking>`。
- 2026-05-25: `src/main/deepagent/llm-adapter.ts` 的 MiniMax 流式补丁已处理 `reasoning_content`，但普通文本 chunk 中的字面 `<thinking>` 标签会原样进入 renderer。
- 2026-05-25: 新增回归测试覆盖 MiniMax 字面 `<thinking>...</thinking>` 转换为 `<think>...</think>`。

## Eliminated

- 页面直接兼容 `<thinking>`：用户确认“不用支持 thinking，think 就可以”，因此保持 UI 只渲染 `<think>`。

## Resolution

- root_cause: MiniMax 适配层只把 `reasoning_content` 包装为 `<think>`，未把文本 chunk 中的 `<thinking>` 标签归一化为页面支持的 `<think>` 标签。
- fix: 在 MiniMax `_streamResponseChunks` 补丁中对普通文本 chunk 做 `<thinking>` / `</thinking>` 到 `<think>` / `</think>` 的转换。
- verification: `npx vitest run src/main/deepagent/llm-adapter.test.ts src/main/llm.test.ts src/renderer/src/stores/sessionStore.test.ts` 通过；`npm run build` 通过。
- files_changed: `src/main/deepagent/llm-adapter.ts`, `src/main/deepagent/llm-adapter.test.ts`
