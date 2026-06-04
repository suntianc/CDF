# Milestones

## v1.1 基本能力完善 (Shipped: 2026-06-04)

**Phases completed:** 4 phases, 10 plans
**Test results:** 241/243 passing (2 pre-existing v1.0 failures out of scope)
**Commits:** 50 (v1.0 tag → v1.1 tag)

**Key accomplishments:**

- **Popup shell** — cmdk + Radix Popover 锚定在裸 textarea 上，`/` 触发 + 字母过滤 + ↑↓/Enter/Esc/Backspace 键盘导航，11 edge-case tests passing (Phase 5)
- **4-source command registry** — system / skill:global / skill:project / workflow / mcp / cmd:system / cmd:project 共 7 源聚合 + CommandConflictError 冲突检测 + chokidar@3.6.0 热重载，48 tests passing across 7 files (Phase 6)
- **4-kind dispatcher** — SystemSilent / SystemLocal / PluginRewrite / PlanMode 走 `llm:chat` 现有 IPC 通路自然语言 prompt 重写（不新增 dispatch 通道），保护 6-hunk patch-package (Phase 6)
- **3 system commands** — `/goal` (内存 sessionGoals Map) / `/context` (token 聚合) / `/plan` (overrides.planOnly 走 llm.ts:324 扩展点) (Phase 7)
- **SLASH-REGRESSION it blocks** — llm-adapter.test.ts / llm.test.ts / runtime.test.ts 3 处 M3 thinking 链保留断言，作为 6-hunk patch-package 护栏 (Phase 7)
- **Polish** — 7-color source badge + CJK NFKC + variation selector strip + 5-state loading machine (500ms slow threshold) + Skeleton row + chokidar 降级 readdir fallback + commands:fallback IPC + sonner toast dedup (C-04 fingerprint Set) (Phase 8)
- **Latent bug fix** — Phase 6/7 toasts were silent because `<Toaster />` was never mounted; App.tsx now wraps the tree in `<Toaster richColors position="bottom-right" theme="dark" />` (Phase 8 08-01)

**Tech debt carried forward to v1.2:**

- `/goal` 内存存储（sessionGoals Map）— 需迁 SQLite（SLASH-15）
- 2 pre-existing v1.0 test failures (file-tools.test.ts + skill-manager.test.ts) — out of scope for v1.1
- macOS IME 候选框 z-index 已知 issue（已加 pointer comment + "Esc 关一次" work-around 注释）

**Known deferred items at close:** 25 v1.0-era debug sessions + 1 verification_gap (Phase 5 stale) + 2 uat_gaps (Phases 03.1/05 stale) — all from v1.0 era, none affect v1.1 shipped scope. See STATE.md Deferred Items section.

---

## v1.0 Agent 开发工作站 MVP (Shipped: 2026-06-03)

**Phases completed:** 6 phases, 21 plans, 39 tasks

**Key accomplishments:**

- Completed Date:
- Status:
- Status:
- Status:
- Status:
- Status:
- Status:
- Subagent delegation runtime with slug-based task naming, enabled task tool, and structured result schema
- Delegated task tracking and rendering: sessionStore tracks delegated task state, TaskPanel renders task nodes with status/error codes, llm.ts emits delegated_task_start/end events
- Runtime createDeepAgent 参数对齐官方文档，FilesystemBackend 替换为 CompositeBackend 包装实现项目文件隔离
- Context management verification: checkpoint namespace safe, message deduplication correct, SummarizationMiddleware auto-added with 85% threshold
- Subagent tools 显式包含内置工具防止覆盖丢失，skills 正确配置，systemPrompt 移除冗余 JSON Schema 指令
- 人机协同 interruptOn 配置验证：langchain DecisionType 仅支持 approve/edit/reject 三种，研究文档声称的 respond 类型不存在于实际代码
- MCP 传输类型 SSE 迁移到 Streamable HTTP，前端 UI 同步更新，streamEvents/initChatModel/todo 轮询三项评估完成
- 汇总 5 个模块 39 项检查结果，生成包含问题分类、架构优化建议和行动计划的综合报告
- Workflow data layer: TypeScript types, SQLite persistence, IPC handlers, preload bridge, and Zustand store for graph-based workflow system
- LangGraph.js StateGraph execution engine with DeepAgent node integration, conditional routing, loop protection, and IPC event streaming
- ReactFlow-based workflow editor with custom nodes, Agent config drawer, workflow list, and execution monitoring panel
- DeepAgent workflow tools registration + all workflow TypeScript errors resolved for end-to-end integration

---
