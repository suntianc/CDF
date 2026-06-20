---
phase: 14-hitl-approval-bypass
plan: "02"
subsystem: renderer-ui
tags:
  - hitl
  - approval
  - workflow
  - i18n
  - zustand
dependency_graph:
  requires:
    - phase-14-plan-01: WorkflowApprovalRequest/Resolution 类型、workflow:approve IPC channel、node_waiting_approval/node_approval_resolved 事件
  provides:
    - workflowStore pendingWorkflowApproval 状态管理 + resolveWorkflowApproval 方法
    - AgentNode waiting 状态视觉（warning 色边框 + Clock 图标 + animate-pulse）
    - ApprovalModeSelector 三档审批模式选择器组件
    - TaskPanel Workflow 审批卡片（复用 PendingApprovalCard 视觉设计）
    - i18n 中英文审批模式文案
  affects:
    - src/renderer/src/stores/workflowStore.ts
    - src/renderer/src/components/WorkflowEditor/AgentNode.tsx
    - src/renderer/src/components/TaskPanel/TaskPanel.tsx
    - src/renderer/src/components/shared/ApprovalModeSelector.tsx
    - src/renderer/src/i18n/locales/zh-CN.json
    - src/renderer/src/i18n/locales/en-US.json
    - src/shared/types.ts
tech_stack:
  added: []
  patterns:
    - Zustand store 新增 pendingWorkflowApproval 字段 + resolveWorkflowApproval action
    - processEvent 事件分发模式处理 node_waiting_approval/node_approval_resolved
    - React useState + useEffect 读写 electron-store 的 ApprovalModeSelector 模式
    - i18n namespace 嵌套（approvalMode.* + workflow.approval.* + workflow.node.*）
key_files:
  created:
    - src/renderer/src/components/shared/ApprovalModeSelector.tsx
  modified:
    - src/shared/types.ts
    - src/renderer/src/stores/workflowStore.ts
    - src/renderer/src/components/WorkflowEditor/AgentNode.tsx
    - src/renderer/src/components/TaskPanel/TaskPanel.tsx
    - src/renderer/src/i18n/locales/zh-CN.json
    - src/renderer/src/i18n/locales/en-US.json
decisions:
  - "Workflow 审批卡片使用与 Chat 审批卡片相同的视觉结构（ShieldAlert + warning 色边框），不独立设计，维持一致性（per D-03）"
  - "resolveWorkflowApproval 当前只支持 approve/reject，不支持 edit，保留 WorkflowApprovalResolution 结构供 Phase 16 扩展"
  - "ApprovalModeSelector 使用受控 useState 而非直接从 store get，因为 electron-store 是异步的（useEffect 初始化）"
  - "AgentNode waiting 状态使用 Clock 图标替代 Loader2，语义上更准确（等待用户输入，非计算中）"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-20"
  tasks_completed: 2
  files_modified: 6
  files_created: 1
---

# Phase 14 Plan 02: 审批 UI Summary

## 一句话概述

为 Workflow HITL 实现完整的渲染层：workflowStore 审批状态管理（pendingWorkflowApproval + resolveWorkflowApproval）、AgentNode waiting 状态视觉（warning 色 + Clock 图标）、TaskPanel 工作流审批卡片（复用 PendingApprovalCard 设计）、ApprovalModeSelector 三档审批模式选择器、中英文 i18n 文案。

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | workflowStore 审批状态管理 + AgentNode waiting 样式 | ca62760 | types.ts 新增 'waiting' 到 WorkflowNodeRunStatus；workflowStore 新增 pendingWorkflowApproval 字段 + resolveWorkflowApproval；processEvent 处理 node_waiting_approval/node_approval_resolved；AgentNode statusStyles 新增 waiting 条目 + Clock 图标 |
| 2 | 审批模式选择器 + TaskPanel 审批卡片 + i18n | e06dfe8 | 新建 ApprovalModeSelector.tsx（三档 + bypass 风险色）；TaskPanel 新增 Workflow 审批卡片；zh-CN.json + en-US.json 新增 approvalMode/workflow.approval/workflow.node 文案 |

## Task 3 Checkpoint Pending

**Task 3（端到端功能验证）为 checkpoint:human-verify**，需用户手动启动应用验证以下功能：
- Strict 模式下审批卡片弹出
- 批准/拒绝后工作流恢复/停止
- Bypass 模式下不弹卡片
- AgentNode waiting 状态视觉
- 审批模式选择器三档切换

## Deviations from Plan

### Auto-fixed Issues

None.

**实施细节调整（不影响功能）：**

**1. [Implementation Detail] 工作流审批卡片使用内联 actions 展示而非完整 ApprovalActionCard**
- 原因：AgentApprovalAction 的参数结构在 Workflow 路径下未必有 target/preview 字段（这些是 Chat 路径 agent 赋予的），使用完整 ApprovalActionCard 可能显示空白字段
- 调整：仅显示工具名（action.name）+ i18n 标签，避免空白预览框
- Task: 2

**2. [Rule 2 - 缺失处理] stopWorkflow 一并清空 pendingWorkflowApproval**
- 原因：计划未明确要求，但 stopWorkflow 触发时若有 pending approval 应同步清空，否则 UI 残留审批卡片（影响 UI 正确性）
- 修复：stopWorkflow 的 set 调用中补充 pendingWorkflowApproval: null
- Task: 1

## Known Stubs

None. 所有数据路径均已连接：
- pendingWorkflowApproval 从 workflowStore processEvent 动态设置
- resolveWorkflowApproval 调用真实 window.electronAPI.workflow.resolveApproval
- ApprovalModeSelector 从 electron-store 读写 approvalMode（无硬编码默认值）

## Threat Flags

计划 threat_model 中的缓解措施已完整实现：

| Threat ID | Status |
|-----------|--------|
| T-14-05 (EoP — bypass 滥用) | 已缓解：bypass 选项使用 danger 色 + bypassWarning 文案明确告知风险 |
| T-14-06 (Spoofing — 伪造状态) | 已接受（renderer 内部状态，实际决策由 Plan 01 IPC handler 校验） |
| T-14-SC (Tampering — 包安装) | 已接受（本 plan 未安装新包） |

## Self-Check: PASSED

- [x] src/shared/types.ts — WorkflowNodeRunStatus 包含 'waiting'
- [x] src/renderer/src/stores/workflowStore.ts — pendingWorkflowApproval 字段 + resolveWorkflowApproval 方法
- [x] src/renderer/src/stores/workflowStore.ts — processEvent 处理 node_waiting_approval/node_approval_resolved
- [x] src/renderer/src/stores/workflowStore.ts — workflow_end + stopWorkflow 清空 pendingWorkflowApproval
- [x] src/renderer/src/components/WorkflowEditor/AgentNode.tsx — waiting 状态样式（warning 色 + animate-pulse + Clock 图标）
- [x] src/renderer/src/components/shared/ApprovalModeSelector.tsx — 三档选择器，读写 electronAPI.store.approvalMode，bypass danger 色
- [x] src/renderer/src/components/TaskPanel/TaskPanel.tsx — Workflow 审批卡片（ShieldAlert + approve/reject 按钮）
- [x] src/renderer/src/i18n/locales/zh-CN.json — approvalMode.* + workflow.approval.* + workflow.node.waitingApproval
- [x] src/renderer/src/i18n/locales/en-US.json — 同一组 key 英文文案
- [x] 全部 commit 均已存在：ca62760, e06dfe8
- [x] TypeScript 编译无新引入错误（TS7006 Line 119/250 为 pre-existing）
