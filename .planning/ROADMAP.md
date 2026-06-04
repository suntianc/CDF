# Roadmap: Agent 开发工作站

**Last updated:** 2026-06-04 — v1.1 milestone start

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-03) — see `.planning/milestones/v1.0-ROADMAP.md`
- 🚧 **v1.1 基本能力完善** — Phases 5-8 (in progress) — `/` command popup system

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

**Goal:** 实现 Master Agent 调用子Agent 的完整流程
**Plans:** 2/2 complete

### Phase 03.2: deepagents 集成系统性复核 (INSERTED)

**Goal:** 按模块复核 deepagents.js 集成代码
**Plans:** 6/6 complete (2026-05-27)

### Phase 4: Workflow System

**Goal:** ReactFlow 可视化编排工作流，langgraph.js 执行引擎
**Plans:** 4/4 complete (2026-05-27)

</details>

### 🚧 v1.1 基本能力完善 (In Progress)

**Milestone Goal:** 在 Master Agent 对话输入框实现 Claude Code 风格的 `/` 命令 popup，覆盖 3 系统命令 + 4 源插件自动注册的极简设计，让用户用 `/` 探索和触发系统所有能力。

**Reference:** `.planning/research/SUMMARY.md` (high-confidence synthesis)

**Granularity:** standard (4 phases; SUMMARY-recommended)

**Coverage:** 15/15 SLASH requirements mapped (SLASH-01..13 + SLASH-DISPATCH + SLASH-REGRESSION)

- [x] **Phase 5: Popup Shell + Keyboard Spike** - cmdk + Radix Popover 锚定在裸 textarea 上，`/` 触发 + 字母过滤 + ↑↓/Enter/Esc/Backspace 键盘导航 (completed 2026-06-04)
- [ ] **Phase 6: 4-Source Command Registry + Dispatcher** - 3 系统 + 4 插件源注册表（含 2 源 skills: global `~/.cdf/skills/` + project `<projectPath>/.cdf/skills/`；2 源 commands: system `~/.cdf/commands/` + project `<projectPath>/.cdf/commands/`）+ 4 种 CommandDispatchAction 分发 + chokidar 热重载
- [ ] **Phase 7: System Commands + M3 Regression Test** - `/goal` / `/context` / `/plan` 三系统命令 + M3 thinking 保留回归测试
- [ ] **Phase 8: Polish + Differentiators** - 源 badge 视觉打磨（`[skill:global]` vs `[skill:project]` 等 5 色）+ IME z-index + CJK NFKC 过滤 + 加载态 + 错误降级

---

## Phase Details

### Phase 5: Popup Shell + Keyboard Spike

**Goal:** 验证在现有裸 textarea 上叠加 cmdk + Radix Popover 路径可行，确立 `/` 触发的 popup 壳层与键盘导航契约
**Depends on:** Phase 4 (v1.0 收尾)
**Requirements:** SLASH-01, SLASH-02
**Success Criteria** (what must be TRUE):

  1. 用户在 Master Agent 对话输入框打 `/` 立即弹出命令 popup（与 Claude Code 行为一致），`/` 之前的中文/字母自动消失
  2. 用户继续打字，popup 行按不区分大小写子串过滤；↑↓ 在行间循环移动、Enter 触发当前行、Esc 关 popup、Backspace 在只剩 `/` 时关 popup
  3. IME 中文/日文输入法期间 `onChange` 不误触 popup 开关（`isComposingRef` + 200ms `justFinishedComposingRef`）
  4. Shift+Enter 仍然插入换行不触发命令、用户按 Esc 关闭 popup 后焦点回到 textarea 光标位置不漂移
  5. popup 显示固定 3 个硬编码系统命令占位行（`/goal` `/context` `/plan`），即便插件源未注册也能看到这 3 行

**Plans**: 2 plans
**UI hint**: yes

Plans:
**Wave 1**

- [x] 05-01: cmdk + Radix Popover 壳层 PoC（`npm install cmdk@1.1.1 @radix-ui/react-popover@1.1.15` + `popover.tsx` shim + `SlashCommandPopup.tsx` 组件 + ChatArea wire 5 个插入点 + 8 基础 vitest 单元测试）

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02: 键盘契约测试（9 边界 vitest 单元测试：Esc/Backspace/↑↓ wrap/NFKC/period/double-slash/IME safety×2/Shift+Enter/D-04 reopen-top + 手动 checkpoint：PopoverAnchor layout + IME 候选框 z-index + cmdk Enter 事件序）

### Phase 6: 4-Source Command Registry + Dispatcher

