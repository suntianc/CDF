# Phase 2: AI Chat Engine - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

## Phase Boundary

实现 Master Agent 多轮对话界面、会话历史本地 SQL 存储、LLM 提供者配置与加密安全存储、以及 85% 窗口阈值触发的上下文自动总结与会话级联机制。

<decisions>
## Implementation Decisions

### 1. 对话界面 (Chat UI)
- **D-01:** 集成 `@assistant-ui/react` 对话组件库，并在 React 19 下验证其稳定性。
- **D-02:** 主体样式深度契合系统的主题变量（CSS Variables），完美继承 Light/Dark 模式。
- **D-03:** 基于 `dashboard.html` 设计稿，对 `@assistant-ui/react` 的输入框、消息气泡和代码块进行定制渲染。

### 2. LLM 核心与提供者管理
- **D-04:** 支持三大模型通道：OpenAI、Anthropic、本地 Ollama（及自定义 OpenAI 兼容接口）。
- **D-05:** 在 Electron 主进程（Main Process）实现 LLM 调用与流式（Streaming）响应转发，避免 Renderer 进程跨域（CORS）与密钥暴露。
- **D-06:** 主进程提供 `llm:chat` IPC 通道，支持流式传输（基于 Electron WebContents send 机制或 IPC 端口通道）。

### 3. 安全密钥存储 (Credential Security)
- **D-07:** 使用 Electron 原生 `safeStorage` API 在主进程对用户的 API Key 进行加密。
- **D-08:** 加密后的密文（Base64 编码）存储于 SQLite 数据库 `llm_providers` 表中，解密仅在主进程发起请求前即时进行，绝不流向 Renderer 进程或明文持久化。

### 4. 数据库存储与历史管理
- **D-09:** 新增 `llm_providers` 表，存储提供者配置、支持模型、上下文限额（Context Limit）及加密密钥。
- **D-10:** 新增 `messages` 表，存储多轮对话记录（角色 `user`/`assistant`/`system`、内容、生成时间、预估 Token 数）。
- **D-11:** `sessions` 表支持父子级联（新增 `parent_session_id` 字段），用于支持上下文总结后的新老会话关联。

### 5. 上下文自动总结 (Auto-Summarization)
- **D-12:** 计算上下文窗口：每次消息收发后，使用轻量级 Token 估算算法（或字符数估算：如 1 Token ≈ 3.5 字符）计算当前会话中所有未总结消息的 Token 总和。
- **D-13:** 触发总结：若 Token 总和达到当前模型 Context Limit 的 85%，触发后台自动总结任务。
- **D-14:** 会话级联：总结任务调用 LLM 压缩当前会话内容，生成一段摘要。随后自动在数据库中新建一个会话，将 `parent_session_id` 指向原会话，并将旧会话 ID 和总结内容作为首条 System 消息或上下文描述注入新会话。
- **D-15:** UI 切换：前端检测到会话迁移后，自动平滑切换到新会话，并以特殊气泡/折叠卡片展示“前序会话总结”。
- **D-16:** 历史追溯能力：系统在 IPC 及底层提供按会话 ID 查询历史消息的功能（注册 `db:getSessionMessagesById(sessionId)`），支持 Agent 或用户根据具体会话 ID 检索历史对话记录。

</decisions>

<canonical_refs>
## Canonical References

### 设计参考
- `dashboard.html` — 主工作台聊天面板样式（发送/停止按钮、输入框、折叠设计）
- `settings-2.html` — 模型提供者配置面板（表单、切换开关、密码/Key 输入框）

### 技术规范
- Electron `safeStorage` API 官方文档
- `@assistant-ui/react` 运行时配置文档
- SQLite WAL (Write-Ahead Logging) 模式规范

</canonical_refs>

<codebase_context>
## Existing Code Insights

### Reusable Assets
- `src/main/database.ts` — 数据库初始化入口，直接在此追加 `llm_providers` 与 `messages` 建表语句，并执行 `ALTER TABLE sessions ADD COLUMN parent_session_id TEXT`。
- `src/renderer/src/components/ChatArea/ChatArea.tsx` — 目前为 Phase 1 占位组件，将被重构为真正的 `@assistant-ui/react` 挂载点。
- `src/renderer/src/stores/` — 可在此创建 `useSessionStore` 和 `useLLMStore`，管理当前选中的会话、历史记录以及可用模型列表。

### Integration Points
- Sidebar 中的 `ProjectTree` 需要与会话管理对接，支持切换会话、创建会话。
- 主进程 `src/main/ipc-handlers.ts` 需要注册 llm 加密、LLM 调用、消息增删改查等一系列 IPC 接口。

</codebase_context>

<specifics>
## Specific Ideas

- LLM 密钥输入框支持明暗文切换，默认以星号（`••••••••`）掩码显示。
- Ollama 本地模型提供检测按钮，点击后发送请求到 `http://localhost:11434/api/tags` 自动拉取本地可用模型列表。
- 自动总结触发时，主聊天界面展示加载动画（如 “正在总结前文以释放空间...”），完成后无缝过渡。

</specifics>

<deferred>
## Deferred Ideas

- 多 Agent 协作对话（Phase 3 范围）
- 细粒度 LLM 温度（Temperature）、Top-P 等参数微调（v1 范围外，采用模型默认参数）

---
*Phase: 2-AI Chat Engine*
*Context gathered: 2026-05-21*
