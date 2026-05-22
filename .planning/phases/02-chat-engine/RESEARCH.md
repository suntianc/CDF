# Phase 2: AI Chat Engine - Research

**Date:** 2026-05-21

## 1. assistant-ui + React 19 适配与定制化

### 兼容性验证
通过 `npm show @assistant-ui/react` 确认，其最新的 peerDependencies 声明支持 React 19:
```json
{
  "react": "^18 || ^19",
  "react-dom": "^18 || ^19"
}
```
因此可以直接使用 npm 进行安装。

### 自定义样式对接
根据 `dashboard.html` 设计规范，聊天界面需要深浅色自适应且符合系统的 CSS 变量设计。`@assistant-ui/react` 允许通过组件覆写（Primitives）来自定义对话界面。我们将使用 `<Thread>` 和 `<Message>` 原语：
- **用户消息气泡**：具有半透明紫色底色 (`--accent-dim`) 与白色文字。
- **AI 消息内容**：直接渲染，文字为 `--color-text-primary`，使用系统默认字体与行高。
- **Markdown / 代码块**：渲染使用内置 Markdown 支持或结合 Lucide 图标提供代码复制功能。

---

## 2. Electron IPC 流式数据传输协议

要在 Electron 主进程与渲染进程之间传输大模型流式响应，我们设计基于事件 ID 的**订阅/发布模式**：

```
[Renderer]                                  [Main Process]
    │                                             │
    ├─ 1. 注册监听 `llm:chunk-${requestId}` ──>   │
    │                                             │
    ├─ 2. 调用 `ipcRenderer.invoke('llm:chat')` ──>│
    │    带上 `requestId` 及消息上下文             ├─ 3. 请求 LLM 流式接口
    │                                             ├─ 4. 循环获取 Stream Chunk
    │                                             │
    │  <─ 5. 发送 `webContents.send(...)` ────────┼─ 每次得到 chunk 时
    │        事件名: `llm:chunk-${requestId}`     │
    │                                             │
    │  <─ 6. 发送 `done` 信号 ────────────────────┼─ 流结束时
    │                                             │
    └─ 7. 注销监听，更新 UI 消息状态              │
```

### 渲染进程 IPC 暴露代码示例 (`src/preload/index.ts`)
```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  llm: {
    chat: (requestId: string, payload: ChatPayload) => ipcRenderer.invoke('llm:chat', requestId, payload),
    onChunk: (requestId: string, callback: (event: any, data: any) => void) => {
      const channel = `llm:chunk-${requestId}`;
      ipcRenderer.on(channel, callback);
      // 返回清理函数
      return () => ipcRenderer.removeAllListeners(channel);
    }
  }
});
```

---

## 3. 密钥安全加密方案

Electron 提供的 `safeStorage` 接口专门用于利用操作系统底层密钥链（Mac OS Keychain, Windows DPAPI, Linux secret-service）加密敏感字符串。

### 加密服务实现 (`src/main/security.ts`)
```typescript
import { safeStorage } from 'electron';

export function encryptApiKey(apiKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS safeStorage is not available on this platform.');
  }
  const encryptedBuffer = safeStorage.encryptString(apiKey);
  return encryptedBuffer.toString('base64');
}

export function decryptApiKey(encryptedBase64: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS safeStorage is not available on this platform.');
  }
  const buffer = Buffer.from(encryptedBase64, 'base64');
  return safeStorage.decryptString(buffer);
}
```

---

## 4. 数据库 Schema 追加设计

为了支持多提供者配置和消息持久化，我们需要更新 `src/main/database.ts` 初始化脚本：

### 1. 提供者表 `llm_providers`
```sql
CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,          -- 如 'OpenAI', 'Anthropic', 'Ollama (Local)'
  provider_type TEXT NOT NULL, -- 'openai' | 'anthropic' | 'ollama' | 'custom'
  api_key TEXT,                -- Base64 加密字符串
  api_url TEXT,                -- 自定义 Endpoint (Ollama 默认 http://localhost:11434/v1)
  default_model TEXT NOT NULL, -- 默认模型名称 (如 gpt-4o, claude-3-5-sonnet)
  context_limit INTEGER NOT NULL DEFAULT 8192, -- 窗口限制
  is_active INTEGER DEFAULT 0, -- 是否激活
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 2. 消息表 `messages`
```sql
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,          -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,       -- 消息文本
  created_at INTEGER NOT NULL,
  tokens INTEGER,              -- Token 数估算
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

### 3. 会话表 `sessions` 字段迁移
向 `sessions` 表追加 `parent_session_id` 字段，建立树形级联关系：
```sql
-- better-sqlite3 自动处理，在 Schema 初始化后尝试安全追加列
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
```
*(注意：需要用 try-catch 包裹 `ALTER TABLE` 避免重复添加导致报错)*

---

## 5. 85% 上下文总结与会话级联流

### Token 估算算法
由于离线环境，不适合引入过于臃肿的 C++ 原生 Tokenizer 模块，我们将使用**高精确度字符长度比率估算**（Heuristic Estimator）或轻量级 JS 纯库：
- **公式**：`English Words * 1.3 + Chinese Characters * 1.2`
- **实践代码**：
  ```typescript
  function estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const words = text.replace(/[\u4e00-\u9fa5]/g, '').trim().split(/\s+/).filter(Boolean).length;
    return Math.ceil(words * 1.3 + chineseChars * 1.2);
  }
  ```

### 自动总结流程
1. **检测触发**：计算当前会话所有消息的估算 Token 总和。若超过当前激活 Provider `context_limit` 的 85%，触发后台工作流。
2. **异步总结**：
   - 向当前 LLM 提供者发送系统总结请求：“总结以下对话内容，重点保留核心需求、决策、已生成资产，生成 500 字以内的结构化摘要：[对话原文]”。
   - 获取摘要内容。
3. **会话级联**：
   - 在数据库中创建新会话 `newSession`，设置其 `parent_session_id` 为当前会话 ID。
   - 在新会话中写入第一条特殊消息（Role: `system`），内容为：“[系统提示] 上文已超过 85% 限制，已自动总结并开启新会话。前序摘要如下：[摘要内容]”。
   - 将原会话的所有未总结消息在状态上归档或标记。
4. **前端响应**：
   - 通过 IPC 通知渲染进程会话已迁移，并传递 `newSessionId`。
   - 渲染进程通过 `useSessionStore` 切换到新会话，主对话面板重绘，并以优雅的卡片高亮展示摘要。