**Goal:** 建立 6 源命令注册表（3 系统 + MCP + Skills-global + Skills-project + Workflow + Commands-system + Commands-project — 实际 5 源 + Skills 2 亚源 + Commands 2 亚源）与 4 种 CommandDispatchAction 分发器，插件命令通过 `llm:chat` 现有 IPC 通路自然语言重写后发送
**Depends on:** Phase 5
**Requirements:** SLASH-03, SLASH-04, SLASH-08, SLASH-09a, SLASH-09b, SLASH-10, SLASH-11a, SLASH-11b, SLASH-12, SLASH-13, SLASH-DISPATCH
**Success Criteria** (what must be TRUE):

  1. popup 列出 3 系统命令 + 所有已注册插件命令，每行带源 badge：`[system]` / `[skill:global]` / `[skill:project]` / `[workflow]` / `[mcp:serverId]` / `[cmd:system]` / `[cmd:project]`
  2. **MCP args semantics** (SLASH-08 clarification): 用户打 `/arxiv_search foo bar` → 工具以无参方式调用；`foo bar` 作为自然语言上下文附加到 `llm:chat` payload（不传给 tool；避免 PITFALLS P7 命令注入）
  3. **Skills 2 源** (SLASH-09a/09b): global skills 读 `~/.cdf/skills/`，project skills 读 `<projectPath>/.cdf/skills/`；同 name → project wins
  4. **Custom commands 2 源** (SLASH-11a/11b): system 读 `~/.cdf/commands/*.md`，project 读 `<projectPath>/.cdf/commands/*.md`；同 name → project wins
  5. MCP 工具通过 `loadMcpTools(agentId, mcpServers)` 复用 `mcpCache`（不重连），自动以 `/${mcp_tool_name}` 注册；空 tools 列表时 popup 不静默、显示 `mcp_health_warning` 行
  6. *(已取消 — 客人大人 2026-06-04 决定：v1.0 Phase 4 已有 workflow 能力，无需 seed demo workflow 占位；PITFALLS P11 担忧消解)* 新 SQL `SELECT id, name, description FROM workflows WHERE status='active'` 走轻量路径，**不**调 `db:getWorkflows`（避免 `graph_data` 重数据）
  7. `<projectPath>/.cdf/commands/*.md` 与 `~/.cdf/commands/*.md` 命令被读取，YAML frontmatter（`name` `description` `argument-hint`）解析；`$ARGUMENTS` 占位符在 body 内替换后再做自然语言 prompt 重写
  8. 同名冲突按优先级 `system > skill:project > skill:global > workflow > mcp > cmd:project > cmd:system` 解析（项目覆盖全局，技能优先于命令）；**两行都保留**带 badge；registry 构建期冲突抛 `CommandConflictError` 触发 sonner toast
  9. 插件命令以 `请调用 ${tool} 工具，参数：${args}` 自然语言 prompt 走现有 `llm:chat` IPC 通路（不新增 dispatch 通道），M3 reasoning chunk 仍作为 `message_chunk` 首段发出
  10. session 启动 + `~/.cdf/commands/` 与 `<projectPath>/.cdf/commands/` 两路都用 chokidar@3.6.0 `awaitWriteFinish: { stabilityThreshold: 200 }` 监听；MCP 健康事件触发插件源重新拉取

**Plans**: 2 plans (06-01 main 注册表数据层 + 06-02 dispatcher/IPC/chokidar 集成层；原 plan 06-03 demo workflow seed 已取消 2026-06-04)
**UI hint**: yes (7-color source badge row styling, mcp_health_warning banner)

Plans:

- [ ] 06-01: main 端 command-registry.ts（5 源采集 + 2 亚源 skills + 2 亚源 commands + 冲突检测 + CommandConflictError）+ project-commands.ts + Workflow 源 active SQL 拉取 + 4 shared/types + CI 跨平台 matrix（mac/win/linux）
- [ ] 06-02: dispatcher.ts（4 种 CommandDispatchAction kinds）+ useCommandRegistry hook + IPC `commands:list` + `commands:readProjectCommands` + preload 桥接 + chokidar 双路热重载 + SlashCommandPopup source badge 列 + mcp_health_warning 行 + ChatArea handleSlashSelect 改造
- ~~[ ] 06-03: seed `/pr-review` 3 节点 demo workflow~~ **已取消**（2026-06-04 客人大人决定）

### Phase 7: System Commands + M3 Regression Test

