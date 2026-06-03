# Roadmap: Agent 开发工作站

**Last updated:** 2026-06-03 after v1.0 milestone close

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-03) — see `.planning/milestones/v1.0-ROADMAP.md`
- 📋 **v1.1** — TBD (planning not started; candidates: workflow history UI polish, draft workflow tests, v1 quick task backlog)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4 + 03.1/03.2 inserts) — SHIPPED 2026-06-03</summary>

### Phase 1: Foundation Workspace
**Goal:** 开发者可启动应用，看到主界面框架，支持主题切换和项目管理基础
**Plans:** 1/1 complete (2026-05-21)

### Phase 2: AI Chat Engine
**Goal:** 用户可与 Master Agent 进行多轮对话，配置 LLM 提供者，对话历史持久化
**Plans:** 1/1 complete (2026-05-22)

### Phase 3: Agent Integration
**Goal:** 开发者可定义 Agent 角色，配置其 LLM/MCP/Skills 资源
**Plans:** 5/5 complete (2026-05-23)

### Phase 03.1: 子agent 调用流程 (INSERTED)
**Goal:** 实现 Master Agent 调用子Agent 的完整流程（subagentIds 白名单、Agent.slug 稳定键、DelegatedTaskResultSchema）
**Plans:** 2/2 complete

### Phase 03.2: deepagents 集成系统性复核 (INSERTED)
**Goal:** 按模块复核 deepagents.js 集成代码（Runtime / Context / Subagent / Human-in-loop / Optimization）
**Plans:** 6/6 complete (2026-05-27)

### Phase 4: Workflow System
**Goal:** ReactFlow 可视化编排工作流，langgraph.js 执行引擎
**Plans:** 4/4 complete (2026-05-27)

</details>

## v1.0 Post-Milestone Stabilization (Quick Tasks)

8 quick tasks completed on 2026-06-03 (after v1.0 phase work, before v1.0 close):

| Quick ID | Subject | Note |
|---|---|---|
| 260603-s29 | M3 thinking 开关 | Open MiniMax M3 extended thinking on client |
| 260603-se4 | M3 + temperature 互斥 | Anthropic protocol: temperature unset when thinking |
| 260603-soe | M3 多轮 signature 回带 | LangChain v1 path roundtrip test |
| 260603-tiy | real-fix #1 | Patch fallthrough path reasoning → thinking |
| 260603-u6w | real-fix #2 | Remove isAnthropicMessage guard in v1 path |
| 260603-vht | video .cjs parity | Backfill standard.cjs video passthrough hunk |
| 260603-w0y | .codegraph gitignore | Stop daemon.pid from polluting git status |
| 260603-wd4 | GSD cleanup helper | Project-level script + PreToolUse hook |

Plus 1 parallel by Suntc 君: `feat(workflow): hide draft workflows from Agent + defensive status check` (commit 8608b87).

## v1.1 Candidates (待规划)

- **Workflow execution history UI polish** — 260602-0ed lay the foundation (DB columns + IPC + drawer); needs final UI wiring
- **draft workflow testing + a11y improvements** — Suntc 君's parallel work needs test coverage
- **MCP connection/disconnect mgmt** — partially delivered in v1.0
- **Skills versioning + execution log UI** — basic creation shipped, full UX pending
- **Anthropic extended thinking test matrix expansion** — 5 it blocks cover happy paths; need edge cases (multi-turn signature drift, tool_use interleaving, etc.)

## Coverage

**Requirements:** 25 total v1 requirements
**Mapped to v1.0:** 19 (76%)
**Shipped (validated):** 14 with full UI polish + 5 partially delivered (UI/API present, full feature pending)
**Unmapped:** 0
**Deferred to v1.1+:** ~5-7 (see PROJECT.md Known Gaps)

## Notes for next milestone planning

- v1.0 shipped 8 post-milestone quick tasks to stabilize M3 + tooling — these are NOT a separate "v1.0.x" milestone, they're absorbed into v1.0's archive
- 6-hunk patch-package lock on `@langchain/anthropic@1.4.0` is durable but tied to that version — upgrade will require re-validation
- `scripts/gsd-cleanup-worktree.sh` + PreToolUse hook in `.claude/settings.json` reduce future quick task cleanup overhead by ~5 min each
