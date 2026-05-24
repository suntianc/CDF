# 虚拟项目根路径误用修复

## Symptoms

- Agent 创建文件时会在项目内创建 `Users/suntc/...` 之类的多层目录。
- 当前 DeepAgents `FilesystemBackend` 已经以项目路径作为 `rootDir` 且启用 `virtualMode`，文件工具看到的项目根应是 `/`。

## Root Cause

- Runtime 系统提示把宿主机真实项目路径暴露给模型，并要求“以此项目路径为基础”操作。
- 模型把宿主机绝对路径传给 `write_file` 后，虚拟 backend 会把 `/Users/...` 当成项目内虚拟路径，导致错误目录被创建。

## Success Criteria

- 系统提示明确工具虚拟根目录为 `/`，不再要求模型使用宿主机真实路径。
- 权限层拒绝常见宿主机绝对路径前缀，防止误写 `/Users/**`、`/home/**` 等虚拟路径。
- 定向测试和 node 侧类型检查通过。
