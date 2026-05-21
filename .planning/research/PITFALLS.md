# Domain Pitfalls

**Domain:** Electron + React 桌面 Agent 工作流应用
**Researched:** 2026-05-21
**Confidence:** LOW — 无法通过外部工具验证，依赖训练数据

---

## Critical Pitfalls

### Pitfall 1: 主进程 / 渲染进程架构混乱

**问题描述:**
将业务逻辑直接写入主进程 (main process)，或过度使用 `nodeIntegration: true` 暴露 Node.js 到渲染进程。

**为何发生:**
- 初期原型阶段为方便，快速跳过 IPC 通信直接调用
- 不熟悉 Electron 安全模型

**后果:**
- 安全漏洞：恶意页面可访问本地系统
- 渲染进程崩溃导致整个应用崩溃
- 内存泄漏难以隔离

**预防策略:**
- 渲染进程禁用 `nodeIntegration`，启用 `contextIsolation` 和 `sandbox`
- 业务逻辑全部在渲染进程或专用 worker 中运行
- 主进程仅负责：窗口管理、IPC 路由、系统级 API 调用
- 使用 `contextBridge` 显式暴露必要的 API

**检测信号:**
- 渲染进程中出现 `require()` 或 `import` Node.js 模块
- 主进程代码超过 500 行无拆分
- 渲染进程直接调用 `fs`、`child_process` 等模块

**Phase 映射:** Foundation Phase — 架构设计必须在早期锁定

---

### Pitfall 2: IPC 通信滥用 / 阻塞调用

**问题描述:**
在 IPC 回调中执行耗时操作，或使用 `ipcRenderer.sendSync` 造成 UI 阻塞。

**为何发生:**
- 为图方便在同步 IPC 中做文件读写
- 不了解渲染进程与主进程的通信模型

**后果:**
- 主窗口冻结，用户体验差
- 大量并发请求时主进程成为瓶颈
- 调试困难，堆栈追踪断裂

**预防策略:**
- 所有主进程操作使用异步 API
- 使用 `ipcRenderer.invoke()` + `ipcMain.handle()` 模式（Promise-based）
- 耗时操作显示加载状态，不阻塞 UI
- 考虑使用 Worker 线程处理 CPU 密集任务

**检测信号:**
- 搜索代码中 `sendSync`、`invoke().then()` 的不当使用
- UI 在数据加载时无响应

**Phase 映射:** Foundation Phase — 通信模式设计

---

### Pitfall 3: 上下文窗口管理策略不当

**问题描述:**
Agent 工作流涉及大量 LLM 调用，上下文窗口快速耗尽但无管理策略。

**为何发生:**
- 项目设计中提到了上下文总结策略（85% 阈值），但未实现
- 对话历史无限累积

**后果:**
- LLM 调用失败（上下文超限）
- Token 成本失控
- 对话质量下降（模型倾向于重复）

**预防策略:**
- 实现分阶段上下文总结机制
- 考虑对话历史分段存储，而非全部驻留内存
- 设置最大对话轮次限制
- 对 Agent 工作流中的中间结果做摘要而非全量保存

**Phase 映射:** AI Chat Engine Phase — 对话管理核心部分

---

### Pitfall 4: 状态管理架构碎片化

**问题描述:**
Electron + React 项目中，状态分散在：Redux/Zustand、本地 state、Electron store、文件系统中，缺乏统一管理。

**为何发生:**
- 多团队或多人开发，未统一状态管理模式
- 图方便在组件内部管理本该全局的状态

**后果:**
- 状态同步困难（UI 显示与实际数据不一致）
- 调试时需要跨越多个数据源追踪 bug
- 序列化/反序列化复杂（Electron store 持久化）

**预防策略:**
- 选择统一状态管理方案（推荐 Zustand，轻量且 Electron 友好）
- 明确区分：UI 状态（组件内部）、应用状态（全局）、持久化状态（Electron Store）
- 建立状态更新规范：所有状态变更通过 action，禁止直接修改

**Phase 映射:** Foundation Phase — 状态架构设计

---

### Pitfall 5: 工作流执行状态与 UI 同步丢失

**问题描述:**
Agent 工作流执行时间可能很长，但状态同步机制不完善，导致用户不知道任务进度。

**为何发生:**
- 工作流执行在后台进行，UI 轮询或推送机制缺失
- Master Agent 与普通 Agent 节点通信状态未可视化

**后果:**
- 用户认为应用无响应
- 工作流失败时无清晰错误提示
- 无法中断正在执行的工作流

**预防策略:**
- 实现 WebSocket 或 Server-Sent Events 实时推送工作流状态
- 每个节点执行状态（pending/running/completed/failed）实时展示
- 提供取消/中断工作流的能力
- 日志面板实时输出执行细节

**Phase 映射:** 工作流可视化 Phase — 核心用户体验

---

### Pitfall 6: 本地数据存储方案选择不当

**问题描述:**
离线优先设计需要本地持久化，但选型不当（如用 IndexedDB 存结构化数据，或用 SQLite 做频繁小写入）。

