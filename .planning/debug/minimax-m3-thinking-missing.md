---
status: resolved
trigger: "minimax-2.7 对话可以展示思考内容，M3 的就没有"
created: "2026-06-03"
updated: "2026-06-03"
goal: find_root_cause_only
---

# Debug Session: minimax-m3-thinking-missing

## Symptoms

- Expected behavior: M3（MiniMax-M3）模型的对话应在 UI 上展示"思考"区域/事件流，与 minimax-2.7 模型行为一致。
- Actual behavior: M3 对话中**完全没有任何思考区**出现（连空的折叠/展开区域都没有），只有正文回答。
- Error messages: 用户未提供明确报错（纯观察行为差异）。
- Timeline: 当前现象，2026-06-03 报告。
- Reproduction: 在使用 M3 模型（MiniMax-M3）进行对话时触发。
- Prior related (resolved): `.planning/debug/minimax-thinking-tag-render.md` (2026-05-25) 修的是 minimax-2.7 流式 chunk 中字面 `<thinking>` 标签转 `<think>`，与本会话关联但非同一根因。
- Recent change context: STATE.md quick task `260602-un5`（2026-06-02）做了"执行轨迹时序流重构 — ExecutionStep[] 统一思考/工具调用/工具返回；handleLLMEnd 抓真实 LLM 思考文本；UI 按 step.type 渲染"，需确认 M3 是否也吃到这份改造。

## Investigation Scope (用户确认)

全链路排查：model 响应 → provider adapter → 流式补丁 → renderer 渲染。

## Current Focus

- hypothesis: M3 模型走的是另一条 provider 适配/流式补丁路径，未被 minimax-2.7 的 `<thinking>`→`<think>` 归一化或 `260602-un5` 的 thinking step 抓取逻辑覆盖；或 M3 的思考内容在 model 层就根本没暴露（`reasoning_content` / `<thinking>` / 别的字段），导致下游没有原料。
- test: 搜索 M3 / MiniMax-M3 相关的 provider adapter、LLM runtime patch、流式 chunk 解析、renderer 思考区渲染分支，对照 minimax-2.7 的处理链找出断点。
- expecting: 定位出断点位于 (a) model 响应未提供 thinking 字段 / (b) provider adapter 未提取 / (c) 流式补丁未归一化 / (d) renderer 未消费 中哪一环或哪几环。
- next_action: 扫描 M3 模型在代码库中的所有出现点（provider 注册、adapter、patch、测试），与 minimax-2.7 对照差异。

## Evidence

