# Architecture

**Analysis Date:** 2026-05-26

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ ipc-handlers│  │     llm     │  │    deepagent        │  │
│  │  `[m/ih]`   │  │   `[m/l]`   │  │   `[m/d]`           │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                          │                                   │
│                    ┌─────▼─────┐                            │
│                    │ database  │                            │
│                    │ `[m/db]`  │                            │
│                    └───────────┘                            │
└─────────────────────────────────────────────────────────────┘
                           │ IPC (contextBridge)
┌─────────────────────────────────────────────────────────────┐
│                   Electron Renderer Process                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    React App                          │   │
│  │  ┌───────────┐  ┌───────────┐  ┌─────────────────┐   │   │
│  │  │  Sidebar  │  │  ChatArea │  │   TaskPanel     │   │   │
│  │  │ `[c/S]`   │  │ `[c/CA]` │  │   `[c/TP]`      │   │   │
│  │  └───────────┘  └───────────┘  └─────────────────┘   │   │
│  │                                                       │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │               Zustand Stores                    │  │   │
│  │  │  sessionStore | projectStore | themeStore | ...  │  │   │
│  │  │  `[s/]`                                        │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Main Process | Electron app lifecycle, window management, IPC registration | `src/main/index.ts` |
| IPC Handlers | Request routing, database operations, LLM orchestration | `src/main/ipc-handlers.ts` |
| LLM Module | Multi-provider LLM integration, streaming, tool execution | `src/main/llm.ts` |
| DeepAgent | Agent runtime using `deepagents` package | `src/main/deepagent/` |
| Database | SQLite via better-sqlite3, schema migrations | `src/main/database.ts` |
| Preload | Secure contextBridge API exposure | `src/preload/index.ts` |
| React App | UI rendering, state management, user interactions | `src/renderer/src/App.tsx` |
| Session Store | Chat session state, streaming, approvals | `src/renderer/src/stores/sessionStore.ts` |
| Project Store | Project/sidebar state | `src/renderer/src/stores/projectStore.ts` |

## Pattern Overview

**Overall:** Electron + React + Vite (electron-vite)

**Key Characteristics:**
- **Main/Renderer Separation:** Electron main process handles native operations, renderer is React SPA
- **IPC Communication:** Secure bidirectional IPC via contextBridge/preload
- **SQLite Persistence:** Local database via better-sqlite3 in main process
- **Zustand State:** Lightweight state management in renderer
- **Streaming LLM:** Server-sent events via IPC channels for real-time streaming
- **Multi-Provider Support:** OpenAI, Anthropic, Ollama, DeepSeek, GLM, Kimi, MiniMax, Qwen, Xiaomi MiMo

## Layers

**Main Process (`src/main/`):**
- Purpose: Native operations, database, LLM orchestration, window management
- Location: `src/main/`
- Contains: IPC handlers, LLM integration, database management, deepagent wrapper
- Depends on: electron, better-sqlite3, langchain packages, deepagents package
- Used by: Renderer via IPC

**Preload (`src/preload/`):**
- Purpose: Secure API bridge between main and renderer
- Location: `src/preload/`
- Contains: contextBridge definitions
- Depends on: electron
- Used by: Renderer via window.electronAPI

**Renderer (`src/renderer/src/`):**
- Purpose: React UI, state management, user interactions
- Location: `src/renderer/src/`
- Contains: React components, Zustand stores, hooks, styles
- Depends on: React 19, Zustand, assistant-ui, Tailwind CSS
- Used by: Electron display

**Shared (`src/shared/`):**
- Purpose: Shared TypeScript types between main and renderer
- Location: `src/shared/`
- Contains: TypeScript interfaces (Project, Session, Message, LLMProvider, Agent, etc.)
- Depends on: None (pure types)
- Used by: Both main and renderer

## Data Flow

### Primary Request Path (Chat Message)

1. **User types message** (`src/renderer/src/components/ChatArea/ChatArea.tsx`)
2. **Session store sends via IPC** (`src/renderer/src/stores/sessionStore.ts:sendMessage`)
3. **IPC handler receives** (`src/main/ipc-handlers.ts:handleChat`)
4. **LLM module orchestrates** (`src/main/llm.ts:chat`)
5. **DeepAgent executes** (`src/main/deepagent/`)
6. **Stream events sent back** via IPC channel `llm:chunk-{requestId}`
7. **Session store receives** (`src/renderer/src/stores/sessionStore.ts`)
8. **React components re-render** with new state