**为何发生:**
- 未评估数据访问模式
- 随大流使用 "Electron 常用方案" 而非适合项目的方案

**后果:**
- 性能问题：查询缓慢、写入阻塞
- 数据一致性难以保证
- 迁移困难

**预防策略:**
- 结构化数据（如项目配置、Agent 定义）→ SQLite (better-sqlite3) 或 IndexedDB（如果数据量小）
- 文件类数据（工作流定义、日志）→ 文件系统 + 版本控制
- 避免在主进程做大量数据库写操作
- 考虑数据层抽象，便于未来切换存储方案

**Phase 映射:** Foundation Phase — 数据持久化架构

---

## Moderate Pitfalls

### Pitfall 7: 多窗口状态同步失效

**问题描述:**
Electron 支持多窗口，但窗口间共享状态（如当前项目、Agent 配置）未正确同步。

**为何发生:**
- 每个窗口维护独立状态副本
- 窗口关闭/打开时状态丢失

**预防策略:**
- 单一数据源存储在主进程或 Electron Store
- 窗口通过 IPC 获取最新状态
- 状态变更时广播到所有窗口

---

### Pitfall 8: 热更新机制缺失

**问题描述:**
开发阶段频繁重启 Electron 应用，每次重启丢失工作流状态。

**为何发生:**
- 未配置热更新（HMR for renderer，code reload for main）
- 忽视开发体验

**预防策略:**
- 使用 electron-builder / electron-vite 等工具内置热更新
- renderer 进程使用 React Fast Refresh
- main 进程配置 ts-node-dev 或类似方案实现代码重载
- 工作流执行状态写入临时文件，支持恢复

**Phase 映射:** Foundation Phase — 开发体验优化

---

### Pitfall 9: MCP 服务器集成疏漏

**问题描述:**
MCP (Model Context Protocol) 服务器配置与健康检查未实现，导致 Agent 调用失败无感知。

**为何发生:**
- MCP 是较新协议，官方工具可能不成熟
- 假设 MCP 服务器总是可用

**预防策略:**
- MCP 服务器启动前做健康检查（ping/pong）
- 可视化展示各 MCP 服务器状态（connected/disconnected/error）
- 实现超时机制和自动重连
- MCP 响应缓存减少重复调用

**Phase 映射:** MCP 管理 Phase

---

### Pitfall 10: 安全上下文隔离不完整

**问题描述:**
使用 `eval()` 或 `new Function()` 在渲染进程中执行用户提供的脚本（Agent skills），绕过安全模型。

**为何发生:**
- Skills 系统设计需要动态执行代码
- 认为 `contextIsolation` 足够安全

**后果:**
- 代码注入攻击
- 本地文件读取/修改风险

**预防策略:**
- 避免在渲染进程执行未信任代码
- 使用 Web Worker + 受限沙箱环境
- 主进程验证所有来自渲染进程的 skill 执行请求
- Skills 存储签名或校验机制

**Phase 映射:** Skills 管理 Phase

---

## Minor Pitfalls

### Pitfall 11: 自动更新忽视离线场景

**问题描述:**
使用 electron-updater 但未处理离线环境，导致应用卡在更新检查阶段。

**预防策略:**
- 离线环境跳过更新检查，直接启动
- 更新下载完成后提示用户而非自动安装

---

### Pitfall 12: 对话组件选型不谨慎

**问题描述:**
选择 assistant-ui 后发现定制能力不足，或与项目架构不兼容。

**预防策略:**
- Phase 早期做 POC，验证组件能力边界
- 检查组件是否支持：自定义渲染、多媒体消息、主题定制

**Phase 映射:** AI Chat Engine Phase 早期验证

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Foundation - 架构 | 主进程/渲染进程边界模糊 | 明确禁用 nodeIntegration，坚持 contextBridge |
| Foundation - 存储 | 数据模型设计不足 | 先定义数据 Schema，避免后期迁移 |
| AI Chat Engine | 对话历史内存泄漏 | 实现 85% 阈值总结机制 |
| AI Chat Engine | assistant-ui 定制受限 | 早期 POC 验证 |
| Workflow - ReactFlow | 节点状态与执行状态脱节 | 设计统一状态协议 |
| Workflow - 可视化 | 大规模节点性能问题 | 虚拟化、懒加载 |
| MCP 管理 | 服务器可用性检测缺失 | 实现健康检查与重连 |
| Skills 管理 | 动态代码执行安全 | 沙箱隔离，禁止主进程 eval |
| 主题切换 | 深色模式覆盖不完整 | 组件库级主题变量统一 |

---

## Sources

由于外部工具访问受限，以下为训练数据来源，**置信度 LOW**：

- Electron 官方安全文档（历史版本）
- Electron GitHub Issues 常见问题
- Electron Forge / electron-vite 社区最佳实践
- 行业博客：Electron 性能优化、架构设计

**建议：** 在 Phase 1 实施前，通过 Context7 验证 Electron 最新安全模型和推荐架构。