- 2026-06-03: **M3 与 M2.7 走同一 provider 适配分支**。`src/main/deepagent/llm-adapter.ts:525-554` 把 `providerType: 'minimax'` 与 `providerType: 'minimax-overseas'` 都路由到 `ChatAnthropic`(line 550),且两者的 `modelConfig` 完全相同(只含 `model`/`temperature`/`streaming`/`maxTokens`/`apiKey`/`anthropicApiUrl`/`createClient`,无任何 `thinking` 字段)。代码层不存在针对 M2.7 vs M3 的分支。
- 2026-06-03: **patchOpenAIReasoning 不覆盖 M3**。`src/main/deepagent/llm-adapter.ts:95-496` 实现的 `patchOpenAIReasoning`(在 `invoke`/`_streamResponseChunks`/`_generate`/`_streamChatModelEvents`/`completionWithRetry` 五个层面接入 reasoning 提取)只被 openai/custom/moonshot/qwen/xiaomimimo(521-523)与 ollama(587)调用。`minimax` 与 `minimax-overseas`(ChatAnthropic 分支)只走 `patchMiniMaxAssistantRole`(line 551-553),只补齐 assistant role 推断,**不**做任何 reasoning/thinking 提取。
- 2026-06-03: **M3 没有自己的 reasoning 补丁**。`patches/@langchain+anthropic+1.4.0.patch`(quick `260601-nzn` 引入)只改 `message_inputs.js:179` 与 `standard.js:267` 两处 video 块透传,完全未触 `chat_models.js` / `utils/stream_events.js` / `utils/message_outputs.js` 任何 thinking 路径。
- 2026-06-03: **chat 走的是 streamEvents v3,只信 `msg.reasoning` 流**。`src/main/llm.ts:338-348` `runtime.agent.streamEvents({ ..., version: 'v3' })`;`src/main/llm.ts:384` `for await (const token of msg.reasoning ?? [])`;`src/main/llm.ts:408-421` `consumeText` 用 `msg.reasoning != null && !Array.isArray(msg.reasoning)` 作为 "有 reasoning 源" 的唯一判据。`takeReasoningText`(line 244-248)兜底也只查 `LLMStreamAccumulator` 与 `takeModelReasoningCapture`,二者都依赖 `patchOpenAIReasoning` 写入 — M3 路径两个都是空。
- 2026-06-03: **chat 的 `<think>` 标签只由 reasoning 流产出**。`src/main/llm.ts:384-396` `consumeReasoning` 是 `<think>` 的唯一发射点;`checkAndFlushCache`(371-380)、工具调用前冲刷(431-438)、轮末冲刷(670-685)都依赖 `takeReasoningText`。M3 上游若不提供 reasoning,主进程永远不会 send `<think>`。
- 2026-06-03: **renderer 只认 `<think>`**。`src/renderer/src/components/ChatArea/ChatArea.tsx:306/366/369/383/443` 与 `src/renderer/src/components/ChatArea/MessageItem.tsx:35/186/208/281` 全部基于 `<think>` 配对折叠。无 model-specific 分支(grep 全 renderer 无 M2.7/M3/minimax 字样),可排除 (c) 假设。
- 2026-06-03: **handleLLMEnd 改造是工作流路径,不影响 chat**。`src/main/workflow/node-executor.ts:438-444` `handleLLMEnd(output)` 推 `{ type: 'thinking', content: extractThinkingText(output) }` step;该回调仅在 `node-executor.ts:430-473` 的 `agent.invoke(...)`(同步 invoke,不是 streamEvents)处注册。chat 走的是 `src/main/llm.ts:338` 的 `streamEvents v3`,跟 `handleLLMEnd` 完全无交集。`260602-un5` quick task 改造没有覆盖 chat。
- 2026-06-03: **LangChain 侧 Anthropic thinking 通路确实存在,但要靠上游 SSE 喂数据**。`node_modules/@langchain/anthropic/dist/chat_models.js:851-884` `_streamChatModelEvents` 调 `convertAnthropicStream`;`node_modules/@langchain/anthropic/dist/utils/stream_events.js:133-149` `mapBlockToContentBlock` 把 SSE `content_block.type === "thinking"` 映成 v3 `content: { type: "reasoning", reasoning }`;line 187-196 把 `thinking_delta` 映成 v3 `delta: { type: "reasoning-delta", reasoning }`;`node_modules/@langchain/core/dist/language_models/stream.cjs:298-362` `ReasoningContentStream` 把这些 v3 事件聚合为 `msg.reasoning` 异步迭代器。整条链完全被动:链上任何一段都不会主动 inject 思考内容,**前提是上游 MiniMax M3 API 在 SSE 流里发了 `thinking_delta` / `content_block.type === "thinking"` 事件**。
- 2026-06-03: **adapter 也没有 `thinking: enabled` 这种显式开关**。`src/main/deepagent/llm-adapter.ts:498-594` 整个 `createLangChainModel` 在 13 个 provider 分支里都没设置 `thinking`;`@langchain/anthropic` 1.4.0 默认不开 extended thinking(见 `node_modules/@langchain/anthropic/dist/chat_models.js:54-56` `_thinkingInParams` 与 line 671 `this.thinking = fields?.thinking ?? this.thinking`)。M3 模型若要触发 thinking,需要 client 显式传 `thinking: { type: "enabled", budget_tokens: N }`,**当前代码没有为任何模型传这个**。
- 2026-06-03: **可对比的 03.2-REPORT / 03.2-05 / 03.2-RESEARCH 共识**:streamEvents v3 是 deepagents 推荐投影接口,`msg.reasoning` 是 reasoning token 唯一入口,降级到 `stream()` 是倒退。所以 chat 想看 thinking 只能寄希望于 `msg.reasoning` 流里有 token,反推就是上游必须 emit 出来。
- 2026-06-03: **可参考的 41052ac / 3f2a40b 旧 fix 都没覆盖 v3 reasoning 流**。`41052ac`(9 天前)fix 是在旧 streaming chunk 路径上把 `block.thinking` 拼成 `<think>…</think>` 注入;该旧路径已被 streamEvents v3 取代(见 `b9b901c`、`57fc4e3` 的迁移),`patchOpenAIReasoning` 内的 `wrapStreamChatModelEvents`(llm-adapter.ts:278-472)只对 OpenAI 兼容 provider 生效,不会帮 M3 补 reasoning。`3f2a40b` / `7e44bbf` 的 `delta.thinking` 提取也是 OpenAI 兼容 chunk 解析器(`normalizeOpenAICompatibleChunk` / `extractRawReasoning`),与 M3 的 v3 reasoning 流无交集。

