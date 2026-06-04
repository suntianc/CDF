---
phase: 8
slug: polish-differentiators
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@4.1.8` + `@testing-library/react@16.x` + jsdom (renderer) + node (main) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/renderer/src/components/SlashCommand/SlashCommandPopup.test.tsx src/renderer/src/hooks/useCommandRegistry.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds (226 existing + ~10 new tests) |

---

## Sampling Rate

- **After every task commit:** Quick run on the specific test file
- **After every plan wave:** Full suite (must remain green — no Phase 7 regressions)
- **Before `/gsd:verify-work`:** Full suite green + all 5 success criteria verified
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | A | SC-1/D-01..D-04 | T-08-T1 | Badge 文字色按 7 个 source 区分 | unit | `npx vitest run src/renderer/src/components/SlashCommand/SlashCommandPopup.test.tsx -t "applies source color class"` | ❌ Wave 0 | ⬜ pending |
| 08-01-02 | 01 | A | SC-2/D-05d | T-08-T2 | NFKC + variation selector 后 `/🎉` 与 `/🎉︎` 匹配一致 | unit | `npx vitest run ... -t "filters variation-selector emoji"` | ❌ Wave 0 | ⬜ pending |
| 08-01-03 | 01 | A | SC-2/D-06 | T-08-T3 | 预 normalize Map 在 displayCommands 变化时刷新 | unit | `npx vitest run ... -t "rebuilds normalized map"` | ❌ Wave 0 | ⬜ pending |
| 08-01-04 | 01 | A | SC-3/D-12 | T-08-T4 | Skeleton 行渲染 `data-testid='mcp-skeleton'` | unit | `npx vitest run ... -t "renders skeleton row when loading=slow"` | ❌ Wave 0 | ⬜ pending |
| 08-02-01 | 02 | B | SC-3/D-07..D-11 | T-08-T5 | 500ms 触发 loading='slow'; IPC resolve 后清除 | unit | `npx vitest run src/renderer/src/hooks/useCommandRegistry.test.ts -t "slow loading"` | ❌ Wave 0 | ⬜ pending |
| 08-03-01 | 03 | C | SC-5/D-16..D-19 | T-08-T6 | chokidar 失败 → readdir fallback + toast.warning + 不重试 | unit | `npx vitest run src/main/commands/chokidar-watcher.test.ts -t "fallback"` | ❌ Wave 0 | ⬜ pending |
| 08-03-02 | 03 | C | SC-5/D-17 | T-08-T7 | toast.warning 单次显示（dedup by error fingerprint） | unit | `npx vitest run src/renderer/src/hooks/useCommandRegistry.test.ts -t "toast warning on fallback"` | ❌ Wave 0 | ⬜ pending |
| 08-04-01 | 04 | D | SC-4/D-13..D-15 | T-08-T8 | IME z-index 注释存在; Esc-once 提示可见 | unit (string match) | `npx vitest run ... -t "IME z-index comment"` | ❌ Wave 0 | ⬜ pending |
| 08-XX-XX | 01-04 | A-D | (latent bug fix) | T-08-T9 | `<Toaster />` mounted in App.tsx — Phase 6/7 toasts become visible | unit (render App, verify toaster in DOM) | `npx vitest run src/App.test.tsx` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/renderer/src/components/SlashCommand/SlashCommandPopup.test.tsx` — extend with 4 Phase 8 popup tests (badge color / CJK / skeleton / IME)
- [ ] `src/renderer/src/hooks/useCommandRegistry.test.ts` — extend with 3 Phase 8 hook tests (slow loading / fallback toast / dedup)
- [ ] `src/main/commands/chokidar-watcher.test.ts` — extend with 2 Phase 8 fallback tests (readdir + no retry)
- [ ] `src/App.test.tsx` — new test verifying `<Toaster />` mounted (latent bug fix)

---

## Manual-Only Verifications

| Behavior | SC | Why Manual | Test Instructions |
|----------|-----|------------|-------------------|
| 7 色彩色视觉区分 | SC-1 | 颜色感知 + 暗色主题对比 | dev build → 触发 system/MCP/skill/workflow 5+ 不同源命令 → 视觉确认 7 色 |
| MCP skeleton spinner 实际渲染 | SC-3 | 真实 IPC 延迟 500ms 触发需慢网络 | dev build → 配置外部 MCP server (远程) → 打开 popup → 看到 skeleton 1 行 |
| chokidar 降级 toast | SC-5 | 真实 chokidar 失败需文件系统只读权限 | dev build → chmod 0 项目目录 → 启动 → 看到 "项目命令热重载不可用" toast |
| IME 候选框 z-index | SC-4 | macOS 真实 OS 级 z-index 行为 | macOS dev build → 激活拼音 → 在 textarea 输入 → 候选框覆盖 popup → Esc 关闭候选 → popup 仍可见 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (including App.test.tsx for Toaster mount)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] Phase 7 regressions: 0 (full suite remains green)
- [ ] Latent bug fix verified: `<Toaster />` mounted → Phase 6/7 toasts now visible
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
