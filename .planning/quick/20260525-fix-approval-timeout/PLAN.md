---
status: in-progress
date: 2026-05-25
---

# Fix Approval Timeout

Goal: remove the forced `run.output` timeout completion behavior and restore approval prompts for DeepAgents write/edit/delete interrupts.

Steps:
1. Replace timeout-based `run.output` handling with normal await so a pending interrupt is not treated as completion.
2. Keep approval UI event flow unchanged: main emits `approval_required`, renderer opens task panel from existing `pendingApproval` state.
3. Update focused tests around hanging output and approval interrupts.
4. Verify with targeted Vitest coverage for `src/main/llm.ts`.
