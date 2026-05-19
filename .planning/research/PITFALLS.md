# Pitfalls Research: Desktop Agent Workbench

> 常见问题和预防策略

## 1. 主进程阻塞

**风险**: pi SDK 的 agent 操作是异步的，但如果处理不当，大量 MCP 调用或长时间 agent 推理可能阻塞主进程。

**预防策略**:
- agent session 的 prompt() 调用本身是异步的，通过事件回调处理结果
- MCP 工具调用走子进程 stdio，不阻塞主进程
- GSD 子 agent 生成走 child_process，独立进程隔离
- Electron 的 BrowserWindow 如果卡死，通过 `win.setBackgroundThrottling(false)` 控制

**检测**: 使用 Electron 的 `webContents.getProcessInfo()` 监控主进程响应性

## 2. MCP 进程管理

**风险**: 每个 MCP server 是一个 stdio 子进程。断开连接时如果没正确 kill，会留下僵尸进程。或者 server 崩溃导致 agent 调用失败。

**预防策略**:
- McpManager 持有所有 client 引用，disconnect 时调用 `transport.close()` + `process.kill()`
- 添加心跳检测，超时自动重连
- 调用 MCP tool 时加 try/catch，失败时给 agent 友好错误信息
- 应用退出前遍历所有 MCP 连接并关闭

## 3. Session 管理混乱

**风险**: 用户切换 workspace、切换 provider、重新配置后，旧的 agent session 没有正确清理，导致状态不一致。

**预防策略**:
- AgentManager 维护 `Map<workspace, AgentSession>`，切换 workspace 时自动 dispose 旧 session
- 每次 createSession() 使用新的 SessionManager，不重用
- workspace 变更 → dispose 所有关联的 MCP 连接和 agent session

## 4. Skills 安全

**风险**: Skill 是可以让 agent 执行任意操作的 markdown 文件。从 GitHub 安装不明来源的 skill 可能包含恶意指令。

**预防策略**:
- 安装 GitHub skill 时提示来源信息
- V1 不做自动执行，用户手动点击确认
- Skill 内容在 UI 中可预览
- 参考 pi 的设计：skill 说明在上下文，具体内容按需加载

## 5. Electron 包体积

**风险**: Electron + Node.js + pi SDK + shadcn/ui 全套下来包体可能很大。

**预防策略**:
- 使用 electron-builder 的 asar 打包
- 排除不必要的 native modules
- pi SDK 使用 tree-shakeable 的 import
- 图标用 lucide-react 按需加载而非字体图标

## 6. IPC 过度通信

**风险**: agent streaming 时每 token 都通过 IPC 推送，可能导致渲染进程卡顿。

**预防策略**:
- Agent event 在 main process 中 batch 处理
- text_delta 使用 requestAnimationFrame 节流
- 大量结构化数据（tool results）按需传递，不全部实时推送

## 7. GSD 子 agent 兼容性

**风险**: GSD 的 Task() 原语生成子 agent 依赖 `pi --mode json -p` 子进程。如果用户的 PATH 中没有 pi，会导致子 agent 启动失败。

**预防策略**:
- SkillManager 检测 `pi` 命令是否可用
- 提供配置项指定 pi 的路径
- 在 app 设置页显示诊断信息

## 8. 模型 API Key 泄露

**风险**: API Key 存在本地文件，如果用户系统被侵入可能泄露。

**预防策略**:
- 复用 pi 的 AuthStorage，使用系统 keychain（macOS Keychain / Windows Credential Manager）
- 或者加密存储到文件
- UI 中显示 Key 时 mask 处理
- 不将 Key 传到渲染进程，通过 IPC 由主进程代理调用

## 9. Workspace 切换时的状态恢复

**风险**: 用户打开 app，选择上次的 workspace，期望看到之前的对话历史和 MCP 连接状态。

**预防策略**:
- 最近打开的 workspace 列表持久化
- 对话历史用 pi SessionManager 自动恢复
- MCP 配置按 workspace 存储，切换时自动恢复连接
- 启动时如果有默认 workspace，自动初始化 agent session