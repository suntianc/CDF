---
phase: "02"
slug: chat-engine
plan: "02"
type: execute
wave: 1
depends_on: ["01"]
files_modified: []
autonomous: false
requirements:
  - CHAT-01
  - CHAT-02
  - CHAT-03
  - CHAT-04
  - CHAT-05
  - LLM-01
  - LLM-02
  - LLM-03
user_setup:
  - service: npm
    why: "Install assistant-ui dependencies"
    env_vars: []
must_haves:
  truths:
    - "用户可在 Master Agent 对话界面发送消息并收到回复"
    - "对话关闭后重新打开，历史消息仍存在"
    - "对话窗口使用率达 85% 阈值时，系统自动总结上下文"
    - "开启新会话时，旧会话 ID 和总结内容注入新会话"
    - "用户可通过会话 ID 查询历史对话记录"
    - "用户可配置多个 LLM 提供者"
    - "用户的 API Key 以加密形式安全存储"
    - "用户可在不同 LLM 提供者之间切换"
  artifacts:
    - path: "src/main/database.ts"
      provides: "Updated database schema with providers and messages"
    - path: "src/main/security.ts"
      provides: "Encryption/decryption using safeStorage"
    - path: "src/main/llm.ts"
      provides: "LLM providers integration and streaming helper"
    - path: "src/main/ipc-handlers.ts"
      provides: "Exposed IPC handlers for chat and settings"
    - path: "src/preload/index.ts"
      provides: "Updated contextBridge interface"
    - path: "src/renderer/src/stores/llmStore.ts"
      provides: "Zustand store for LLM settings"
    - path: "src/renderer/src/stores/sessionStore.ts"
      provides: "Zustand store for session & message state"
    - path: "src/renderer/src/components/ChatArea/ChatArea.tsx"
      provides: "Integrated assistant-ui Chat component"
    - path: "src/renderer/src/components/Settings/ModelSettings.tsx"
      provides: "UI for configuring LLM settings"
  key_links:
    - from: "src/renderer/src/components/ChatArea/ChatArea.tsx"
      to: "src/renderer/src/stores/sessionStore.ts"
      via: "React hooks connecting custom assistant-ui runtime to Zustand"
    - from: "src/main/llm.ts"
      to: "src/main/security.ts"
      via: "Decrypting API keys prior to sending requests"
---

<objective>
**Phase Goal:** 用户可与 Master Agent 进行多轮对话，配置 LLM 提供者并加密持久化，自动检测 85% 窗口阈值并执行上下文总结和会话级联。

**Purpose:** Connect the frontend React 19 UI with a secure local LLM execution backend in Electron. This ensures developer API keys are safely encrypted locally, chat histories are persisted in SQLite, and context overflow is handled gracefully via LLM summarization.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/02-chat-engine/02-CONTEXT.md
@.planning/phases/02-chat-engine/RESEARCH.md
</context>

<dependency_graph>
## Phase 2 Dependency Graph

```
Wave 1 (Database & Dependencies):
├── [T1.1] Install @assistant-ui/react dependencies
└── [T1.2] Apply SQLite schema upgrades (providers, messages, sessions)

Wave 2 (Security & Main Process LLM Service):
├── [T2.1] Create safeStorage API helper for encryption
├── [T2.2] Build Main Process LLM execution & streaming helper
├── [T2.3] Add IPC handlers for database/LLM/settings
└── [T2.4] Expose IPC methods via Preload script

Wave 3 (Zustand Stores & Session Logic):
├── [T3.1] Create Zustand store for LLM configurations
└── [T3.2] Create Zustand store for Sessions & messages, and streaming handler

Wave 4 (UI Integration & Auto-Summarization):
├── [T4.1] Implement Model Settings panel UI
├── [T4.2] Integrate @assistant-ui/react in ChatArea component
└── [T4.3] Implement 85% threshold summarization & session cascade
```
</dependency_graph>

<tasks>

## Wave 1: Database & Dependencies

<task type="checkpoint:human-verify" gate="blocking">
<name>Task 1.1: Install @assistant-ui/react dependencies</name>
<files>package.json, node_modules/</files>
<action>
安装 `@assistant-ui/react` 依赖包，并在 React 19 下验证其可用性。
执行以下命令：
```bash
npm install @assistant-ui/react
```
</action>
<verify>
运行 `npm run dev` 确保正常编译启动无 React 19 运行时报错。
</verify>
<done>
@assistant-ui/react 已安装，并在 package.json 中列出。
</done>
</task>

