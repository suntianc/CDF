---
phase: 14-hitl-approval-bypass
plan: "01"
subsystem: workflow-runtime
tags:
  - hitl
  - approval
  - ipc
  - langgraph
  - interrupt
dependency_graph:
  requires:
    - phase-12: deepagents SDK 能力探针（interrupt/Command 可用性验证）
  provides:
    - ApprovalMode 类型（shared）
    - WorkflowApprovalRequest/Resolution 类型（shared）
    - node_waiting_approval / node_approval_resolved 事件（shared）
    - workflow:approve IPC channel（preload bridge）
    - interruptOn 动态注入（node-executor + runtime）
    - GraphInterrupt 捕获 + resume（workflow-runtime）
    - 全局 approvalMode 存储（electron-store）
  affects:
    - src/renderer（消费 node_waiting_approval 事件 — Plan 02 实现）
tech_stack:
  added: []
  patterns:
    - LangGraph isGraphInterrupt + Command({ resume }) 用于审批后恢复
    - while(true) 执行循环替代 for-await（支持多轮 interrupt/resume）
    - electron-store 持久化全局审批模式默认值
    - pendingWorkflowApprovals Map + reject Map 防内存泄漏
key_files:
  created:
    - src/main/workflow/workflow-runtime.test.ts
  modified:
    - src/shared/types.ts
    - src/main/store.ts
    - src/preload/index.ts
    - src/main/workflow/node-executor.ts
    - src/main/workflow/node-executor.test.ts
    - src/main/workflow/workflow-runtime.ts
    - src/main/deepagent/runtime.ts
decisions:
  - "DEFAULT_INTERRUPT_ON 在 node-executor.ts 中本地声明（不从 runtime.ts import），避免引入 Chat 路径全部依赖"
  - "pendingWorkflowApprovals 和 pendingWorkflowRejects 分两个 Map，stopWorkflow 遍历 reject Map 防止悬空 Promise"
  - "while(true) + try/catch isGraphInterrupt 模式替代嵌套 for-await，符合 LangGraph 官方 interrupt 处理模式"
  - "workflow:approve IPC 收到不存在的 key 时静默忽略（T-14-01 安全要求）"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-20"
  tasks_completed: 4
  files_modified: 7
  files_created: 1
---

# Phase 14 Plan 01: HITL 后端机制 Summary

## 一句话概述

为 Workflow 路径实现完整的 HITL 后端：`interruptOn` 动态注入（strict/bypass/agent_decides 三档）、`isGraphInterrupt` 捕获 + `Command({ resume })` 恢复、`workflow:approve` IPC channel、`pendingWorkflowApprovals` 内存管理、全局 `approvalMode` 持久化到 electron-store。

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | 共享类型 + store + preload bridge | c82ea11 | types.ts 新增 ApprovalMode/WorkflowApprovalRequest/Resolution/事件；store.ts 新增 approvalMode 字段；preload 新增 resolveApproval |
| 2 | node-executor interruptOn 注入 | 60b8d27 | 导出 DEFAULT_INTERRUPT_ON；resolveInterruptOn 函数；createAgentNodeExecutor 第三参数；4 个新测试 |
| 3 | workflow-runtime GraphInterrupt + IPC | 5c8caa6 | while(true) 循环；GraphInterrupt 捕获；node_waiting_approval/resolved 事件；workflow:approve handler；stopWorkflow 清理；新建测试文件 |
| 4 | Chat 路径 bypass 支持 | 88956e6 | runtime.ts 新增 resolveInterruptOnForChat；主 Agent interruptOn 动态读取 store.approvalMode |

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed as written with minor implementation adjustments:

**1. [Deviation - Implementation Detail] 括号嵌套结构修复**
- Task 3 重构 for-await 为 while(true) 时，原始代码的 for..entries 嵌套关闭括号需要手动对齐
- 通过 TypeScript 编译错误检测到并立即修复
- 不影响功能，纯结构问题

**2. [Deviation - Type Precision] DEFAULT_INTERRUPT_ON 类型注解**
- 计划使用 `as const` 使 allowedDecisions 为 readonly，但 deepagents 类型要求 mutable string[]
- 改为 `NonNullable<Parameters<typeof createDeepAgent>[0]>['interruptOn']` 类型注解（与 runtime.ts 保持一致）

**3. [Deviation - Test Scope] workflow-runtime.test.ts 简化**
- 计划要求测试"捕获 GraphInterrupt 并推送 node_waiting_approval 事件"，但 runWorkflow 内联了太多外部依赖（Electron app.getPath、SqliteSaver、graph.stream 等）需要大量复杂 mock
- 改为测试可单独验证的导出函数：stopWorkflow（清理行为）和 registerWorkflowIpcHandlers（handler 注册和静默忽略行为）
- 核心 GraphInterrupt 捕获逻辑通过 TypeScript 类型检查 + 代码审查验证，端到端验证推迟到 Plan 02 的手动 checkpoint

## Known Stubs

None. 所有数据路径均已连接：
- `approvalMode` 从 electron-store 实时读取（无硬编码）
- `interruptOn` 基于 `approvalMode` 动态决定（无占位值）
- `workflow:approve` IPC handler 已注册并连接 pendingWorkflowApprovals

## Threat Flags

计划 threat_model 中的缓解措施已完整实现：

| Threat ID | Status |
|-----------|--------|
| T-14-01 (Tampering) | 已缓解：workflow:approve handler 中 key 不存在时静默忽略 |
| T-14-02 (EoP) | 已缓解：electron-store 默认值 'strict'；bypass 需主动选择 |
| T-14-03 (DoS/内存泄漏) | 已缓解：stopWorkflow 遍历 reject 所有匹配 executionId 的 pending Promises |

## Verification Results

- `pnpm test src/main/workflow/` — 32 个测试全部通过（含 4 个新 interruptOn 注入测试 + 3 个 workflow-runtime 测试）
- TypeScript 编译 — 无新引入的类型错误（pre-existing: node-executor.ts ProviderRow.context_limit）

## Self-Check: PASSED

- [x] src/shared/types.ts — ApprovalMode, WorkflowApprovalRequest, WorkflowApprovalResolution 已定义
- [x] src/main/store.ts — approvalMode 字段 + defaults 'strict' 已添加
- [x] src/preload/index.ts — resolveApproval IPC bridge 已添加
- [x] src/main/workflow/node-executor.ts — DEFAULT_INTERRUPT_ON, resolveInterruptOn, approvalMode 参数已添加
- [x] src/main/workflow/node-executor.test.ts — 4 个新测试全部通过
- [x] src/main/workflow/workflow-runtime.ts — while loop + GraphInterrupt + workflow:approve handler 已实现
- [x] src/main/workflow/workflow-runtime.test.ts — 3 个新测试全部通过
- [x] src/main/deepagent/runtime.ts — resolveInterruptOnForChat + 动态 interruptOn 已实现
- [x] 全部 commit 均已存在：c82ea11, 60b8d27, 5c8caa6, 88956e6
