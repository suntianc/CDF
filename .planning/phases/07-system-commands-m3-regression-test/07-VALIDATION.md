---
phase: 7
slug: system-commands-m3-regression-test
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@4.1.8` + `@testing-library/react@16.x` + jsdom (renderer) + node (main) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/main/deepagent/llm-adapter.test.ts src/renderer/src/lib/commands/dispatcher.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds (139 existing + ~10 new tests) |

---

## Sampling Rate

- **After every task commit:** Quick run on the specific test file
- **After every plan wave:** Full suite (must remain green — no Phase 6 regressions)
- **Before `/gsd:verify-work`:** Full suite green + SLASH-REGRESSION 3 it blocks green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | A | SLASH-05 | T-07-T1 | `setSessionGoal` writes to Map; trim X; UI bubble render | unit | `npx vitest run src/renderer/src/stores/sessionStore.test.ts` | ❌ Wave 0 | ⬜ pending |
| 07-01-02 | 01 | A | SLASH-06 | T-07-T2 | `context:currentSession` returns breakdown (对话+skills+mcp+workflow tokens) | unit | `npx vitest run src/main/ipc-handlers.context.test.ts` | ❌ Wave 0 | ⬜ pending |
| 07-01-03 | 01 | A | SLASH-07 | T-07-T3 | `/plan` placeholder bubble render; `[plan]` marker | unit | `npx vitest run src/renderer/src/components/ChatArea/ChatArea.handleSend.test.tsx` | ❌ Wave 0 | ⬜ pending |
| 07-02-01 | 02 | B | SLASH-05/06/07 | T-07-T4 | `dispatcher SystemSilent/SystemLocal/PlanMode` calls real impls (not console.log) | unit | `npx vitest run src/renderer/src/lib/commands/dispatcher.test.ts` | ✅ exists | ⬜ pending |
| 07-02-02 | 02 | B | SLASH-05/06 | T-07-T5 | `useSessionStore.sessionGoals` Map persists across session switch | unit | `npx vitest run src/renderer/src/stores/sessionStore.test.ts` | ❌ Wave 0 | ⬜ pending |
| 07-03-01 | 03 | C | SLASH-07 | T-07-T6 | `handleSend` 5-line sniff 3 cases (D-15): 开头 `/` 识别;中段 `/baz` 不识别;`/  foo` fall-through | unit | `npx vitest run src/renderer/src/components/ChatArea/ChatArea.handleSend.test.tsx` | ❌ Wave 0 | ⬜ pending |
| 07-04-01 | 04 | C | SLASH-REGRESSION | T-07-T7 | It 7.1: `/plan` 路径首段 message_chunk 含 `<think>` | unit | `npx vitest run src/main/deepagent/llm-adapter.test.ts` | ❌ Wave 0 | ⬜ pending |
| 07-04-02 | 04 | C | SLASH-REGRESSION | T-07-T8 | It 7.2: plan 模式不触发 `write_file` / `edit_file` / `bash` 工具 | unit | `npx vitest run src/main/deepagent/runtime.test.ts` | ❌ Wave 0 | ⬜ pending |
| 07-04-03 | 04 | C | SLASH-REGRESSION | T-07-T9 | It 7.3: slash `/plan` 完整 roundtrip 保留 M3 thinking chain | unit | `npx vitest run src/main/llm.test.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/renderer/src/stores/sessionStore.test.ts` — extend with 3 sessionGoals tests (D-04/D-05)
- [ ] `src/main/ipc-handlers.context.test.ts` — new file, 4-5 tests for `context:currentSession`
- [ ] `src/renderer/src/components/ChatArea/ChatArea.handleSend.test.tsx` — new file, 3 tests for 5-line sniff
- [ ] `src/main/deepagent/llm-adapter.test.ts` — extend with SLASH-REGRESSION it 7.1
- [ ] `src/main/deepagent/runtime.test.ts` — extend with SLASH-REGRESSION it 7.2
- [ ] `src/main/llm.test.ts` — extend with SLASH-REGRESSION it 7.3 + payload.overrides.planOnly propagation
- [ ] `src/renderer/src/lib/commands/dispatcher.test.ts` — extend with SystemSilent/SystemLocal/PlanMode real impl tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/goal` placeholder 气泡视觉 (200ms 内) | SLASH-05 | 真实 React 渲染时序 | dev build → 输入 `/goal X` → 看到 `[system] 正在执行 /goal…` 气泡 |
| `/context` 气泡 breakdown 表格 | SLASH-06 | token 聚合需要真实数据 | dev build → 加载 MCP server + 创建 workflow → 输入 `/context` → 看到 breakdown |
| `/plan` 气泡持续到首个 `message_chunk` | SLASH-07 | LLM 真实响应时序 | dev build → 输入 `/plan X` → 看到 `[plan]` 气泡 → 等待 LLM 响应 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] SLASH-REGRESSION 3 it blocks green (load-bearing for 6-hunk patch-package)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