### Secondary Flow (Approval)

1. **LLM requests approval** (`src/main/llm.ts:chat` sends `approval_required` event)
2. **Session store sets pendingApproval** (`src/renderer/src/stores/sessionStore.ts`)
3. **TaskPanel displays approval UI** (`src/renderer/src/components/TaskPanel/TaskPanel.tsx`)
4. **User approves/rejects** (sessionStore.resolveApproval)
5. **IPC sends resolution** (`src/main/ipc-handlers.ts`)
6. **LLM resumes execution**

**State Management:**
- Zustand stores in renderer for UI state
- SQLite in main process for persistent data
- IPC channels for cross-process communication
- Streaming state via `isStreaming` and `streamingMessageId` in sessionStore

## Key Abstractions

**ElectronAPI (preload bridge):**
- Purpose: Type-safe IPC API exposed to renderer
- Examples: `window.electronAPI.db.*`, `window.electronAPI.llm.*`, `window.electronAPI.store.*`
- Pattern: contextBridge.exposeInMainWorld

**LLMStreamEvent:**
- Purpose: Unified streaming event types
- Examples: `message_chunk`, `tool_start`, `tool_end`, `approval_required`, `run_updated`
- Pattern: Tagged union type in `src/shared/types.ts`

**Zustand Stores:**
- Purpose: Client-side state management
- Examples: `sessionStore`, `projectStore`, `themeStore`, `llmStore`, `mcpServerStore`, `skillStore`
- Pattern: `create<StateInterface>((set, get) => ({...}))`

## Entry Points

**Main Process:**
- Location: `src/main/index.ts`
- Triggers: Electron app launch (`app.whenReady()`)
- Responsibilities: Window creation, IPC handler registration, app lifecycle

**Preload:**
- Location: `src/preload/index.ts`
- Triggers: BrowserWindow creation (referenced in main/index.ts webPreferences.preload)
- Responsibilities: contextBridge API setup

**Renderer:**
- Location: `src/renderer/src/main.tsx`
- Triggers: React DOM root mount
- Responsibilities: App bootstrap, theme initialization

**React App:**
- Location: `src/renderer/src/App.tsx`
- Triggers: Main component mount
- Responsibilities: Layout orchestration, view routing (chat/settings/agents/plugins/tools)

## Architectural Constraints

- **Threading:** Node.js event loop in main, React UI in renderer (separate processes)
- **Global state:** `mainWindow` singleton in `src/main/index.ts`, `activeRequests` Map in `src/main/llm.ts`
- **Circular imports:** Potential between main/llm and main/ipc-handlers (llm imports db from ipc-handlers)
- **Context isolation:** Always enabled (nodeIntegration: false, contextIsolation: true)
- **Streaming:** Per-request IPC channels using requestId as channel suffix

## Anti-Patterns

### Blocking IPC in Renderer

**What happens:** Some IPC calls use `ipcRenderer.invoke` which blocks until response
**Why it's wrong:** Can cause UI freezes on slow operations (e.g., database queries)
**Do this instead:** Use streaming patterns where possible, or show loading states

### Direct Database Access from IPC Handlers

**What happens:** Database operations embedded directly in `ipc-handlers.ts`
**Why it's wrong:** Makes testing difficult, mixes concerns
**Do this instead:** Extract to dedicated repository/service layer in `src/main/` (see `database.ts` usage pattern)

## Error Handling

**Strategy:** Try-catch with error state in stores, user-facing error messages

**Patterns:**
- Store-level error state (`error: string | null`) propagated to UI
- IPC error events via `runtime_error` stream type
- `AbortError` handling for cancelled operations
- Database error logging via `console.error` in main process

## Cross-Cutting Concerns

**Logging:** electron-log (`src/main/logger.ts`)
**Validation:** TypeScript types (runtime validation not implemented)
**Authentication:** Per-provider API keys stored in SQLite, no unified auth
**Error Reporting:** Console logging in main, React error boundaries not evident

---

*Architecture analysis: 2026-05-26*
