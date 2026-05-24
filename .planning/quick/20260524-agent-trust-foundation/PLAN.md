---
status: in_progress
created_at: "2026-05-24T00:00:00+08:00"
---

# Plan: Agent 桌面应用信任底座

## Goal

实现会话绑定 Agent、Agent 配置驱动 DeepAgent runtime、运行轨迹持久化、写操作默认审批。

## Steps

1. 扩展 SQLite schema、共享类型与 IPC，支持 session.agent_id、agent_runs、agent_tool_calls、审批事件。
2. 调整 runtime：按会话 Agent 加载 provider/MCP/Skills，应用默认权限与审批配置。
3. 调整聊天流：创建 run、记录工具调用、广播 run/审批状态，保留现有消息流。
4. 调整 UI/store：新建会话绑定 Agent、活动面板展示 run/tool call、审批弹窗处理 approve/reject/edit。
5. 增加/更新单元测试并运行定向验证。
