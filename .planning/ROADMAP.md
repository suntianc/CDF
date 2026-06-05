# Roadmap: Agent 开发工作站

**Last updated:** 2026-06-05 — Phase 08.2 plans created (4 plans, 4 waves sequential)

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

### Phase 08.2: Slash command execution principle optimization (INSERTED)

**Goal:** 基于 Claude Code + Codex 桌面版调研，重构 4 核心 slash command 的执行原则：(1) `.cdf/commands/*.md` body 真正参与 dispatch（懒加载 + $ARGUMENTS/$N/$name 替换，body 作为 user message 代替原命令）；(2) `/goal` 升级为内置 judge agent 循环（首次告诉目标 + judge 不满足时把 reason 作为下轮指引，20-turn cap，4 状态系统气泡）；(3) `/context` 升级为 Claude Code 完整版 modal（11 类 breakdown + per-MCP-tool + autocompact buffer 15%，常驻按钮 + slash 双入口）；(4) `/plan` 升级为 Codex 风格弹窗 + modify loop（planOnly flag + 读写工具分级，20-turn cap）；(5) 完整 frontmatter 字段执行（disable-model-invocation / user-invocable / allowed-tools / when_to_use 全代码层强制，yaml@2.9.0 解析）。Hard Do Not Touch：runLLMChat / llm-adapter / 6-hunk patch-package。
**Requirements**: D-01..D-10, C1-01..C1-05, C2-01..C2-04, C3-01..C3-05, F-01 (CONTEXT.md locked decisions; REQUIREMENTS.md 无 REQ-IDs)
**Depends on:** Phase 8
**Plans:** 1/4 plans executed

Plans:

- [x] 08.2-01-PLAN.md — 基础设施：types/IPC/frontmatter 解析 (yaml@2.9.0)/chokidar 验证/argSubstitution/dispatcher PluginRewrite body 懒加载（D-01..D-08, D-10）
- [ ] 08.2-02-PLAN.md — /plan Codex 弹窗 + Zustand 状态机（20-turn cap）+ frontmatter 运行时强制（user-invocable + allowed-tools + planOnly tool gate 回归）（C3-01..C3-05, D-09 部分）
- [ ] 08.2-03-PLAN.md — /goal judge agent + JSON 解析（剥离 think 块）+ reason 循环（20-turn cap）+ 4 状态系统气泡（C1-01..C1-05, F-01 /goal 表面）
- [ ] 08.2-04-PLAN.md — /context Claude Code 完整版 modal（11 类 + autocompact 15%）+ 常驻按钮（info 色）+ aggregator 扩展 + skill-manager disable-model-invocation 强制（C2-01..C2-04, D-09 收尾, F-01 /context 表面）

**Cross-cutting constraints:**

- SLASH-REGRESSION green；llm.ts / llm-adapter.ts / runtime.ts 未被改动

## Next Milestone

`/gsd:new-milestone` to start v1.2 planning. Likely candidates:

- SQLite-backed sessions (SLASH-15 migration for `/goal` persistence)
- Deferred v1.0 cleanup (draft workflow tests, work history UI polish)
- Cross-platform CI matrix (macOS + Windows + Linux chokidar coverage)
