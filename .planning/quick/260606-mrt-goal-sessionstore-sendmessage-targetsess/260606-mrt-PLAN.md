---
quick_id: 260606-mrt
slug: goal-sessionstore-sendmessage-targetsess
status: planned
created: 2026-06-06
---

# Quick Task 260606-mrt: /goal targetSessionId delivery

<objective>
Improve `/goal` architecture by adding a targeted `sendMessage` path so goal loops can continue in their original session without switching the visible UI session.
</objective>

## Task 1 — Extend sessionStore.sendMessage

**Files**
- `src/renderer/src/stores/sessionStore.ts`
- `src/renderer/src/stores/sessionStore.test.ts`

**Action**
- Add optional `targetSessionId` to `sendMessage`.
- Persist messages and call `llm.chat` with the target session.
- Use cached target-session messages as the base transcript.
- Only call `set(...)` to update visible UI state when `targetSessionId === activeSessionId`.

**Verify**
- sessionStore targeted test proves background target send does not replace active UI messages and calls `llm.chat` with target sessionId.

## Task 2 — Use targetSessionId in /goal

**Files**
- `src/renderer/src/hooks/useGoalJudge.ts`
- `src/renderer/src/hooks/useGoalJudge.test.ts`

**Action**
- Remove `selectSession(sessionId)` calls from goal loop.
- Call `sendMessage(projectId, goal, undefined, sessionId)` for initial goal injection.
- Call `sendMessage(projectId, '继续：...', undefined, sessionId)` for continuation.
- Update tests to assert no UI session switch and target session argument is passed.

**Verify**
- `npx vitest run src/renderer/src/hooks/useGoalJudge.test.ts src/renderer/src/hooks/useGoalJudge.regression.test.tsx src/renderer/src/stores/sessionStore.test.ts`
