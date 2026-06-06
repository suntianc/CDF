---
quick_id: 260606-kiz
slug: code-review-max-13-electronapi-commands-
status: planned
created: 2026-06-06
---

# Quick Task 260606-kiz: Fix code-review max findings

<objective>
Fix the 13 confirmed /code-review max findings with minimal surgical changes, then run targeted tests and TypeScript checks.
</objective>

## Task 1 — Command IPC and shared type safety

**Files**
- `src/shared/types.ts`
- `src/main/ipc-handlers.ts`
- `src/main/commands/project-commands.ts`

**Action**
- Add `commands.readBody` and updated `context.currentSession(sessionId, contextLimit?)` to `ElectronAPI`.
- Harden `commands:readBody` with realpath allowlist checks and return post-frontmatter body only.
- Catch malformed YAML frontmatter per command file so one bad command does not drop the whole source.

**Verify**
- `npx vitest run src/main/commands/project-commands.test.ts src/main/commands/project-commands.test.ts src/main/commands/collectors/project.test.ts`
- `npx tsc --noEmit -p tsconfig.web.json`

## Task 2 — Goal judge and plan popup runtime correctness

**Files**
- `src/renderer/src/components/ChatArea/GoalSystemBubble.tsx`
- `src/renderer/src/hooks/useGoalJudge.ts`
- `src/renderer/src/stores/sessionStore.ts`
- `src/renderer/src/stores/planPopupStore.ts`
- `src/renderer/src/components/PlanPopup/PlanPopup.tsx`

**Action**
- Move GoalSystemBubble hooks before conditional return.
- Subscribe to streaming completion before the initial `/goal` send and preserve terminal goal status when stopping loops.
- Bind goal judge transcript and continuation messages to the original session.
- Forward planOnly stream chunks into `planPopupStore.appendChunk` and prevent execute while plan generation/modification is still streaming.

**Verify**
- `npx vitest run src/renderer/src/hooks/useGoalJudge.test.ts src/renderer/src/hooks/useGoalJudge.regression.test.tsx src/renderer/src/components/ChatArea/GoalSystemBubble.test.tsx src/renderer/src/stores/planPopupStore.test.ts src/renderer/src/components/PlanPopup/PlanPopup.test.tsx src/renderer/src/lib/commands/dispatcher.test.ts`

## Task 3 — Context and skill accounting stability

**Files**
- `src/main/deepagent/context-aggregator.ts`
- `src/main/deepagent/skill-manager.ts`
- `src/renderer/src/components/ContextModal/ContextModal.tsx`

**Action**
- Remove conversation/messages double counting from context total.
- Enforce `disable-model-invocation: true` for individual skill directories as well as parent skill directories.
- Ignore stale in-flight ContextModal IPC results after close/session/provider changes.

**Verify**
- `npx vitest run src/main/deepagent/context-aggregator.test.ts src/main/deepagent/skill-manager.test.ts src/renderer/src/components/ContextModal/ContextModal.test.tsx`
