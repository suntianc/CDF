---
status: complete
completed: "2026-05-25"
---

# Summary: OpenAI-Compatible Provider Adapter Hardening

## Completed

- Added request-scoped LLM stream accumulation using `AsyncLocalStorage`.
- Moved OpenAI-compatible provider normalization into a dedicated module.
- Removed module-level reasoning/text caches from the provider adapter.
- Removed global `ChatOpenAI` / `ChatOllama` prototype `invoke` patching.
- Reduced stream/generate patching to the current model instance.
- Added instance-level OpenAI-compatible raw stream reasoning capture on `completions.completionWithRetry`.
- Checked LangChain MCP docs: `ChatOpenAI` only preserves official OpenAI fields for OpenAI-compatible endpoints, so third-party `reasoning_content` must be normalized before DeepAgents consumes message projections.
- Added an instance-level `_streamChatModelEvents` wrapper that emits standard `content-block-start` / `content-block-delta` `reasoning-delta` / `content-block-finish` events for normalized reasoning, text, and tool-call chunks.
- Preserved the renderer `<think>` and `message_chunk` contracts.

## Verification

- `npx vitest run src/main/llm.test.ts src/main/deepagent/llm-adapter.test.ts`
- `npm run build`