## Eliminated

- (b) 局部:`patchOpenAIReasoning` / `normalizeOpenAICompatibleChunk` / `normalizeThinkingTags` 不覆盖 Anthropic 兼容 provider 路径(包括 M3),但 **它们是 OpenAI 兼容路径的 thinking 提取,本就不指望它们处理 M3**;M3 的 v3 reasoning 流机制(`convertAnthropicStream` → `ReasoningContentStream` → `msg.reasoning`)代码完整、无 bug,问题是它需要上游喂 `thinking_delta` 才有输出。
- (c) renderer 不存在 M2.7-only 分支;`<think>` 解析是普适逻辑。
- (d) `260602-un5` 的 `handleLLMEnd` 在工作流执行路径(workflow 节点 `agent.invoke`),与 chat(`agent.streamEvents v3`)无交集,因此 M3 工作流可能吃到 thinking step(如果 `extractThinkingText` 在 `gen.message.content` 拿到非空文本)但 chat 完全不会。

## Resolution

- root_cause: chat 路径上 M3 模型没有产生可消费的 reasoning token。完整断点链是 `MiniMax M3 上游 SSE → LangChain ChatAnthropic 客户端 → convertAnthropicStream → ReasoningContentStream → msg.reasoning → consumeReasoning 发射 <think>`,**真正的断点不在"上游不发",而在"客户端根本没请上游发"**:
  1. **官方文档调研(2026-06-03 翻盘)**:MiniMax 平台文档 `https://platform.minimaxi.com/docs/api-reference/text-chat-anthropic` 明确写"支持通过 `thinking` 参数控制思考",但**协议形态与 Anthropic 原生不同**——只支持 `disabled` / `adaptive` 两种 type,**没有 `budget_tokens` 字段**;响应里会发 `content_block.type === "thinking"` block 与 `delta.type === "thinking_delta"` 事件;多轮时需原样回带 `signature`。
  2. **LangChain 1.4.0 已就绪**:`node_modules/@langchain/anthropic/dist/chat_models.d.ts:164` 字段是 `thinking?: AnthropicThinkingConfigParam`;line 181 官方示例就是 `thinking: { type: "adaptive" }`——**类型层面已经支持 MiniMax 简化版协议**。line 671 `this.thinking = fields?.thinking ?? this.thinking` 也只是简单透传,没有 enabled/budget 强校验。
  3. **客户端从未传 thinking 字段**:`src/main/deepagent/llm-adapter.ts:525-554` 创建 minimax/minimax-overseas 的 ChatAnthropic 时,`modelConfig` 只含 `model`/`temperature`/`streaming`/`maxTokens`/`apiKey`/`anthropicApiUrl`/`createClient`,**没有任何 `thinking` 配置**。所以 M3 上游收到的请求里压根没有 "要不要思考" 这个开关,自然不会发 thinking 事件,整条 v3 reasoning 链空。
  4. **M2.7 思考区为何能显示(补充根因)**:M2.7 走完全相同的 ChatAnthropic 分支(同样没传 thinking),但其响应**正文文本流中带字面 `<thinking>` 标签**(MiniMax 旧模型以这种"嵌入文本"的方式暴露思考),被 `patchMiniMaxAssistantRole` 或更早的 `minimax-thinking-tag-render` fix 在流式补丁里归一化为 `<think>` / `</think>`。这是一条**完全独立于上游 thinking 协议的兜底路径**,M3 上游根本不以字面 `<thinking>` 标签发思考(它走的是真正的 SSE thinking 事件),所以兜底路径对 M3 无效。
  5. **排除项**:`260602-un5` 的 `handleLLMEnd` 改造在工作流执行路径(`node-executor.ts:430-473` 的 `agent.invoke`),与 chat(`src/main/llm.ts:338` 的 `agent.streamEvents v3`)无交集,本会话确认 M3 chat 思考缺失**不是**该 refactor 引入的回归。
- fix: (本会话 diagnose-only,fix 不在范围内 — 按用户要求停在 ROOT CAUSE FOUND;最小修补提示:在 `llm-adapter.ts:530-535` 的 `modelConfig` 加一行 `thinking: { type: "adaptive" }`,仅作用于 minimax / minimax-overseas 分支)
- verification: (待 fix 阶段)
- files_changed: (待 fix 阶段)

