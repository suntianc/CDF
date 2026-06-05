# Roadmap: Agent 开发工作站

**Last updated:** 2026-06-04 — v1.1 milestone shipped

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-03) — see `.planning/milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 基本能力完善** — Phases 5-8 (shipped 2026-06-04) — `/` command popup system — see `.planning/milestones/v1.1-ROADMAP.md`
- 📋 **v1.2 (next)** — planning pending (run `/gsd:new-milestone`)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4 + 03.1/03.2 inserts) — SHIPPED 2026-06-03</summary>

- [x] Phase 1: Foundation Workspace (1/1 plan) — completed 2026-05-21
- [x] Phase 2: AI Chat Engine (1/1 plan) — completed 2026-05-22
- [x] Phase 3: Agent Integration (5/5 plans) — completed 2026-05-23
- [x] Phase 3.1: 子agent 调用流程 (2/2 plans) — completed 2026-05-23
- [x] Phase 3.2: deepagents 集成系统性复核 (6/6 plans) — completed 2026-05-27
- [x] Phase 4: Workflow System (4/4 plans) — completed 2026-05-27

</details>

## ✅ v1.1 基本能力完善 (Phases 5-8) — SHIPPED 2026-06-04

**Milestone Goal:** Master Agent 对话输入框实现 Claude Code 风格的 `/` 命令 popup，覆盖 3 系统命令 + 4 源插件自动注册。

### Phase 5: Popup Shell + Keyboard Spike (completed 2026-06-04)
### Phase 6: 4-Source Command Registry + Dispatcher (completed 2026-06-04)
### Phase 7: System Commands + M3 Regression (completed 2026-06-04)
### Phase 8: Polish + Differentiators (completed 2026-06-04)

### Phase 08.1: 斜杠命令输入框内联渲染 (INSERTED)

**Goal:** 当用户在 Master Agent 对话输入框选中一个 slash 命令后，原本的纯文本 `/xxx` 替换为胶囊样式 token —— 命令图标（按 source 维度）+ 标题化名称 + 闪烁光标紧随其后；普通文本与 token 混合显示（详见参考图：浅粉圆角容器 + cube 图标 + "Gsd Fast"）。需要从 `<textarea>` 升级为 `contenteditable` 方案（或等效 overlay 渲染层），并把 Tab/Enter/Esc/Backspace 行为与既有 popup dispatch 契约对齐。
**Requirements**: TBD
**Depends on:** Phase 8
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 08.1 to break down)

**Coverage:** 15/15 SLASH requirements (SLASH-01..13 + SLASH-DISPATCH + SLASH-REGRESSION) — all validated.

## Next Milestone

`/gsd:new-milestone` to start v1.2 planning. Likely candidates:
- SQLite-backed sessions (SLASH-15 migration for `/goal` persistence)
- Deferred v1.0 cleanup (draft workflow tests, work history UI polish)
- Cross-platform CI matrix (macOS + Windows + Linux chokidar coverage)
