# Phase 3: Agent Integration - Discussion Log

> **审计追踪。** 不作为规划、研究或执行 Agent 的输入。
> 决策已记录在 CONTEXT.md 中 — 此文件仅保留已考虑的替代方案。

**日期:** 2026-05-22
**阶段:** 03-agent-integration
**讨论的领域:** 导航与视图架构, Agent 资产库 UI, Agent 配置结构, Skills 编辑器, Skills 版本管理, MCP 服务器管理, IPC 与 Preload 桥接

---

## 导航与视图架构

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 扩展 App.tsx 的 activeView | 沿袭 Phase 2 的视图切换模式，新增 agents/skills/mcp 视图 | ✓ |
| 使用 React Router | 引入路由库管理嵌套视图 | |

**用户的选择:** 扩展 activeView 模式（推荐 — 与现有架构一致，避免引入新依赖）
**注释:** `--auto` 模式自动选择

---

## Agent 资产库 UI

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 卡片列表 + 模态框编辑 | 参考 ModelSettings.tsx 模式 | ✓ |
| 表格列表 + 内联编辑 | 更紧凑但交互局限 | |
| 侧边栏面板 | 类似现有 Session 列表 | |

**用户的选择:** 卡片列表 + 模态框编辑（推荐 — 与 ModelSettings 保持一致体验）
**注释:** `--auto` 模式自动选择

---

## Agent 配置结构 — SQLite 表设计

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| agents + 关联表 (多对多) | agents, agent_mcp_servers, agent_skills 表 | ✓ |
| agents + JSON 字段 | 将所有关系存储为 JSON 数组 | |

**用户的选择:** 关联表多对多（推荐 — 遵循现有 SQLite 模式，支持查询）
**注释:** `--auto` 模式自动选择

---

## Skills 编辑器格式

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 简单 textarea | v1 优先功能性，后优化编辑体验 | ✓ |
| Monaco Code Editor | 功能完整但引入重量级依赖 | |

**用户的选择:** 简单 textarea（推荐 — v1 聚焦功能完整性）
**注释:** `--auto` 模式自动选择

---

## Skills 版本管理

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 自动快照 + 只读视图 | 每次保存记快照，版本列表浏览 | ✓ |
| Git 集成 | 复杂度高，v1 不需要 | |
| 无版本管理 | 简单但丢失审计能力 | |

**用户的选择:** 自动快照 + 只读视图（推荐 — 满足需求 SKIL-02 的同时控制复杂度）
**注释:** `--auto` 模式自动选择

---

## MCP 服务器管理

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 配置管理 + 健康检查 | 仅配置和连通性验证 | ✓ |
| 完整 MCP 协议集成 | 包含实际调用和消息流转 | |

**用户的选择:** 配置管理 + 健康检查（推荐 — 实际 MCP 协议调用属于 Phase 4）
**注释:** `--auto` 模式自动选择

---

## IPC 与 Preload 桥接

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 遵循 Phase 2 模式 | IPC 处理器 + Preload 桥接 + Zustand Store | ✓ |
| 直接渲染进程数据库访问 | 安全风险，违反 Electron 最佳实践 | |

**用户的选择:** 遵循 Phase 2 模式（推荐 — 保持一致性，安全性）
**注释:** `--auto` 模式自动选择

---

## 延迟想法

- Skills 语法高亮编辑器（Monaco/CodeMirror）— post-v1 优化
- Skills 版本回滚功能 — post-v1 优化
- 实际 MCP 协议调用 — Phase 4 工作流执行引擎范围
- Skills 市场/共享功能 — v2 范围
- MCP 资源状态可视化 — v2 范围