<task type="auto">
<name>Task 1.2: Apply SQLite schema upgrades</name>
<files>src/main/database.ts</files>
<action>
修改 `src/main/database.ts`：
1. 追加 `llm_providers` 表：包含 `id`, `name`, `provider_type`, `api_key`, `api_url`, `default_model`, `context_limit`, `is_active`, `created_at`, `updated_at`。
2. 追加 `messages` 表：包含 `id`, `session_id`, `role`, `content`, `created_at`, `tokens`。
3. 对 `sessions` 表升级，以 try-catch 包裹执行 `ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL` 确保向下兼容。
</action>
<verify>
运行 `npm run build` 和 `npm run test` 均通过，无 SQLite 语法错误。
</verify>
<done>
数据库 Schema 自动升级并包含提供者和消息表。
</done>
</task>

## Wave 2: Security & Main Process LLM Service

<task type="auto">
<name>Task 2.1: Create safeStorage API helper for encryption</name>
<files>src/main/security.ts</files>
<action>
创建 `src/main/security.ts`，实现以下接口：
- `encryptApiKey(apiKey: string): string` — 调用 `safeStorage.encryptString()` 加密后，返回 base64 字符串。
- `decryptApiKey(encryptedBase64: string): string` — 对 base64 解码，然后调用 `safeStorage.decryptString()` 还原为明文。
- 添加必要的防御性校验，检测 `safeStorage.isEncryptionAvailable()`。
</action>
<verify>
编写测试或集成验证：确保加密后的字符串无法被简单解码，只能通过 decrypt 接口解密回原 API Key。
</verify>
<done>
安全加密助手函数已定义并验证通过。
</done>
</task>

<task type="auto">
<name>Task 2.2: Build Main Process LLM execution & streaming helper</name>
<files>src/main/llm.ts</files>
<action>
创建 `src/main/llm.ts`，基于 Node `fetch` 实现 OpenAI / Anthropic / Ollama 协议的请求发送和 Server-Sent Events (SSE) 流式解析。
当流式响应收到 chunk 时，使用主进程 webContents 发送消息：
```typescript
event.sender.send(`llm:chunk-${requestId}`, { type: 'chunk', text: chunkText })
```
流结束或出错时分别发送 `{ type: 'done' }` 和 `{ type: 'error', error: err.message }`。
</action>
<verify>
测试流式调用返回结构是否正确。
</verify>
<done>
主进程 LLM 客户端与 SSE 流解析逻辑实现完成。
</done>
</task>

<task type="auto">
<name>Task 2.3: Add IPC handlers for database/LLM/settings</name>
<files>src/main/ipc-handlers.ts</files>
<action>
修改 `src/main/ipc-handlers.ts`：
1. 注册 `db:getProviders` / `db:saveProvider` (含 safeStorage 加密) / `db:deleteProvider` / `db:setActiveProvider`。
2. 注册 `db:getMessages` (传入 `sessionId` 查询该会话的历史对话记录) / `db:saveMessage` / `db:deleteSession`。
3. 注册 `llm:chat` 接收 `requestId`, `messages`, `providerId`, `model`，调用 `src/main/llm.ts` 中的流接口。
</action>
<verify>
主进程相关编译通过，无重命名冲突。
</verify>
<done>
IPC 接口注册完毕，支持根据会话 ID 获取历史消息记录。
</done>
</task>

<task type="auto">
<name>Task 2.4: Expose IPC methods via Preload script</name>
<files>src/preload/index.ts</files>
<action>
在 `src/preload/index.ts` 中升级暴露的 `electronAPI` 对象：
- `electronAPI.db.getProviders` / `saveProvider` / `deleteProvider` / `setActiveProvider`。
- `electronAPI.db.getMessages(sessionId)` (允许传入会话 ID 查询历史消息) / `saveMessage`。
- `electronAPI.llm.chat(requestId, messages, providerId, model)`
- `electronAPI.llm.onChunk(requestId, callback)` 返回注销监听的 cleanup 函数。
</action>
<verify>
渲染进程可以通过全局 `window.electronAPI.llm` 访问相应 API，无 TypeScript 报错。
</verify>
<done>
Preload 桥接声明升级完成。
</done>
</task>

## Wave 3: Zustand Stores & Session Logic

<task type="auto">
<name>Task 3.1: Create Zustand store for LLM configurations</name>
<files>src/renderer/src/stores/llmStore.ts</files>
<action>
创建 `src/renderer/src/stores/llmStore.ts` 状态管理仓库：
- 存储 `providers`（提供者列表）、`activeProviderId`（当前激活提供者 ID）。
- 提供操作方法：`fetchProviders()`、`saveProvider()`、`deleteProvider()`、`setActiveProvider()`。
</action>
<verify>
Zustand 配置管理逻辑可通过测试驱动或直接测试。
</verify>
<done>
LLM 提供者配置的 Zustand Store 编写完毕。
</done>
</task>

