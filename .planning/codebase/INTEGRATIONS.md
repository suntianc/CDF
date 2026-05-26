# External Integrations

**Analysis Date:** 2026-05-26

## APIs & External Services

### LLM Providers

All LLM integrations use API keys stored in local SQLite database (`llm_providers` table).

| Provider | Provider Type | API Base URL | Default Model | Purpose |
|----------|--------------|--------------|---------------|---------|
| **OpenAI** | `openai` | `https://api.openai.com/v1` | `gpt-4o` | Primary LLM |
| **Anthropic** | `anthropic` | `https://api.anthropic.com/v1` | `claude-3-5-sonnet-20241022` | LLM with extended context |
| **DeepSeek** | `deepseek` | `https://api.deepseek.com` | `deepseek-chat` | Cost-effective LLM |
| **GLM CN** | `glm` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | Chinese LLM |
| **GLM Overseas** | `glm-overseas` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | International GLM |
| **Minimax CN** | `minimax` | `https://api.minimaxi.com/v1` | `abab6.5g-chat` | Chinese LLM |
| **Minimax Overseas** | `minimax-overseas` | `https://api.minimax.io/v1` | `abab6.5g-chat` | International |
| **Kimi (Moonshot)** | `kimi` | `https://api.moonshot.ai/v1` | `moonshot-v1-8k` | Long context LLM |
| **Qwen (DashScope)** | `qwen` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | Alibaba LLM |
| **Xiaomi MiMo** | `mimo` | `https://api.xiaomimimo.com/v1` | `mimo-chat` | Xiaomi LLM |
| **Ollama** | `ollama` | `http://localhost:11434` | `llama3` | Local LLM |

**SDKs Used:**
- `@langchain/openai` - OpenAI-compatible API calls
- `@langchain/anthropic` - Anthropic API calls
- `@langchain/ollama` - Local Ollama server
- Custom adapters for DeepSeek, GLM, Minimax, Kimi, Qwen, MiMo (OpenAI-compatible)

**Auth:** API keys stored in `llm_providers.api_key` column in local SQLite DB

### MCP (Model Context Protocol)

**Integration:** `@langchain/mcp-adapters` - MultiServerMCPClient

**Purpose:** Connect to external MCP servers for tool invocation

**Transport Types:**
- STDIO - Local subprocess-based MCP servers
- SSE - HTTP Server-Sent Events-based MCP endpoints

**Cached per agent:** MCP client connections are cached by agentId to reuse long-lived connections

**File:** `src/main/deepagent/mcp-connector.ts`

## Data Storage

### SQLite Database

**Technology:** better-sqlite3 (native Node.js bindings)

**Location:** `{userData}/cdf.db` (app.getPath('userData'))

**Schema:**
- `projects` - Project directories
- `sessions` - Chat sessions with parent_session_id support
- `llm_providers` - Provider configuration (id, name, type, api_key, api_url, models, context_limit)
- `messages` - Chat messages per session
- `agents` - Agent configurations
- `agent_runs` - Runtime execution tracking
- `agent_tool_calls` - Tool call history
- `skills` - Skill definitions (legacy migration from file-based)

**WAL Mode:** Enabled for concurrent read performance

**File:** `src/main/database.ts`

### Key-Value Store

**Technology:** electron-store

**Location:** Electron store (JSON file in userData)

**Stores:**
- `theme` - UI theme (light/dark/system)
- `currentProjectId` - Active project
- `sidebarWidth` / `sidebarCollapsed` - UI state
- `windowBounds` - Window geometry persistence

**File:** `src/main/store.ts`

## Authentication & Identity

**Auth Provider:** Custom (API key-based per LLM provider)

**Implementation:**
- API keys stored encrypted in local SQLite `llm_providers` table
- No external auth service integration
- Provider selection managed in-app via settings

## Monitoring & Observability

### Logging

**Framework:** electron-log 5.4.4

**Transports:**
- File: `info` level, max 5MB per file
- Console: `debug` level

**Usage:**
- `src/main/logger.ts` - Configured logger instance
- Used in main process (`index.ts`, `ipc-handlers.ts`, etc.)

**Error Tracking:** None (no Sentry or similar)

## CI/CD & Deployment

**Hosting:** Self-hosted desktop application (Electron)

**CI Pipeline:** None detected (no GitHub Actions, GitLab CI, etc.)

**Distribution:**
- macOS: DMG with developer tools category
- Windows: NSIS installer
- Linux: AppImage

## Environment Configuration

**Required env vars:** None explicitly required (all config in app)

**Secrets location:**
- LLM API keys: SQLite `llm_providers` table
- App settings: electron-store JSON
- Window state: electron-store JSON

**Note:** No `.env` file committed; runtime configuration via electron-store

## Webhooks & Callbacks

**Incoming:** None detected

**Outgoing:** None detected

**Note:** MCP adapters may communicate externally via stdio or SSE when external MCP servers are configured

---

*Integration audit: 2026-05-26*
