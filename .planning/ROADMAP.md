# Roadmap: CDF — Agent 开发工作站

**Created:** 2026-06-15  
**Mode:** Dynamic Maintenance  
**Project:** CDF — Agent 开发工作站

## Overview

v0.2.2 是动态维修里程碑。修复 phase 根据用户反馈逐步通过 `/gsd-phase` 添加。不预设全部 scope。

## Milestones

- ✅ **v0.2.1 本地多领域 Agent 工作站重设计** — Phases 1-8 (shipped 2026-06-14)
- 🔄 **v0.2.2 现有版本能力维修** — Phase 09+ (started 2026-06-15)

## Phases

### v0.2.2 现有版本能力维修

- [x] Phase 10: 子 Agent 执行修复与 UI 优化 (3 plans) — completed 2026-06-15
  - [x] 10-01-PLAN.md — 子 Agent interruptOn 隔离，修复审批挂起（REPAIR-03）
  - [x] 10-02-PLAN.md — task 工具 output 写入 + UI 状态防御性显示（REPAIR-04）
  - [x] 10-03-PLAN.md — Tool Summary + DelegatedTaskCard 可读错误展示（REPAIR-05）
- [x] Phase 11: 网络调研 agent 工作流，比对当前 agent 工作流编排 (1 plan) — completed 2026-06-19
  - [x] 11-01-PLAN.md — 架构分析报告：业界 Agent 工作流编排方案与 CDF 比对

- [ ] Phase 12: deepagents SDK 能力探针 — 1 plan
- [ ] Phase 13: Workflow 路由机制修复 — 2 plans
  - [x] 13-01-PLAN.md — createConditionalRouter 路由缺失显式抛错 + 测试
  - [x] 13-02-PLAN.md — review 节点 responseFormat 结构化输出 + 测试
- [ ] Phase 14: 审批机制统一设计（HITL + bypass 开关） — pending (depends: 12)
- [ ] Phase 15: 并行 Agent 执行（fan-out/fan-in） — pending (depends: 12)
- [ ] Phase 16: 基础设施统一 + 可观测性 — pending (depends: 13, 14)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 10. 子 Agent 执行修复与 UI 优化 | v0.2.2 | 3/3 | ✅ Complete | 2026-06-15 |
| 11. 网络调研 agent 工作流比对 | v0.2.2 | 1/1 | ✅ Complete | 2026-06-19 |
| 12. SDK 能力探针 | v0.2.2 | 1/1 | Complete   | 2026-06-19 |
| 13. Workflow 路由机制修复 | v0.2.2 | 2/2 | Complete    | 2026-06-19 |
| 14. 审批机制统一设计 | v0.2.2 | — | ⏳ Pending | — |
| 15. 并行 Agent 执行 | v0.2.2 | — | ⏳ Pending | — |
| 16. 基础设施统一 + 可观测性 | v0.2.2 | — | ⏳ Pending | — |

<details>
<summary>✅ v0.2.1 本地多领域 Agent 工作站重设计 (Phases 1-8) — SHIPPED 2026-06-14</summary>

- [x] Phase 1: 设计基线与 UI 审计 (1/1 plan) — completed 2026-06-11
- [x] Phase 2: 首页 Task Surface 重设计 (1/1 plan) — completed 2026-06-11
- [x] Phase 3: Activity Trail / TaskPanel 重设计 (1/1 plan) — completed 2026-06-12
- [x] Phase 4: Work Stream 与消息系统重构 (1/1 plan) — completed 2026-06-13
- [x] Phase 5: Workflow Canvas 视觉语言 (1/1 plan) — completed 2026-06-13
- [x] Phase 6: Agent Library / Settings / MCP 能力架统一 (1/1 plan) — completed 2026-06-14
- [x] Phase 7: 全局设计系统落地 (1/1 plan) — completed 2026-06-14
- [x] Phase 8: 验证与 polish (1/1 plan) — completed 2026-06-14

**Stats:** 8 phases / 8 plans | 36 files (+5034/−546 LOC) | 484/484 tests | Impeccable audit 18/20

完整里程碑归档：`.planning/milestones/v0.2.1-ROADMAP.md`

</details>

---

## Phase 10 Detail

**Phase 10: 子 Agent 执行修复与 UI 优化**

**Goal:** 修复子 Agent 调用模块的三个问题：工具审批权限导致的挂起报错、执行完成后 UI 状态未更新、以及相关组件的显示与布局优化。

**Requirements:** REPAIR-03, REPAIR-04, REPAIR-05

**Plans:** 3/3 plans complete

Plans:
- [x] 10-01-PLAN.md — 子 Agent interruptOn 隔离，修复工具调用审批挂起
- [x] 10-02-PLAN.md — task 工具 output 写入标准格式 + UI 防御性状态显示
- [x] 10-03-PLAN.md — Tool Summary 和 DelegatedTaskCard 可读错误展示

**Issues:**
1. **工具审批权限**：Sub-agent 调用工具时触发审批机制导致任务挂起报错，需要给 sub-agent 配置自动审批或继承父级权限
2. **状态监控**：Sub-agent 执行完成后，AgentTraceModal 停在"等待输出..."、DelegatedTaskCard 停在"子代理正在准备初始化环境..."，状态同步未到位
3. **UI 优化**：工具响应显示 UNKNOWN + 原始 JSON、工具摘要展示、子 Agent 相关卡片布局美化

**Success criteria:**
1. Sub-agent 调用工具时不再因审批机制挂起，任务能正常执行完成
2. Sub-agent 完成后 AgentTraceModal 和 DelegatedTaskCard 状态正确更新（token 数、完成状态、输出内容）
3. 工具调用结果不显示 UNKNOWN/原始 JSON，渲染为可读格式
4. 484/484 测试通过

