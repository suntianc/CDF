# Phase 6: 4-Source Command Registry + Dispatcher - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 6-4-Source Command Registry + Dispatcher
**Areas discussed:** CommandDispatchAction 4 kinds, Conflict priority semantics, MCP row granularity, Seed demo workflow, SystemLocal definition, System command argument syntax, Workflow registration scope, Registry load timing, Phase 6 scope boundary

---

## CommandDispatchAction 4 kinds

| Option | Description | Selected |
|--------|-------------|----------|
| SystemSilent / SystemLocal / PluginRewrite / PlanMode（推荐） | /goal /context 走 SystemSilent（直接写 store，零 LLM）；/plan 走 PlanMode（设 payload.overrides.planOnly）；插件命令走 PluginRewrite；/foo bar 落空时回落到 RawSend。覆盖 4 种入口最清晰。 | ✓ |
| Silent / LLMCall / Dispatcher / Error | 按是否调 LLM + 是否有副作用切。 | |
| System / Plugin / Workflow / Plan | 按命令来源切。 | |

**User's choice:** SystemSilent / SystemLocal / PluginRewrite / PlanMode（推荐）
**Notes:** 客人大人选定此分类。RawSend 落空分支被合并到 PluginRewrite（plugin 命令 args 落空时走 PluginRewrite 仍合理，无需单独 RawSend kind）。

---

## Conflict resolution priority 语义

| Option | Description | Selected |
|--------|-------------|----------|
| 仅控制 popup 行排序（推荐） | priority 高的排前面，用户手动选谁就选谁。 | ✓ |
| 排序 + 默认高亮（第一行） | 排序 + priority 高的被 cmdk 默认选中。 | |
| 排序 + 高亮 + Enter 默认行为 | Enter 时如果只有 1 个高亮就选它，如有冲突高亮 + Tab 时取 priority 最高的。 | |

**User's choice:** 仅控制 popup 行排序
**Notes:** 客人大人刻意否决"priority 影响高亮 / Enter 默认行为"，理由是"两行都保留"已经透明，强制优先级反而是隐藏的复杂性。沿用"极简原则"。

---

## MCP tool row 展示粒度

| Option | Description | Selected |
|--------|-------------|----------|
| 只 name（`mcp:arxiv_search`） | 和 Phase 5 D-01 一致。 | ✓ |
| name + 1 行 description | 副标题 1 行 12px 灰色。 | |
| name + description + 参数 schema 摘要 | 从 inputSchema 抽 first required param hint。 | |

**User's choice:** 只 name（`mcp:arxiv_search`）
**Notes:** 与 Phase 5 D-01 一致。客人大人刻意保持 popup 行密度低。MCP tool description 仅在 4 源采集时用于内部 log / debug，不暴露给 popup。

---

## Seed `/pr-review` demo workflow

| Option | Description | Selected |
|--------|-------------|----------|
| 读 diff → LLM 审查 → 写报告 | 完整端到端。 | ❌ 取消 |
| 读 diff → LLM 审查 → 显示在 chat 气泡 | 不落盘文件。 | |
| 读 diff → 委派子 agent 审查 → 汇总报告 | 用 v1.0 Phase 3.1 子 agent 能力。 | |

**User's choice:** **不需要做 demo，现在就有现成的 workflow 能力**
**Notes:** ⚠️ **CRITICAL 反向决策**。客人大人明确否决 ROADMAP §Phase 6 锁定的 seed demo workflow 决策。理由：v1.0 Phase 4 已有 workflow 能力，不需要 seed 占位。**PITFALLS P11 担忧消解**。Plan 06-03 取消，ROADMAP §Phase 6 #6 删除。

---

## SystemLocal vs SystemSilent 边界

| Option | Description | Selected |
|--------|-------------|----------|
| SystemLocal = 调本地 API + 立即 placeholder 气泡（推荐） | /context 调本地 API + 占位气泡；/goal 走 SystemSilent；/plan 走 PlanMode；插件走 PluginRewrite。 | ✓ |
| SystemLocal = 静默到可观测都包，与 SystemSilent 合并 | /goal、/context 都是「调本地 + 占位反馈」，共 3 种。 | |
| SystemLocal = 只在 /context 走「查表+加到消息」 | /context 调本地 API + 添加一条本地拼接的消息。 | |

**User's choice:** SystemLocal = 调本地 API + 立即 placeholder 气泡
**Notes:** 客人大人初始说"需要网络调研"，蕾姆做调研后发现 v1.1 既有研究 SUMMARY.md 已经把这 4 种切好了（命名 `local-silent` / `local-reply` / `plugin-rewrite` / `payload.overrides.planOnly`）。客人大人确认这 4 种 mapping 符合原始意图。业界参照：Claude Code 的 `/clear` `/compact` `/cost` `/doctor` 都是"绕过 LLM 直接操作 session 状态"的设计。

