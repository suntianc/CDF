---
phase: 02-chat-engine
reviewed: 2026-05-22T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/main/security.ts
  - src/main/llm.ts
  - src/main/ipc-handlers.ts
  - src/preload/index.ts
  - src/renderer/src/stores/llmStore.ts
  - src/renderer/src/stores/sessionStore.ts
  - src/renderer/src/components/Settings/ModelSettings.tsx
  - src/renderer/src/components/ChatArea/ChatArea.tsx
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-22
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed 8 files spanning main process (security, LLM, IPC handlers), preload bridge, and renderer (stores, React components). Found 1 critical security issue, 4 warnings, and 3 info items. The codebase shows good patterns overall (contextBridge for security, encrypted API key storage, provider-based architecture), but has several issues that need attention before shipping.

## Critical Issues

### CR-01: API Key Encryption Bypass via Masked Placeholder

**File:** `src/main/ipc-handlers.ts:110-115`
**Issue:** When saving a provider, if the user edits the form without changing the API key, the masked placeholder `api_key: '••••••••'` is sent to `saveProvider`. The handler checks `if (api_key === '••••••••')` and preserves the existing encrypted key, which is correct. However, `encryptApiKey('••••••••')` is called if the placeholder doesn't match the condition exactly, potentially storing the literal string `'••••••••'` as an "encrypted" key.

**Fix:**
```typescript
let finalApiKey = null;
if (api_key && api_key !== '••••••••') {
  finalApiKey = encryptApiKey(api_key);
} else if (api_key === '••••••••' && existing) {
  finalApiKey = existing.api_key; // preserve existing
}
```

---

## Warnings

### WR-01: Silent JSON Parse Errors in LLM Response Processing

**File:** `src/main/llm.ts:147`
**Issue:** Empty catch block when parsing the final Ollama buffer:
```typescript
} catch (e) {}
```
This silently ignores errors that could indicate malformed responses or API changes.

**Fix:**
```typescript
} catch (e) {
  console.error('Failed to parse final Ollama buffer:', buffer, e);
}
```

---

### WR-02: Token Estimation is Inaccurate for CJK Characters

**File:** `src/renderer/src/stores/sessionStore.ts:5-18`
**Issue:** The `estimateTokens` function uses `englishChars / 4 + cjkChars`, but actual token counts for CJK characters are typically 1-2 tokens per character (not 1:1). This inaccuracy directly affects context window threshold calculations at line 223, potentially triggering cascade summarization too early or too late for CJK content.

**Fix:**
```typescript
// Use a more accurate approximation: ~1.5 tokens per CJK char
return Math.ceil(englishChars / 4) + Math.ceil(cjkChars * 1.5);
```

---

### WR-03: Race Condition in `handleWelcomeSend`

**File:** `src/renderer/src/components/ChatArea/ChatArea.tsx:111`
**Issue:** After `selectSession(newSession.id)`, the code immediately calls `sendMessage(projectId, promptText)` without awaiting the previous `fetchSessions(project.id)` call to complete. If the `selectSession` internal state update is not yet complete, `sendMessage` may fail because `activeSessionId` hasn't been updated.

**Fix:**
```typescript
await selectSession(newSession.id);
await fetchSessions(project.id); // Move before selectSession or await it
```

---

### WR-04: Floating Point Multiplication for Threshold

**File:** `src/renderer/src/stores/sessionStore.ts:223`
**Issue:** `totalTokens >= 0.85 * contextLimit` uses floating point arithmetic. While JavaScript handles this correctly, it's more readable and explicit to multiply in the other direction.

**Fix:**
```typescript
if (totalTokens >= contextLimit * 0.85) {
```

---

## Info

### IN-01: Type Safety Gap in Preload API

**File:** `src/preload/index.ts:26`
**Issue:** `chat: (requestId: string, payload: any)` uses `any` for payload. The preload is the secure bridge between main and renderer, and payload structure should be validated at the type level to catch mismatches early.

**Fix:** Define a `ChatPayload` interface in shared types and use it here.

---

### IN-02: Toast ID Generation Uses Math.random

**File:** `src/renderer/src/components/Settings/ModelSettings.tsx:51`
**Issue:** `const id = Math.random().toString(36).slice(2);` should use `crypto.randomUUID()` for cryptographically secure ID generation.

**Fix:**
```typescript
const id = crypto.randomUUID();
```

---

### IN-03: Anthropic API Key Sent as Empty String Header

**File:** `src/main/llm.ts:41`
**Issue:** `headers['x-api-key'] = apiKey || '';` sends an empty string header when `apiKey` is falsy. While this is handled gracefully by the API, it's better to omit the header entirely when no key is present.

**Fix:**
```typescript
if (apiKey) {
  headers['x-api-key'] = apiKey;
}
```

---

_Reviewed: 2026-05-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
