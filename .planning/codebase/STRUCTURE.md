# Codebase Structure

**Analysis Date:** 2026-05-26

## Directory Layout

```
CDF/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts            # Entry point, window management
│   │   ├── ipc-handlers.ts     # IPC request handlers
│   │   ├── llm.ts              # LLM orchestration
│   │   ├── database.ts         # SQLite schema & migrations
│   │   ├── store.ts            # electron-store config
│   │   ├── logger.ts           # electron-log setup
│   │   ├── security.ts         # Security utilities
│   │   ├── provider-url.ts     # Provider URL utilities
│   │   ├── deepagent/          # DeepAgent wrapper
│   │   └── *.test.ts           # Tests
│   ├── preload/                # Preload scripts (contextBridge)
│   │   └── index.ts            # Exposes electronAPI to renderer
│   ├── renderer/               # React frontend
│   │   ├── public/             # Static assets
│   │   └── src/                # Source code
│   │       ├── main.tsx        # React entry point
│   │       ├── App.tsx         # Root component
│   │       ├── components/    # React components
│   │       ├── stores/        # Zustand stores
│   │       ├── hooks/         # Custom React hooks
│   │       ├── lib/           # Utilities
│   │       ├── styles/        # Global styles
│   │       └── env.d.ts       # Type declarations
│   └── shared/                 # Shared types
│       └── types.ts            # TypeScript interfaces
├── resources/                   # Static resources (icons)
├── electron.vite.config.ts     # Build configuration
├── package.json                # Dependencies
├── tsconfig.json              # TypeScript config
├── tsconfig.web.json          # Web/renderer TypeScript config
├── tsconfig.node.json         # Node/main TypeScript config
└── vitest.config.ts          # Test configuration
```

## Directory Purposes

**`src/main/`:**
- Purpose: Electron main process (Node.js runtime)
- Contains: IPC handlers, LLM integration, database, window management
- Key files: `index.ts`, `ipc-handlers.ts`, `llm.ts`, `database.ts`

**`src/preload/`:**
- Purpose: Secure bridge between main and renderer
- Contains: contextBridge API exposure
- Key files: `index.ts`

**`src/renderer/src/`:**
- Purpose: React frontend (browser runtime)
- Contains: Components, stores, hooks, utilities, styles
- Key files: `App.tsx`, `main.tsx`

**`src/shared/`:**
- Purpose: Shared TypeScript types used by both main and renderer
- Contains: Interfaces for Project, Session, Message, LLMProvider, Agent, etc.
- Key files: `types.ts`

## Key File Locations

**Entry Points:**
- `src/main/index.ts`: Electron main process entry
- `src/preload/index.ts`: Preload script entry
- `src/renderer/src/main.tsx`: React entry point

**Configuration:**
- `electron.vite.config.ts`: Vite/Electron build config
- `package.json`: Dependencies and scripts
- `tsconfig.json`: Base TypeScript config
- `tsconfig.web.json`: Renderer TypeScript config
- `tsconfig.node.json`: Main process TypeScript config

**Core Logic:**
- `src/main/ipc-handlers.ts`: IPC request routing
- `src/main/llm.ts`: LLM streaming and orchestration
- `src/main/database.ts`: SQLite database setup

**Database Schema:**
- `src/main/database.ts`: Schema definitions and migrations (projects, sessions, messages, llm_providers, agents, mcp_servers, agent_runs, agent_tool_calls, tool_configs)

**State Management (Zustand):**
- `src/renderer/src/stores/sessionStore.ts`: Chat sessions, streaming, approvals
- `src/renderer/src/stores/projectStore.ts`: Projects, sidebar state
- `src/renderer/src/stores/themeStore.ts`: Theme preference
- `src/renderer/src/stores/llmStore.ts`: LLM providers
- `src/renderer/src/stores/mcpServerStore.ts`: MCP servers
- `src/renderer/src/stores/skillStore.ts`: Skills
- `src/renderer/src/stores/agentStore.ts`: Agents

**UI Components:**
- `src/renderer/src/components/Sidebar/Sidebar.tsx`: Navigation sidebar
- `src/renderer/src/components/ChatArea/ChatArea.tsx`: Chat interface
- `src/renderer/src/components/TaskPanel/TaskPanel.tsx`: Approval/task panel
- `src/renderer/src/components/Settings/ModelSettings.tsx`: LLM provider settings
- `src/renderer/src/components/Settings/ToolSettings.tsx`: Tool configuration
- `src/renderer/src/components/AgentLibrary/AgentLibrary.tsx`: Agent management
- `src/renderer/src/components/PluginsPanel/PluginsPanel.tsx`: Plugins/MCP panel

**Testing:**
- `src/main/ipc-handlers.test.ts`: IPC handler tests
- `src/main/provider-url.test.ts`: Provider URL tests
- `src/main/llm.test.ts`: LLM integration tests
- `src/renderer/src/stores/sessionStore.test.ts`: Session store tests
- `src/renderer/src/stores/themeStore.test.ts`: Theme store tests

## Naming Conventions

**Files:**
- PascalCase for React components: `ChatArea.tsx`, `ModelSettings.tsx`
- camelCase for TypeScript/JS files: `ipc-handlers.ts`, `sessionStore.ts`
- kebab-case for directories: `AgentLibrary/`, `TaskPanel/`
- `.test.ts` suffix for test files

**Functions:**
- camelCase: `fetchSessions`, `sendMessage`, `resolveApproval`
- Verb-noun pattern for actions

**Variables:**
- camelCase: `activeSessionId`, `isStreaming`
- PascalCase for React component references

**Types:**
- PascalCase: `LLMProvider`, `AgentRun`, `Session`
- Interface names without "I" prefix

## Where to Add New Code

**New Feature (UI):**
- Primary code: `src/renderer/src/components/{FeatureName}/`
- Tests: `src/renderer/src/components/{FeatureName}/*.test.tsx`

**New Feature (Main Process):**
- Primary code: `src/main/{feature}.ts`
- IPC handlers: Add to `src/main/ipc-handlers.ts`
- Tests: `src/main/{feature}.test.ts`

**New Store:**
- Implementation: `src/renderer/src/stores/{storeName}Store.ts`
- Type definition: Add interface to `src/renderer/src/stores/{storeName}Store.ts`
- Import in components as needed

**New Database Table:**
- Schema: Add to `src/main/database.ts` schema section
- Migration: Add ALTER TABLE in migration section
- IPC handlers: Add get/save/delete in `src/main/ipc-handlers.ts`
- Type definition: Add interface in `src/shared/types.ts`
- Preload API: Add methods to `src/preload/index.ts`

**New IPC Channel:**
- Handler: Add in `src/main/ipc-handlers.ts`
- Preload: Add to `window.electronAPI` in `src/preload/index.ts`
- Renderer: Call via `window.electronAPI.{module}.{method}`

## Special Directories

**`src/main/deepagent/`:**
- Purpose: DeepAgent wrapper package
- Generated: No
- Committed: Yes

**`src/renderer/src/components/ui/`:**
- Purpose: Shadcn/ui base components
- Generated: Yes (copy-paste pattern, not npm dependency)
- Committed: Yes

**`.planning/`:**
- Purpose: GSD workflow artifacts
- Generated: Yes (by GSD commands)
- Committed: Yes

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes
- Committed: No (.gitignore)

**`out/`, `dist/`:**
- Purpose: Build output
- Generated: Yes
- Committed: No (.gitignore)

---

*Structure analysis: 2026-05-26*