---

## 3 个斜杠命令的具体定义

| Option | Description | Selected |
|--------|-------------|----------|
| 确认现有 REQUIREMENTS.md 定义 | /goal [condition] 自由文本；/context [all] 可选 flag；/plan [description] 自由文本。 | ✓ |
| 重新设计 args 语法 | 例如支持 `--no-save` flag。 | |
| 删减某个命令 | 例如 /context 不需要。 | |

**User's choice:** 确认现有 REQUIREMENTS.md 定义
**Notes:** 客人大人说"各个斜杠命令的定义你需要调研一下"。蕾姆调研发现 v1.1 REQUIREMENTS.md 已经锁定 3 个命令语法。Phase 6 dispatcher 框架**只需识别命令名 + 透传 args 字符串**，具体 3 个命令的语义/UI 反馈全部 Phase 7。

---

## Phase 6 dispatcher 范围

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 6 只搭 dispatcher 骨架 + args 字符串透传（推荐） | 4 种 kinds；args 字符串透传；具体 3 个 command 语义在 Phase 7。 | ✓ |
| Phase 6 还需要多设计一层 args 解析层 | 支持 [all] 这种可选 flag。 | |
| 仅 /plan 需特殊处理 | /plan = free text + payload.overrides.planOnly 状态。 | |

**User's choice:** Phase 6 只搭 dispatcher 骨架 + args 字符串透传
**Notes:** 客人大人确认 Phase 6 范围克制。3 个 system command 的具体 UI 反馈（placeholder 气泡文案、token 聚合 SQL、planOnly flag 验证）全部 Phase 7。

---

## Workflow 自动注册范围

| Option | Description | Selected |
|--------|-------------|----------|
| 仅 active 状态、名称合法 → 自动注册（推荐） | 走轻量 SQL `SELECT id, name, description FROM workflows WHERE status='active'`。 | ✓ |
| active + 含特定 tag 字段才注册 | 额外 metadata 要求是重型。 | |
| 必须手工在编辑器点「slublish」才注册 | Phase 6 范围会爆。 | |

**User's choice:** 仅 active 状态、名称合法 → 自动注册
**Notes:** 客人大人坚持自动注册，理由：v1.0 workflow 已经手动管理，Phase 6 只把 active 的暴露给 popup 即可。走轻量 SQL 不调 `db:getWorkflows`（避免 `graph_data` 重数据）。

---

## Registry 加载时机

| Option | Description | Selected |
|--------|-------------|----------|
| session 启动时拉一次 + chokidar 事件增量更新（推荐） | popup 打开时拿在内存中的 state，O(1) 打开。 | ✓ |
| Lazy：popup 打开时从 IPC 拿，每次打开都新拉 | 简单，但每次打开有 IPC 往返延迟。 | |
| 两者都有：默认 lazy + 主进程 push 重要变更 | 复杂但反映。 | |

**User's choice:** session 启动时拉一次 + chokidar 事件增量更新
**Notes:** 客人大人拒绝 lazy 拉取方案（每次开 popup 走 IPC），坚持 session 启动 + chokidar 增量；popup 打开只是 memory read。O(1) 响应。

---

## Claude's Discretion

- **C-01:** source badge 文案格式（沿用 ROADMAP 提议的 `[system]` / `[skill:global]` 等）
- **C-02:** `mcp_health_warning` 灰行位置（顶部 / 底部 / inline）
- **C-03:** IPC payload schema 细节
- **C-04:** Phase 6 dispatcher 在 main 进程还是 renderer 进程
- **C-05:** 测试策略
- **C-06:** Phase 6 是否把 `slashOpen` 提到 Zustand store
- **C-07:** source badge 颜色（沿用 `<Badge>` 默认，Phase 8 polish 决定）
- **C-08:** chokidar event → renderer 的 IPC push 通道名

## Deferred Ideas

### 取消（不再做）

- ❌ seed `/pr-review` 3 节点 demo workflow — 客人大人否决，理由：v1.0 Phase 4 已有 workflow 能力

### 推 Phase 7

- args 解析层
- 3 个 system command 的具体 UI 反馈
- SLASH-REGRESSION it 块

### 推 Phase 8 polish

- 7 色彩色 source badge
- skeleton/spinner 加载态
- CJK NFKC 强化
- chokidar 失败降级 toast
- IME z-index 边界处理

### 推 v1.2+

- SLASH-15 (`/goal` SQLite 持久化)
- SLASH-17 (命令别名)