**Goal:** 实现 3 个系统命令（`/goal` / `/context` / `/plan`），并加入 M3 thinking 保留回归测试作为 6-hunk patch-package 的护栏
**Depends on:** Phase 6
**Requirements:** SLASH-05, SLASH-06, SLASH-07, SLASH-REGRESSION
**Success Criteria** (what must be TRUE):

  1. 用户打 `/goal X`，popup 关后立即出现 `[system] 正在执行 /goal…` 占位气泡（200ms 内），`useSessionStore.sessionGoals: Map<sessionId, string>` 写入 X，**无 LLM 调用**
  2. 用户打 `/context [all]`，popup 关后立即出现静态气泡显示当前 session token 用量（从 `messages` 表聚合），**无 LLM 调用**
  3. 用户打 `/plan X`，dispatcher 走 `llm:chat` 时设置 `payload.overrides = { planOnly: true }`（llm.ts:324 扩展点）；首个 `message_chunk` 必须含 `<think>…plan only…</think>`，整个回合**不**触发 `write_file` / `edit_file` / `bash` 工具调用
  4. `llm-adapter.test.ts`（或 `llm.test.ts`）新增 it 块覆盖"slash 路径下首段 message_chunk 含 `<think>`"；这是 6-hunk patch-package 锁定 `@langchain/anthropic@1.4.0` 的负载测试
  5. 命令仅在消息开头识别：`handleSend` 前 5 行 sniff `value.startsWith('/') && selectionStart` 校验；3 个 case 单测（开头 `/`、`/foo bar` 中段 `/baz` 不识别、`/  foo` 仅 trim 后空 args）

**Plans**: TBD (likely 2 plans: 1 系统命令实现 + 1 M3 regression test 接入)
**UI hint**: yes (system command placeholder bubble + plan mode placeholder)

Plans:

- [ ] 07-01: `/goal` + `/context` + `/plan` 三个 dispatcher 分支 + placeholder 气泡 + session 开头识别 sniff
- [ ] 07-02: SLASH-REGRESSION it 块接入（`llm-adapter.test.ts` / `llm.test.ts`），含 `<think>` chunk 首段断言 + no-tool-call-in-plan-mode 断言

### Phase 8: Polish + Differentiators

**Goal:** 在稳定基座上加入源 badge 视觉打磨、加载态、CJK 过滤、IME z-index 健壮性等 v1.1 polish 细节，让 popup 用起来"丝滑"而非"能用"
**Depends on:** Phase 7
**Requirements:** (no new SLASH-XX; v1.1 polish from FEATURES.md D1/D2/D7/D13/D14/D15 + PITFALLS P1/P4/P6 residual concerns)
**Success Criteria** (what must be TRUE):

  1. 源 badge 视觉上可一眼区分（`[system]` 蓝 / `[skill:global]` 紫灰 / `[skill:project]` 紫 / `[workflow]` 绿 / `[mcp:serverId]` 橙 / `[cmd:system]` 灰 / `[cmd:project]` 深灰 — 7 色），且不破坏 5 行 popup 视觉密度
  2. CJK 技能名（`代码审查` 等）输入 `/代` 能正确 NFKC 归一化匹配，不区分全/半角、不区分 Unicode 组合字符
  3. MCP 源慢加载时（>500ms）popup 行显示 skeleton spinner，**不**让 popup 跳变；加载失败显示 `mcp_health_warning` 灰行而非静默
  4. popup z-index ≥ 50，IME 中文候选框 z-index 9999 时候选不覆盖 popup（macOS 已知 issue：候选框期间可 Esc 一次关 popup）
  5. chokidar 失败时降级为 readdir 一次扫描 + UI toast "项目命令热重载不可用，已降级为静态扫描"（不打断用户）

**Plans**: TBD (likely 1 polish plan)
**UI hint**: yes

Plans:

- [ ] 08-01: 源 badge 视觉系统 + skeleton/spinner 加载态 + CJK NFKC 过滤强化 + chokidar 失败降级 + IME z-index 边界处理

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation Workspace | v1.0 | 1/1 | Complete | 2026-05-21 |
| 2. AI Chat Engine | v1.0 | 1/1 | Complete | 2026-05-22 |
| 3. Agent Integration | v1.0 | 5/5 | Complete | 2026-05-23 |
| 3.1 子agent 调用流程 | v1.0 | 2/2 | Complete | 2026-05-23 |
| 3.2 deepagents 复核 | v1.0 | 6/6 | Complete | 2026-05-27 |
| 4. Workflow System | v1.0 | 4/4 | Complete | 2026-05-27 |
| 5. Popup Shell + Keyboard Spike | v1.1 | 2/2 | Complete    | 2026-06-04 |
| 6. 4-Source Registry + Dispatcher | v1.1 | 0/TBD | Not started | - |
| 7. System Commands + M3 Regression | v1.1 | 0/TBD | Not started | - |
| 8. Polish + Differentiators | v1.1 | 0/TBD | Not started | - |

