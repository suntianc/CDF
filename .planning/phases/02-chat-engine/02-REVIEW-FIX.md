---
phase: 02-chat-engine
fixed_at: 2026-05-22T00:00:00Z
review_path: .planning/phases/02-chat-engine/02-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-22
**Source review:** .planning/phases/02-chat-engine/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (1 CR + 4 WR)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: API Key Encryption Bypass via Masked Placeholder

**Files modified:** `src/main/ipc-handlers.ts`
**Commit:** 399d9a6
**Applied fix:** Changed the conditional logic to explicitly check `api_key && api_key !== '••••••••'` before encrypting, and preserve existing key only when placeholder matches. This prevents encrypting an empty string or the placeholder literal.

### WR-01: Silent JSON Parse Errors in LLM Response Processing

**Files modified:** `src/main/llm.ts`
**Commit:** 5e59bff
**Applied fix:** Added `console.error('Failed to parse final Ollama buffer:', buffer, e);` to the empty catch block for better debugging of malformed responses.

### WR-02: Token Estimation is Inaccurate for CJK Characters

**Files modified:** `src/renderer/src/stores/sessionStore.ts`
**Commit:** afa6853
**Applied fix:** Changed `cjkChars` token estimation from 1:1 ratio to `Math.ceil(cjkChars * 1.5)` which reflects actual token counts for CJK content.

### WR-03: Race Condition in `handleWelcomeSend`

**Files modified:** `src/renderer/src/components/ChatArea/ChatArea.tsx`
**Commit:** 775e5f8
**Applied fix:** Added `await fetchSessions(project.id);` after `await selectSession(newSession.id)` to ensure session state is fully updated before calling `sendMessage`.

### WR-04: Floating Point Multiplication for Threshold

**Files modified:** `src/renderer/src/stores/sessionStore.ts`
**Commit:** afa6853
**Applied fix:** Changed `0.85 * contextLimit` to `contextLimit * 0.85` for better readability (same mathematical result).

---

_Fixed: 2026-05-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
