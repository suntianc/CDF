---
status: complete
created: "2026-05-25"
---

# Quick Task: OpenAI-Compatible Provider Adapter Hardening

## Goal

Implement the approved provider adapter improvement plan:
- replace module-level reasoning/text cache with request-scoped accumulation
- centralize OpenAI-compatible provider stream normalization
- reduce LangChain private-method patching to the minimum needed path
- preserve the renderer `<think>` contract and existing IPC event types

## Verification

- `npx vitest run src/main/llm.test.ts src/main/deepagent/llm-adapter.test.ts`
- `npm run build`
