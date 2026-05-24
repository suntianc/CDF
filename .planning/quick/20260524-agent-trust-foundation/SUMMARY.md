---
status: complete
completed_at: "2026-05-24T00:00:00+08:00"
---

# Summary: Agent 桌面应用信任底座

## Completed

- Added session-to-agent binding support.
- Added local agent run and tool-call audit tables plus IPC reads.
- Routed chat runtime through the bound Agent, including filtered Skills and Agent-specific MCP bindings.
- Added default Deep Agents permissions and write-operation HITL interrupts.
- Added run/tool/approval stream events, persisted run state, and approval resume handling.
- Reworked the right panel into an Agent activity panel with approval controls.
- Added Agent selection for new sessions and runtime safety notes in Agent editing.

## Verification

- `npx tsc -p tsconfig.node.json --noEmit` passed.
- `npm run test -- src/main/deepagent src/main/llm.test.ts src/renderer/src/stores/sessionStore.test.ts` passed.
- `npm run build` passed.