---

## Phase 11 Detail

**Phase 11: 网络调研 agent 工作流，比对当前 agent 工作流编排**

**Goal:** 调研业界主流 agent 工作流编排方案（如 LangGraph、CrewAI、AutoGen、OpenAI Swarm 等），与 CDF 当前基于 deepagents SDK 的工作流进行架构比对，识别差距与改进方向。

**Plans:** 1 plan

Plans:
- [ ] 11-01-PLAN.md — 架构分析报告：业界 Agent 工作流编排方案与 CDF 比对

**Success criteria:**
1. 架构分析报告覆盖 4 个比对维度（多 Agent 协作、编排模式、状态管理、工具集成）
2. 包含 CDF 现状精确描述（基于源代码）
3. 包含核心差距排序和优先级判断
4. 用户审阅通过

---

## Phase 12 Detail

**Phase 12: deepagents SDK 能力探针**

**Goal:** 验证 deepagents SDK 是否暴露 LangGraph Send API（并行 fan-out）和 interrupt() 原语（HITL），确定后续 phase 的技术路径。

**依赖:** 无（Phase 11 分析报告已完成）

**Plans:** 1/1 plans complete

Plans:
- [x] 12-01-PLAN.md — Send API / interrupt() 能力探针 + 技术路径推荐


**Success criteria:**
1. 明确 Send API 是否可通过 deepagents SDK 使用，给出代码级证据
2. 明确 interrupt() 是否可通过 deepagents SDK 使用，给出代码级证据
3. 如果 SDK 不暴露，给出绕过 SDK 直接使用 LangGraph 的可行性评估
4. 产出技术验证报告，供后续 phase 引用

---

## Phase 13 Detail

**Phase 13: Workflow 路由机制修复**

**Goal:** 将 Workflow 条件路由从文本正则提取 JSON 替换为结构化输出方案，消除路由失败风险。（对应报告差距 2 — HIGH）

**依赖:** Phase 12（确认 SDK 能力边界）

**关键文件:** `graph-builder.ts` 条件边逻辑、`node-executor.ts` agent 执行与路由提取

**Plans:** 2/2 plans complete

Plans:
- [x] 13-01-PLAN.md — createConditionalRouter 路由缺失显式抛错 + 测试
- [x] 13-02-PLAN.md — review 节点 responseFormat 结构化输出 + 测试

**Success criteria:**
1. 条件边路由使用结构化输出或编程式路由函数，不依赖文本正则
2. 路由失败时有明确的错误处理而非静默 fallback 到 END
3. 现有工作流模板兼容新路由机制
4. 全部测试通过

---

## Phase 14 Detail

**Phase 14: 审批机制统一设计（HITL + bypass 开关）**

**Goal:** Workflow 路径补上 HITL 审批机制，同时给 Chat 和 Workflow 双路径都加 bypass 开关，用户可选择跳过审批（类似 Claude Code 的 bypass permissions 模式）。（对应报告差距 3 — HIGH）

**依赖:** Phase 12（确认 interrupt() 可用性）

**关键文件:** `node-executor.ts`、`runtime.ts`、审批相关 IPC

**Success criteria:**
1. Workflow 路径的工具调用（write_file、delete_file、bash 等）触发用户审批
2. Chat 路径和 Workflow 路径都支持 bypass 开关，可关闭审批
3. bypass 开关在 UI 中可配置（工作流级别 / 全局设置）
4. 全部测试通过

---

## Phase 15 Detail

**Phase 15: 并行 Agent 执行（fan-out/fan-in）**

**Goal:** 实现多 Agent 并行执行能力，支持 fan-out 分发子任务、fan-in 聚合结果、并行进度回传。（对应报告差距 1 — HIGH）

**依赖:** Phase 12（确认 Send API 可用性）

**关键文件:** `runtime.ts`、`agent-tools.ts`（task tool）、状态合并逻辑

**Success criteria:**
1. task tool 支持并行委派多个子 Agent
2. 并行子任务的结果能正确聚合返回
3. 并行执行中的进度和错误能回传到 UI
4. 全部测试通过

---

## Phase 16 Detail

**Phase 16: 基础设施统一 + 可观测性**

**Goal:** 提取 Chat 路径和 Workflow 路径的共享能力层（工具注册、MCP 加载、审批机制），消除代码重复；加统一 span trace 让 subagent 执行链对用户可见。（对应报告差距 4+5 — MEDIUM）

**依赖:** Phase 13、14（路由和审批机制稳定后再统一）

**关键文件:** `runtime.ts`、`node-executor.ts`、`workflow-runtime.ts`

**Success criteria:**
1. `node-executor.ts` 不再 mirror `runtime.ts` 的代码，共享能力层提取为独立模块
2. Chat 和 Workflow 路径使用同一套工具注册和 MCP 加载机制
3. subagent 执行链有统一 span ID，UI 可展示完整追踪
4. 全部测试通过

---

## Deferred / Future

- Runtime Safety（SAFE-01/02, IPC-01, RT-03, DATA-01）— 下一里程碑候选
- Collaboration（COLLAB-01/02）— 下一里程碑候选
- 云端同步、移动端、企业权限 — 长期 Out of Scope

---
*Roadmap created: 2026-06-15 — v0.2.2 动态维修里程碑*
*Phase 10 planned: 2026-06-15 — 3 plans, 2 waves*
*Phase 11 planned: 2026-06-17 — 1 plan, 1 wave*
*Phase 12-16 planned: 2026-06-19 — 基于 Phase 11 架构分析报告拆分的 5 个改造 phase*
*Phase 13 planned: 2026-06-19 — 2 plans, 2 waves*
