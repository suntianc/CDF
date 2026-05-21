# Technology Stack

**Project:** Agent 开发工作站 (Agent Development Workstation)
**Researched:** 2026-05-21
**Confidence:** MEDIUM (based on training data, external verification recommended)

## Recommended Stack

### Core Desktop Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Electron** | v33+ | Desktop runtime | Cross-platform, mature ecosystem, Node.js backend integration |
| **electron-vite** | v3+ | Build tool | Vite-native Electron development, fast HMR, official recommended approach |
| **Vite** | v6+ | Frontend bundler | Fast dev server, native ESM, excellent TypeScript support |
| **React** | v19 | UI framework | Component model, vast ecosystem |
| **TypeScript** | v5.7+ | Language | Type safety critical for complex agent/workflow state |

### UI Component Libraries

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Tailwind CSS** | v4+ | Utility CSS | Rapid UI development, consistent design system |
| **Shadcn/ui** | latest | Component primitives | Accessible, customizable, copy-paste not dependency |
| **Radix UI** | v1.2+ | Headless components | Underlies shadcn, accessible primitives |
| **Lucide React** | latest | Icons | Consistent, tree-shakeable icon set |

### Chat Interface

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **assistant-ui** | latest | Chat components | Purpose-built for AI chat, Markdown/Code rendering, streaming support |
| **or** | | | |
| **chat-ui** (TailChat) | latest | Alternative chat UI | More customizable, if assistant-ui insufficient |

**Rationale for assistant-ui:**
- Built by Vercel/AI SDK team
- Designed for LLM streaming interfaces
- Markdown/code block rendering out of box
- Compatible with React 19

### Workflow Visualization

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **ReactFlow** (@xyflow/react) | v12+ | Node-based editor | Industry standard for workflow orchestration UIs, drag-drop nodes, edges, minimap |
| **@xyflow/system** | v0.6+ | State management for flow | If needing custom node behavior |

### State Management

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Zustand** | v5+ | Global state | Minimal boilerplate, TypeScript-first, great for workflow state |
| **XState** | v5+ | Workflow state machines | If workflow nodes need complex state machine semantics |
| **Jotai** | v2+ | Atomic state | Alternative for fine-grained reactivity |

**Recommendation:** Zustand for global app state + XState for individual workflow node execution states

### Local Data Storage (Offline-First)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **better-sqlite3** | v11+ | SQLite bindings | Fast, synchronous API, perfect for Electron main process |
| **Drizzle ORM** | v0.38+ | Database ORM | Type-safe, lightweight, great DX |
| **electron-store** | v10+ | Key-value storage | For settings, simple config that doesn't need SQL |

**Alternative for renderer process:**
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Dexie.js** | v4+ | IndexedDB wrapper | If needing browser-side indexed storage |
| **sql.js** | latest | SQLite WASM | If native modules problematic |

### IPC Communication (Main-Renderer)

| Technology | Purpose | Why |
|------------|---------|-----|
| **Electron contextBridge** | Secure API exposure | Mandatory for security, preload scripts |
| **Electron IPC** | Message passing | Standard pattern for main-renderer communication |
| **electron-trpc** | Type-safe RPC | If wanting end-to-end TypeScript IPC |

### Process Management (for pi-code-agent)

| Technology | Purpose | Why |
|------------|---------|-----|
| **child_process.spawn** | Node child processes | Standard Node.js, sufficient for CLI invocation |
| **node-pty** | PTY for interactive CLI | If needing terminal emulation for pi-code-agent |
| **xterm.js** | Terminal emulator UI | If rendering pi-code-agent output in terminal panel |

### Logging & Error Handling

| Technology | Purpose | Why |
|------------|---------|-----|
| **electron-log** | Cross-process logging | Unified logging, file rotation, crash reports |
| **Sentry** (optional) | Error tracking | Desktop crash reporting |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Build tool | electron-vite | electron-forge | electron-vite is more Vite-native, faster HMR |
| Build tool | electron-vite | electron-builder | electron-builder is for packaging only, not dev workflow |
| Chat UI | assistant-ui | Custom + Radix | assistant-ui saves 2-4 weeks of work |
| Workflow | ReactFlow | D3.js | ReactFlow is purpose-built, D3 is too low-level |
| State | Zustand | Redux Toolkit | Zustand has 1/3 the boilerplate |
| SQLite | better-sqlite3 | sql.js | Native bindings are 10x faster |
| ORM | Drizzle | Prisma | Drizzle is lighter, less runtime overhead |

---

## Anti-Patterns to Avoid

| Pattern | Why Avoid |
|---------|-----------|
| **electron-builder for dev** | It's a packager, not a dev server. Use electron-vite for development. |
| **Remote module** | Deprecated, security risk |
| **nodeIntegration: true** | Security vulnerability, use contextBridge |
| **Synchronous IPC in renderer** | Blocks UI thread |
| **Defaulting to Redux** | Overkill for most Electron apps |

---

## Installation

```bash
# Core dependencies
npm create electron-vite@latest my-app -- --template react-ts

cd my-app

# UI
npm install tailwindcss @tailwindcss/vite
npm install shadcn-ui
npx shadcn-ui@latest init

# Chat (if using assistant-ui)
npm install assistant-ui

# Workflow
npm install @xyflow/react

# State
npm install zustand xstate @xstate/react

# Database
npm install better-sqlite3
npm install drizzle-orm
npm install -D drizzle-kit @types/better-sqlite3

# IPC/Utilities
npm install electron-log electron-store
npm install uuid
npm install -D @types/uuid
```

---

## Sources

**Confidence: MEDIUM** — Based on training data through early 2026. Key areas needing verification:

- [ ] Exact version numbers (verify with `npm view <package> version`)
- [ ] assistant-ui current API and React 19 compatibility
- [ ] electron-vite v3 stability and current best practices
- [ ] Tailwind v4 production readiness

**Recommend verification commands:**
```bash
npm view electron version
npm view electron-vite version
npm view @xyflow/react version
npm view assistant-ui version
npm view tailwindcss version
npm view better-sqlite3 version
npm view zustand version
```

---

## Architecture Implications

The chosen stack supports the project's requirements:

1. **Offline-first**: better-sqlite3 + electron-store for local persistence
2. **Agent workflow**: ReactFlow for visualization + Zustand/XState for state
3. **Chat interface**: assistant-ui for Master Agent conversation UI
4. **Security**: contextBridge + preload for secure IPC
5. **Performance**: electron-vite provides Vite HMR speed for development
