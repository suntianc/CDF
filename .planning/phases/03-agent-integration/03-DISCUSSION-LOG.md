# Phase 3: Agent Integration - Discussion Log（更新）

> **审计追踪。** 不作为规划、研究或执行 Agent 的输入。
> 决策已记录在 CONTEXT.md 中 — 此文件仅保留已考虑的替代方案。

**日期:** 2026-05-23
**阶段:** 03-agent-integration
**讨论的领域:** 导航结构, Agent 编辑对话框布局, MCP 配置表单, Skills 编辑器增强, 绑定交互方式, Agent 卡片信息展示

---

## 导航结构

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 单个资产管理视图 + 标签页 | 统一入口，内部标签页切换 Agent/Skills/MCP | |
| 三个独立视图 | Sidebar 三个独立按钮 | |
| Agent 为主入口，Skills/MCP 次级 | Agent 列表为主体 | |
| **Agent 独立入口 + 插件标签页** | **Agent 单独 Sidebar 按钮；Skills+MCP 从"插件"进入，标签页切换** | ✓ |

**用户的选择:** Agent 管理单独入口；Skills + MCP 从"插件"菜单进入
**注释:** 混合方案 — Agent 是顶层视图，Skills/MCP 是次级管理面板

---

## Agent 编辑对话框布局

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 单列滚动长表单 | 所有字段从上到下列排列 | |
| 标签页式 | 对话框内分标签页切换 | |
| 分步骤向导 | Step1→Step2→Step3→Step4 | |
| **双栏分屏（40/60）** | **左侧40%核心配置 + 右侧60%能力与System Prompt** | ✓ |

**用户的选择:** 双栏分屏布局，左侧 40% 核心配置，右侧 60% 能力与系统提示词
**注释:** 需要 Shadcn Dialog 自定义布局

---

## MCP 配置表单字段

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 仅 Streamable HTTP | 仅 URL 字段，简化 | |
| **stdio + Streamable HTTP** | **支持两种传输类型，动态切换配置字段** | ✓ |
| 完整高级配置 | 含认证、超时等 | |

**用户的选择:** stdio + Streamable HTTP 双类型支持
**注释:** stdio 显示 command+args；Streamable HTTP 显示 URL。基于 https://modelcontextprotocol.io/specification/2025-03-26/basic/transports 标准

---

## Skills 编辑器增强

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 纯 textarea | 保持现状，v1 聚焦功能 | |
| **轻量增强** | **textarea + 行号 + 基础语法着色（CSS/轻量方案）** | ✓ |
| 富编辑器 | Monaco/Codemirror 6 | |

**用户的选择:** 轻量增强（行号 + 基础着色），不引入重量级依赖

---

## 绑定交互方式

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| 多选下拉框 | 标准 select 多选 | |
| **搜索选择器** | **Command palette 风格，搜索过滤可选择项** | ✓ |
| 穿梭框 | 可用/已选两栏 | |

**用户的选择:** Command palette 风格搜索选择器（Shadcn Command），需要引入 `cmdk` 包

---

## Agent 卡片信息展示

| 选项 | 描述 | 选择 |
| --- | --- | --- |
| **名称 + LLM + 绑定数量** | **名称、LLM 提供者、Skills/MCP 数量。简洁清晰** | ✓ |
| 完整信息（含时间摘要） | 额外含创建/更新时间、System Prompt 预览 | |
| 名称 + 资源徽章列表 | 显示绑定的具体 MCP/Skills 徽章 | |

**用户的选择:** 名称 + 绑定的 LLM 提供者名称 + Skills 数量 + MCP 数量

---

## 延后事项

（同 CONTEXT.md 延后事项）

- Skills 语法高亮编辑器（Monaco/CodeMirror）— post-v1 优化
- Skills 版本回滚功能 — post-v1 优化
- Agent 运行时在工作流中的执行 — Phase 4
- deepagents 子Agent 委托的 UI 管理 — Phase 4
- LangGraph 图可视化和编辑 — Phase 4
- MCP stdio 子进程管理（启动/停止/重启）— Phase 4
- Skills 市场/共享 — v2
- MCP 资源状态可视化 — v2