<task type="auto">
<name>Task 3.2: Create Zustand store for Sessions & messages</name>
<files>src/renderer/src/stores/sessionStore.ts</files>
<action>
创建 `src/renderer/src/stores/sessionStore.ts` 状态管理仓库：
- 管理当前选中的 `activeSessionId`，加载当前会话的 `messages` 列表。
- 实现 `sendMessage(text)` 动作：
  1. 保存用户输入到数据库。
  2. 生成唯一的 `requestId`，并在前端界面添加一条空的 Assistant 消息占位。
  3. 调用 `window.electronAPI.llm.chat` 开始对话。
  4. 订阅 `window.electronAPI.llm.onChunk` 实时拼接接收到的文本 chunk，更新 Assistant 消息。
  5. 结束时（收到 `done`）将 Assistant 最终内容持久化到 SQLite 中。
</action>
<verify>
支持在控制台/页面发送消息测试流式拼接。
</verify>
<done>
会话状态与多轮对话流式订阅管理逻辑编写完毕。
</done>
</task>

## Wave 4: UI Integration & Auto-Summarization

<task type="auto">
<name>Task 4.1: Implement Model Settings panel UI</name>
<files>src/renderer/src/components/Settings/ModelSettings.tsx</files>
<action>
参考 `settings-2.html`，实现模型提供者设置面板：
- 渲染 OpenAI、Anthropic、Ollama 的配置表单（API Key, Endpoint, 默认模型, Context Limit）。
- API Key 输入框默认加掩码，支持点击眼睛图标切换明暗文。
- 提供“保存”与“激活”按钮，以及 Ollama 本地服务检测（自动请求 `/api/tags`）。
- 将该面板挂载到设置抽屉或 Sidebar 适当位置。
</action>
<verify>
UI 界面响应正常，保存密钥与表单更新表现一致。
</verify>
<done>
模型提供者配置面板实现完毕，与样式变量融合。
</done>
</task>

<task type="auto">
<name>Task 4.2: Integrate @assistant-ui/react in ChatArea component</name>
<files>src/renderer/src/components/ChatArea/ChatArea.tsx</files>
<action>
重构 `src/renderer/src/components/ChatArea/ChatArea.tsx`：
1. 引入 `@assistant-ui/react` UI 原语，构建符合 `dashboard.html` 效果的聊天框。
2. 使用 `useExternalStoreRuntime` 桥接 `sessionStore` 与 `@assistant-ui/react`。
3. 定制消息展示卡片、用户发送气泡底色、Markdown 代码段样式（使用 lucide 复制图标）。
</action>
<verify>
界面显示美观，消息输入和发送可以正常回调状态库。
</verify>
<done>
聊天渲染组件与 assistant-ui 的定制化整合完毕。
</done>
</task>

<task type="auto">
<name>Task 4.3: Implement 85% threshold summarization & session cascade</name>
<files>src/renderer/src/stores/sessionStore.ts, src/main/summarizer.ts</files>
<action>
1. 在主进程或渲染进程实现估算 Token 计算逻辑（基于字符 Heuristics）。
2. 在 `sessionStore` 每次消息发送结束后，验证已使用的 Token 占比（`totalTokens / contextLimit`）。
3. 当占比达到 85% 时，触发异步自动总结：
   - 调用 LLM 对当前会话进行总结，生成摘要。
   - 新建子会话，并设置其 `parent_session_id` 为原会话 ID。
   - 在新会话的上下文（或第一条 System 消息）中注入前序会话的 ID 和总结内容，作为后续大模型对话的上下文。
   - 更新 `activeSessionId` 为新会话，通知 UI 平滑切换。
   - 对话界面顶部显示 Cascade 连带指示器，支持在页面上点击原会话 ID 快速调用 `db:getMessages` 查询该会话的历史对话记录。
</action>
<verify>
模拟 context limit 较小（例如 500 tokens），输入几轮对话验证是否可以自动触发总结、生成摘要并切换到新会话。检查新会话是否正确写入了 `parent_session_id` 并在界面上显示连带指示器，且能通过点击指示器成功查询并渲染历史对话记录。
</verify>
<done>
自动总结触发、会话级联流、以及基于会话 ID 追溯历史记录的功能调试通过。
</done>
</task>

</tasks>
