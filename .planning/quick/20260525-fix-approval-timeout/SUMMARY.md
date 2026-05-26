---
status: complete
date: 2026-05-25
---

# Fix Approval Timeout Summary

Completed:
- Removed the hard timeout wrapper around `run.output` so a slow DeepAgents output no longer forces the run to complete.
- Preserved the existing approval event flow and added coverage for interrupt-to-approval handling, including LangGraph v3 `run.interrupts[].payload`.
- Fixed the real stuck path where an interrupt is available on the stream but `run.output` never resolves.
- Added lifecycle-based completion so finished graph runs do not stay in `running` when `run.output` hangs.
- Made pending output waits abort-aware so the stop button can interrupt a stuck run.
- Updated tests that previously relied on timeout completion.

Verification:
- `npm test -- src/main/llm.test.ts` passed with 12 tests.
- `npx tsc -p tsconfig.node.json --noEmit` was attempted but still fails on pre-existing `src/main/deepagent/llm-adapter.ts` type errors unrelated to this change.
