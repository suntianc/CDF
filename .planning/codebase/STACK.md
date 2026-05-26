# Technology Stack

**Analysis Date:** 2026-05-26

## Languages

**Primary:**
- TypeScript 6.0.3 - Entire codebase (main, preload, renderer)

**Secondary:**
- None detected

## Runtime

**Environment:**
- Electron 41.0.0 - Desktop application runtime
- Node.js 22.0.0 (implied by `@types/node` v22)

**Package Manager:**
- npm (package.json based)
- Lockfile: Not present (no package-lock.json or yarn.lock detected)

## Frameworks

**Core Desktop:**
- Electron 41.0.0 - Cross-platform desktop framework
- electron-vite 5.0.0 - Vite-native Electron development/build tool
- Vite 7.0.0 - Frontend bundler

**Frontend UI:**
- React 19.2.6 - UI framework
- Tailwind CSS 4.3.0 - Utility CSS
- @tailwindcss/vite 4.1.0 - Tailwind Vite plugin
- Shadcn/ui primitives (via Radix):
  - @radix-ui/react-dialog 1.1.15
  - @radix-ui/react-dropdown-menu 2.1.16
  - @radix-ui/react-scroll-area 1.2.8
  - @radix-ui/react-tooltip 1.2.8
- Lucide React 1.16.0 - Icon set
- class-variance-authority 0.7.1 - Component variant styling

**Chat Interface:**
- @assistant-ui/react 0.14.5 - AI chat components (Vercel/AI SDK team)

**State Management:**
- Zustand 5.0.13 - Global state management

**LLM/AI Integration:**
- LangChain ecosystem:
  - @langchain/core 1.1.48
  - @langchain/anthropic 1.4.0
  - @langchain/openai 1.4.7
  - @langchain/ollama 1.2.7
  - @langchain/mcp-adapters 1.1.3
  - @langchain/langgraph-checkpoint-sqlite 1.0.1

**Database:**
- better-sqlite3 12.10.0 - SQLite bindings for Node.js
- electron-store 10.2.0 - Key-value storage for settings

**Testing:**
- Vitest 3.0.0 - Test runner
- @testing-library/dom 10.0.0 - DOM testing
- @testing-library/react 16.0.0 - React component testing
- @testing-library/user-event 14.5.0 - User event simulation
- jsdom 26.1.0 - DOM environment for tests

**Build/Package:**
- electron-builder 26.0.0 - Electron app packaging
- @electron/rebuild 4.0.4 - Native module rebuilding

## Key Dependencies

**Critical:**
- @assistant-ui/react 0.14.5 - Core chat UI for agent interaction
- @langchain/core 1.1.48 - LLM abstraction layer
- better-sqlite3 12.10.0 - Local data persistence
- electron-store 10.2.0 - App settings storage

**Agent/Workflow:**
- @langchain/mcp-adapters 1.1.3 - MCP (Model Context Protocol) client for external tools
- @langchain/langgraph-checkpoint-sqlite 1.0.1 - State persistence for agent runtime
- deepagents 1.10.2 - Deep agent framework

**Web Content Processing:**
- @mozilla/readability 0.6.0 - Extract readable content from web pages
- turndown 7.2.4 - HTML to Markdown conversion
- @napi-rs/canvas 1.0.0 - Canvas API for jsdom (native module)

**Logging:**
- electron-log 5.4.4 - Cross-process logging

**Icons:**
- @lobehub/icons 5.8.0 - Brand/model icons
- lucide-react 1.16.0 - UI icons

## Configuration

**Build Configuration:**
- `electron.vite.config.ts` - Main build configuration with three entry points (main, preload, renderer)
  - Main process: externalizes canvas, jsdom, @mozilla/readability, turndown, @napi-rs/canvas
  - Preload: externalizes dependencies
  - Renderer: React + Tailwind plugins, path alias `@` → `src/renderer/src`

**TypeScript Configuration:**
- `tsconfig.json` - Base config targeting ES2022, ESNext modules
- `tsconfig.node.json` - For main/preload processes
- `tsconfig.web.json` - For renderer process

**Test Configuration:**
- `vitest.config.ts` - Test runner with jsdom environment, path alias `@` for renderer

**Electron Builder:**
- `package.json` build section - macOS dmg, Windows nsis, Linux AppImage
- App ID: `com.cdf.app`

## Platform Requirements

**Development:**
- Node.js 22+
- npm for package management
- electron-vite for dev server with HMR

**Production:**
- Electron 41+ runtime
- macOS/Windows/Linux desktop environment
- SQLite (via better-sqlite3 native module)

---

*Stack analysis: 2026-05-26*
