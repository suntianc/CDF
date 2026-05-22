# AGENTS.md

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

**Agent 开发工作站**

基于 pi-code-agent 的离线桌面全栈 Agent 开发工作站。开发者通过 Master Agent 对话界面描述需求，Master Agent 统筹工作流执行，调用已配置的 MCP、Skills 构建自动化开发流程。支持多项目管理、工作流可视化编排、Agent 资产库管理。

**Core Value:** 开发者通过自然语言对话驱动自动化开发工作流，Master Agent 负责需求理解、流程编排、节点执行监控和结果交付。

### Constraints

- **离线优先**：所有数据本地存储，不依赖网络
- **Electron 桌面应用**：跨平台桌面环境
- **技术栈**：Electron + React + Vite | assistant-ui（对话组件）| ReactFlow（工作流组件）| Tailwind + Shadcn UI
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
### Chat Interface
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **assistant-ui** | latest | Chat components | Purpose-built for AI chat, Markdown/Code rendering, streaming support |
| **or** | | | |
| **chat-ui** (TailChat) | latest | Alternative chat UI | More customizable, if assistant-ui insufficient |
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
# Chat (if using assistant-ui)
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

No project skills found. Add skills to any of: `.Codex/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
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
> This section is managed by `generate-Codex-profile` -- do not edit manually.
<!-- GSD:profile-end -->
