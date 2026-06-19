---
phase: 12-deepagents-sdk-capability-probe
plan: 01
subsystem: workflow
tags: [sdk-probe, langgraph, send-api, interrupt, hitl, fan-out]
dependency_graph:
  requires: []
  provides:
    - T1_Send_API_verified
    - T2_interrupt_verified
    - Phase13_14_15_tech_path_confirmed
  affects:
    - Phase 13 routing fix
    - Phase 14 HITL design
    - Phase 15 parallel fan-out
tech_stack:
  added: []
  patterns:
    - LangGraph Send API (direct import, not via deepagents)
    - LangGraph interrupt() (direct import or via deepagents interruptOn)
key_files:
  created:
    - .planning/phases/12-deepagents-sdk-capability-probe/12-PROBE-REPORT.md
  modified: []
decisions:
  - "Send API 通过直接 import @langchain/langgraph 使用，不经过 deepagents SDK"
  - "Phase 14 HITL 首选路径：node-executor.ts 加 interruptOn 参数（工具级审批）"
  - "Phase 15 fan-out：graph-builder.ts 中 addConditionalEdges 返回 Send[]"
  - "WorkflowState.nodeOutputs 的 spread-merge reducer 已是并行安全，无需改 schema"
metrics:
  duration: ~40min
  completed: "2026-06-19"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
---

# Phase 12 Plan 01 执行 SUMMARY

## 一句话概要

deepagents 1.10.2 + LangGraph 1.3.6：Send API 和 interrupt() 均可用，图构建层直接用 LangGraph，节点执行层用 deepagents SDK，两层正交，Phase 13-15 技术路径已确认。

## 任务完成情况

| 任务 | 名称 | 状态 | Commit |
|------|------|------|--------|
| 1 | Send API 与 interrupt() 能力探针 | DONE | 3814971 |
| 2 | checkpoint:human-verify | PENDING — 等待用户审阅 | — |

## 关键验证结论

### T1：Send API（并行 fan-out）

- LangGraph 1.3.6 完整导出 `Send` 类 [VERIFIED: `@langchain/langgraph/dist/constants.d.ts:81`]
- deepagents SDK **不导出** Send，需直接从 `@langchain/langgraph` 导入
- `graph-builder.ts` 已有先例（`import { StateGraph, START, END } from '@langchain/langgraph'`），添加 `Send` 只需扩展同一 import
- `WorkflowState.nodeOutputs` 的 spread-merge reducer 已是并行安全，**无需修改 schema**

### T2：interrupt() / HITL

- LangGraph 1.3.6 完整导出 `interrupt()` 函数 [VERIFIED: `@langchain/langgraph/dist/interrupt.d.ts:45`]
- deepagents `createDeepAgent({ interruptOn })` 通过 `humanInTheLoopMiddleware` 封装 interrupt，提供工具级 HITL
- Chat 路径（`runtime.ts:DEFAULT_INTERRUPT_ON`）已有完整 HITL 实现，包括 6 个工具审批配置
- Workflow 路径（`node-executor.ts:361-368`）`createDeepAgent` 调用**缺少 interruptOn**，确认为安全缺口

### 绕过 SDK 评估

- CDF Workflow 路径已是"图层直接用 LangGraph，节点层用 deepagents"的混合架构
- 不存在绕过问题，两层职责清晰、正交

## Phase 13-15 技术路径推荐

| Phase | 技术方案 |
|-------|---------|
| 13 — 路由修复 | 改进 `graph-builder.ts` 的路由解析，用结构化输出代替正则提取 |
| 14 — HITL | 首选：`node-executor.ts` 加 `interruptOn`（工具级）；补充：`graph-builder.ts` Review 节点用 `interrupt()`（节点级） |
| 15 — 并行 | `graph-builder.ts` 中添加 `Send`，路由函数返回 `Send[]` 实现 fan-out |

## 偏差说明

无偏差——计划执行与 PLAN.md 完全一致。

## 已知 Stubs

无，本 Plan 是纯分析/阅读阶段，不包含实现代码。

## 威胁标记

无新增信任边界。本 Plan 纯只读分析，不修改任何生产代码。

## Self-Check

- [x] `12-PROBE-REPORT.md` 存在（354 行）
- [x] 包含 T1 验证结论（Send API 可用性 + 代码路径）
- [x] 包含 T2 验证结论（interrupt() 可用性 + 代码路径）
- [x] 包含绕过 SDK 可行性评估
- [x] 包含 Phase 13/14/15 技术路径推荐表
- [x] 19 处 VERIFIED 标注（要求 6 个）
- [x] Commit 3814971 存在

## Self-Check: PASSED
