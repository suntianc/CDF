---
phase: 6
slug: 4-source-command-registry-dispatcher
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@4.1.8` + `@testing-library/react@16.x` |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run <pattern> 2>&1 \| tail -30` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds (renderer unit) + chokidar integration ~30s |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <relevant-test-file>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green + CI matrix green (mac/win/linux)
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | SLASH-03 / SLASH-12 | T-06-T1 | registry.build() never silently overwrites (throws CommandConflictError) | unit | `npx vitest run command-registry.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-01-02 | 01 | 1 | SLASH-08 / SLASH-09a/09b / SLASH-10 / SLASH-11a/11b | T-06-T2 | 5 源采集器各自独立失败不影响其他 4 源 (Promise.allSettled) | unit | `npx vitest run collectors/*.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-01-03 | 01 | 1 | SLASH-03 | T-06-T3 | priority only controls sort; 排序后两行都保留 | unit | `npx vitest run conflict-detector.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-01-04 | 01 | 1 | SLASH-11a/11b | T-06-T4 | YAML frontmatter 解析防注入（`$ARGUMENTS` 不执行） | unit | `npx vitest run project-commands.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-02-01 | 02 | 1 | SLASH-04 | T-06-T5 | dispatcher 4 kinds 分支（SystemSilent/SystemLocal/PluginRewrite/PlanMode） | unit | `npx vitest run dispatcher.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-02-02 | 02 | 1 | SLASH-DISPATCH | T-06-T6 | PluginRewrite args 走 message.content 不传 tool schema | unit | `npx vitest run dispatcher-llm-chat.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-02-03 | 02 | 1 | SLASH-13 | T-06-T7 | chokidar write 200ms 后触发 onChange，跨平台 | integration | `npx vitest run chokidar-watcher.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-02-04 | 02 | 1 | SLASH-03 | T-06-T8 | `mcp_health_warning` 灰行：MCP tools 为空时显示 | unit | `npx vitest run mcp-collector.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-02-05 | 02 | 1 | (D-25) | T-06-T9 | 跨平台 CI matrix | CI | GitHub Actions workflow | ❌ Wave 0 | ⬜ pending |
| 06-XX-XX | 01-02 | 1 | (C-05) | — | e2e: `/plan` 触发 planOnly flag + `/arxiv_search` 走 PluginRewrite | e2e | manual + vitest | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/main/commands/command-registry.test.ts` — 5 源采集 + merge + 5 conflict cases
- [ ] `src/main/commands/collectors/mcp.test.ts` — MCP 源采集 + mcp_health_warning
- [ ] `src/main/commands/collectors/skill.test.ts` — Skills 2 亚源合并（project wins）
- [ ] `src/main/commands/collectors/workflow.test.ts` — Workflow 轻量 SQL 过滤
- [ ] `src/main/commands/collectors/project.test.ts` — Custom commands 2 亚源
- [ ] `src/main/commands/project-commands.test.ts` — YAML frontmatter 解析 + $ARGUMENTS 替换
- [ ] `src/main/commands/chokidar-watcher.test.ts` — write 200ms 后触发 onChange
- [ ] `src/main/commands/conflict-detector.test.ts` — 5 conflict case（同 name 跨 priority）
- [ ] `src/renderer/src/lib/commands/dispatcher.test.ts` — 4 kinds 分发 + args 透传
- [ ] `src/renderer/src/hooks/useCommandRegistry.test.ts` — IPC 拉取 + sort + conflict toast
- [ ] `src/renderer/src/components/SlashCommand/SlashCommandPopup.test.tsx` — 扩展现有 19 测试：source badge 渲染 + description 条件渲染 + mcp_health_warning 灰行
- [ ] Framework install: `npm install --save chokidar@^3.6.0 sonner@^2.0.7` (Wave 0 task)
- [ ] CI matrix: `.github/workflows/phase-6-commands.yml` (Wave 0 task)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `mcp_health_warning` 实际渲染 | SLASH-13 | MCP connection state in real env | dev build → 配置空 MCP server → 打 `/` → 看到灰行 |
| chokidar 跨平台行为 | SLASH-13 | macOS fsevents / Windows ReadDirectoryChangesW 不可在 jsdom 模拟 | CI matrix run (D-25) |
| IPC 端到端 | SLASH-DISPATCH | Electron contextBridge 不可在 vitest 模拟 | 手动 e2e 启动 dev build |
| `/plan` 触发 planOnly flag | SLASH-07 (Phase 7 主体) | Phase 6 占位分支；Phase 7 验证 | 手动 dev build + 走通 /plan 路径 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