## Coverage

**v1.1 requirements:** 15 total (SLASH-01..13 + SLASH-DISPATCH + SLASH-REGRESSION)
**Mapped:** 15/15 (100%)

- Phase 5: 2 (SLASH-01, SLASH-02)
- Phase 6: 9 (SLASH-03, SLASH-04, SLASH-08, SLASH-09, SLASH-10, SLASH-11, SLASH-12, SLASH-13, SLASH-DISPATCH)
- Phase 7: 4 (SLASH-05, SLASH-06, SLASH-07, SLASH-REGRESSION)
- Phase 8: 0 (polish phase, no new SLASH-XX — addresses D-priority from FEATURES.md)

**Orphaned:** 0

## Key Decisions (v1.1)

| Decision | Rationale | Outcome |
|----------|-----------|--------|
| **拒绝** `unstable_useSlashCommandAdapter` | `@deprecated Under active development`；要求 ComposerPrimitive adoption 会引爆 6-hunk patch-package（M3 thinking 链） | — Pending (v1.1) |
| **接受** `cmdk@1.1.1` + `@radix-ui/react-popover@1.1.15` 作为新 dep | 已 grep 验证版本、peer `react ^18 || ^19` 兼容；Radix Popover 已是 transitive dep，promote to direct | — Pending (v1.1) |
| **接受** `sonner` 作为新 dep（shadcn toast） | D11 命名冲突 toast 需要；单 source of truth 比现有 notification 机制轻 | — Pending (v1.1) |
| **接受** chokidar@3.6.0（**非** 4.x） | `awaitWriteFinish: { stabilityThreshold: 200 }` 处理 macOS VSCode atomic-write；4.x breaking changes 没必要 | — Pending (v1.1) |
| **接受** 项目级命令路径 `.cdf/commands/*.md`（**非** `.claude/commands/`） | 与现有 `.cdf/skills/` 对齐 | — Pending (v1.1) |
| **接受** 命名冲突策略：source badge + 两行都保留 + 优先级 `system > skill > workflow > mcp > project` | 防止 Claude Code #61857/#62409/#64422 同类静默覆盖 bug | — Pending (v1.1) |
| **接受** 插件命令以自然语言 prompt 重写走 `llm:chat`（**不**新增 dispatch IPC） | 维护 M3 thinking 链；零新事件类型 | — Pending (v1.1) |
| **接受** `/plan` 为 `payload.overrides.planOnly` 运行时 flag（**不**新 dispatch 路径） | 走 llm.ts:324 现有扩展点；新增 SLASH-REGRESSION it 块保护 | — Pending (v1.1) |
| **接受** `/goal` 内存存储（`useSessionStore.sessionGoals: Map<sessionId, string>`） | v1.1 范围；v1.2+ 迁 SQLite（SLASH-15） | — Pending (v1.1) |
| **接受** ~~seed 1 个 `/pr-review` 3 节点 demo workflow（v1.0 DB 0 行）~~ | **已取消** (2026-06-04 客人大人决定：v1.0 Phase 4 已有 workflow 能力；PITFALLS P11 担忧消解) | — Cancelled |
| **拒绝** v1.0 partial deliverable cleanup（draft workflow 测试、work history UI polish）混入 v1.1 | 推 v1.2；v1.1 激光聚焦 `/` 命令系统 | — Pending (v1.1) |

## Hard "Do Not Touch" List (v1.1)

- `runtime.ts` (deepagent runtime) — M3 chain breaks
- `llm.ts:306-425` (`runLLMChat` + `streamEvents` v3) — patch-package layer
- `workflow-runtime.ts` — independent runtime, untouched
- `LLMStreamEvent` union (13 types) — plugin commands emit existing types only
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` — SLASH-REGRESSION it 块为护栏

## Notes for next phase

- Phase 5 是 **SPIKE** — 必须先验证 cmdk + Radix Popover 在裸 textarea 上的路径，再承诺 dispatcher 架构
- ~~Phase 6 SLASH-10 必须 seed `/pr-review` demo workflow（v1.0 DB 0 行），否则 zombie code~~ (已取消)
- Phase 6 dispatcher 4 种 kinds: `SystemSilent` / `SystemLocal` / `PluginRewrite` / `PlanMode`（客人大人 2026-06-04 决策）
- Phase 7 SLASH-REGRESSION 是 6-hunk patch-package 的负载测试，**不可省**
- Phase 8 是 polish，**没有** SLASH-XX 新需求；完成 v1.1 之前的所有稳定基座之后做
- 跨平台 chokidar 测试矩阵：macOS + Windows + Linux 各至少 1 run（CI badge for v1.1 退出标准）
