# Claude.md

Must be use Chinese.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**CDF — 本地多领域 Agent 工作站**

基于 deepagents SDK 的离线桌面全栈 Agent 工作站。用户通过 Master Agent 对话界面描述任务，Master Agent 统筹工作流执行，调用已配置的 MCP、Skills、Workflows、文件系统、浏览器与本地知识，把跨领域目标（开发、研究、写作、数据、运营、自动化办公）交给本地 Agent 协作处理。**工作站，不是聊天框。** 用户组织的是任务、上下文、Agent、能力、过程与产物，不是单纯的对话气泡。

**Core Value:** 用户可以把跨领域目标交给本地 Agent 协作处理，同时保留上下文控制权、关键节点审批权和最终产物所有权。

### Audience

不只面向开发者。开发者、研究者、创作者、产品/运营、小团队负责人，以及任何需要把本地文件、知识、工具和自动化流程交给 Agent 协作处理的人。

### Constraints

- **离线优先**：所有数据本地存储，不依赖网络
- **Electron 桌面应用**：跨平台桌面环境
- **技术栈**：Electron + React + Vite | **streamdown**（流式 markdown 渲染 + KaTeX 公式）| ReactFlow（工作流组件）| Tailwind + Shadcn UI | Zustand
- **双主题**：Light（奶白画布 + 粉彩 color block + accent-magenta #e2007a）/ Dark（冷黑画布 + 同一套 block + Intelligence Violet #7c3aed）。两主题共享 ink 角色、状态色、组件语法、spacing
- **设计语言**：Task Surface · Activity Trail · Agent Bench · Capability Shelf · Artifact Space · Workflow Canvas。不用 chat bubble、icon-card 网格、紫色 SaaS Dashboard、hero-metric 模板、玻璃拟态默认
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

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
### Streaming Markdown Renderer
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **streamdown** | latest | Streaming markdown | Purpose-built for LLM streaming interfaces; markdown/code/LaTeX/alert/details rendering out of box; `parseIncompleteMarkdown` switch for live vs static |
| **@streamdown/math** | matching | KaTeX formula plugin | Inline + block math, error color respects theme tokens |
| **katex** | latest | Formula rendering | Underlies the math plugin; we wrap with a `MathFallback` danger-bordered block on parse failure |

> Replaces the earlier `assistant-ui` recommendation. The streaming layer routes all messages through a single `StreamdownRenderer` so the work-in-progress and finished states share one markdown engine.
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
### Local Data Storage (Offline-First)
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **better-sqlite3** | v11+ | SQLite bindings | Fast, synchronous API, perfect for Electron main process |
| **Drizzle ORM** | v0.38+ | Database ORM | Type-safe, lightweight, great DX |
| **electron-store** | v10+ | Key-value storage | For settings, simple config that doesn't need SQL |
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
### Process Management (for deepagents / local tools)
| Technology | Purpose | Why |
|------------|---------|-----|
| **deepagents** | Agent runtime | `createDeepAgent` + `CompositeBackend` + `StateBackend` + `FilesystemBackend` + `registerHarnessProfile` (`src/main/deepagent/runtime.ts`) |
| **@langchain/langgraph** | Agent state graph | Underlies deepagents; `SqliteSaver` checkpoints (`src/main/deepagent/runtime.ts:63`) |
| **node-pty** | PTY for interactive CLI | If a local tool needs terminal emulation |
| **xterm.js** | Terminal emulator UI | If rendering a local tool's terminal output |
### Logging & Error Handling
| Technology | Purpose | Why |
|------------|---------|-----|
| **electron-log** | Cross-process logging | Unified logging, file rotation, crash reports |
| **Sentry** (optional) | Error tracking | Desktop crash reporting |
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Build tool | electron-vite | electron-forge | electron-vite is more Vite-native, faster HMR |
| Build tool | electron-vite | electron-builder | electron-builder is for packaging only, not dev workflow |
| Streaming markdown | streamdown | Custom + Radix | streamdown saves 2-4 weeks; we still own component overrides via `components` prop |
| Workflow | ReactFlow | D3.js | ReactFlow is purpose-built, D3 is too low-level |
| State | Zustand | Redux Toolkit | Zustand has 1/3 the boilerplate |
| SQLite | better-sqlite3 | sql.js | Native bindings are 10x faster |
| ORM | Drizzle | Prisma | Drizzle is lighter, less runtime overhead |
## Anti-Patterns to Avoid
| Pattern | Why Avoid |
|---------|-----------|
| **electron-builder for dev** | It's a packager, not a dev server. Use electron-vite for development. |
| **Remote module** | Deprecated, security risk |
| **nodeIntegration: true** | Security vulnerability, use contextBridge |
| **Synchronous IPC in renderer** | Blocks UI thread |
| **Defaulting to Redux** | Overkill for most Electron apps |
## Installation
# Core dependencies
# UI
# Streaming (streamdown + KaTeX)
# Workflow
# State
# Database
# IPC/Utilities
## Sources
- [ ] Exact version numbers (verify with `npm view <package> version`)
- [ ] assistant-ui current API and React 19 compatibility
- [ ] electron-vite v3 stability and current best practices
- [ ] Tailwind v4 production readiness
## Architecture Implications
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
