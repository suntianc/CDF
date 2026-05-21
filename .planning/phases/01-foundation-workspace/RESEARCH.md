# Phase 1: Foundation Workspace - Research

**Researched:** 2026-05-21
**Domain:** Electron desktop app scaffold, theme system, project management infrastructure
**Confidence:** MEDIUM

## Summary

Phase 1 establishes the Electron desktop application foundation with a collapsible sidebar layout, CSS variable-based theme system (light/dark/system-following), and project management infrastructure. The core technical decisions are: electron-vite v5 for build tooling, electron-store for simple config persistence, better-sqlite3 for structured project/session data, and Tailwind CSS v4 with CSS variables for theming. The main/renderer architecture uses contextBridge for secure IPC. React 19 is the UI framework with Shadcn/ui component primitives.

**Primary recommendation:** Use electron-vite v5.0.0 scaffolding with React + TypeScript template, configure CSS variables at `:root` level with `data-theme` attribute toggling, use electron-store for theme preference persistence, and better-sqlite3 (synchronous, used only in main process) for project data.

## User Constraints (from CONTEXT.md)

### Locked Decisions

| ID | Decision |
|----|----------|
| D-01 | Base layout on `codex-onboarding.html` and `dashboard.html` high-fidelity designs |
| D-02 | Three-area structure: collapsible/draggable sidebar + main chat area + floating task panel |
| D-03 | Sidebar drag-resizable 200px ~ 500px |
| D-04 | Sidebar collapsible to 0 with fixed drawer handle |
| D-05 | CSS variables for theming (`--bg-app`, `--bg-sidebar`, `--accent` etc.) |
| D-06 | Dark/light/system-following three modes |
| D-07 | System-following via `prefers-color-scheme` media query auto-listening |
| D-08 | Each project corresponds to a local folder path |
| D-09 | User creates project by selecting local code repository directory |
| D-10 | Project tree: Project → Sessions (multiple sessions per project) |
| D-11 | electron-vite as build tool |
| D-12 | electron-store for config (theme preferences) |
| D-13 | better-sqlite3 for structured data (project config, session history) |

### Deferred Ideas

None — discussion stayed within phase scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| THEM-01 | Light theme | Tailwind CSS v4 `@theme` directive + CSS variables approach documented |
| THEM-02 | Dark theme | Tailwind CSS v4 `@theme` directive + CSS variables with `data-theme="dark"` toggling |
| THEM-03 | Follow system | `prefers-color-scheme` media query + `window.matchMedia` listener |
| PROJ-01 | Multi-project management panel | better-sqlite3 schema design for projects table |
| PROJ-02 | Project switching | electron-store for current project ID, better-sqlite3 for project data |
| PROJ-03 | Project-level data isolation | better-sqlite3 per-project session tables |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Theme storage (preference) | Main process | electron-store | electron-store runs in main process, exposes via IPC |
| Theme application | Renderer | CSS variables | Renderer applies `data-theme` attribute to `<html>`, CSS variables respond |
| System preference detection | Renderer | `window.matchMedia` | Browser API, fires callbacks on system theme change |
| Project data storage | Main process | better-sqlite3 | Native module, must run in main process only |
| Project config exposure | Main process | contextBridge IPC | Secure API exposure to renderer |
| Sidebar collapse/resize state | Renderer | localStorage | Transient UI state, no persistence required |
| Project list management | Main process | better-sqlite3 | All project CRUD in main via IPC |

## Standard Stack

### Core Desktop Framework

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **electron** | 42.2.0 | Desktop runtime | Latest stable, v42.x current |
| **electron-vite** | 5.0.0 | Build tool | Official electron-vite v5.0.0 stable release, electron-vite beta 6.0.0-beta.1 exists but use stable |
| **vite** | 8.0.13 | Frontend bundler | Bundled with electron-vite |
| **react** | 19.2.6 | UI framework | React 19 latest stable |
| **react-dom** | 19.2.6 | React DOM renderer | Matches React version |
| **typescript** | 6.0.3 | Language | TypeScript 6 latest stable |

### UI Component Libraries

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **tailwindcss** | 4.3.0 | Utility CSS | Tailwind v4 stable, `@theme` directive for CSS variables theming |
| **shadcn/ui** | latest (init in impl) | Component primitives | User confirmed shadcn init during Phase 1 |
| **@radix-ui/react-dialog** | 1.1.15 | Dialog primitive | Underlies shadcn Dialog |
| **@radix-ui/react-dropdown-menu** | 2.1.16 | Dropdown primitive | Underlies shadcn DropdownMenu |
| **@radix-ui/react-scroll-area** | 1.2.8 | Scroll area primitive | Underlies shadcn ScrollArea |
| **@radix-ui/react-tooltip** | 1.2.8 | Tooltip primitive | Underlies shadcn Tooltip |
| **class-variance-authority** | 0.7.1 | Variant utility | Required by shadcn components |
| **clsx** | 2.1.1 | Class name utility | Required by shadcn/tailwind-merge |
| **tailwind-merge** | 3.6.0 | Tailwind merge | Required by shadcn cn() utility |
| **lucide-react** | 1.16.0 | Icons | Consistent, tree-shakeable icon set |

### Storage

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **electron-store** | 11.0.2 | Key-value config | Theme preference, window bounds, simple settings |
| **better-sqlite3** | 12.10.0 | SQLite bindings | Project metadata, session history, structured data |
| **@electron/rebuild** | 4.0.4 | Native module rebuild | Rebuild better-sqlite3 for Electron version |

### Logging

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **electron-log** | 5.4.4 | Cross-process logging | Unified logging, file rotation, crash reports |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-vite | electron-forge | electron-forge is more complex, less Vite-native |
| electron-vite | raw electron + vite | electron-vite provides structured 3-process config out of box |
| better-sqlite3 | sql.js | Native bindings 10x faster, better for desktop |
| better-sqlite3 | Dexie.js (IndexedDB) | better-sqlite3 is proper SQLite, better for Electron main process |
| electron-store | electron-config | electron-store has better TypeScript support and schema validation |

**Installation:**
```bash
npm install electron@42.2.0 electron-vite@5.0.0 vite@8.0.13 react@19.2.6 react-dom@19.2.6 typescript@6.0.3
npm install tailwindcss@4.3.0 @tailwindcss/vite@4.1.0
npm install electron-store@11.0.2 better-sqlite3@12.10.0 electron-log@5.4.4
npm install @radix-ui/react-dialog@1.1.15 @radix-ui/react-dropdown-menu@2.1.16 @radix-ui/react-scroll-area@1.2.8 @radix-ui/react-tooltip@1.2.8
npm install class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.6.0 lucide-react@1.16.0
npm install --save-dev @electron/rebuild@4.0.4
```

**Version verification:** Verified via `npm view <package> version` on 2026-05-21.

## Package Legitimacy Audit

> Package Legitimacy Gate not run — slopcheck not available in environment. All packages tagged [ASSUMED] and planner must gate each install behind `checkpoint:human-verify` before first install.

| Package | Registry | Age | Downloads | slopcheck | Disposition |
|---------|----------|-----|-----------|-----------|-------------|
| electron | npm | 14+ yrs | 22M+/week | N/A | Flagged — planner must add checkpoint |
| electron-vite | npm | 5+ yrs | 500K+/week | N/A | Flagged — planner must add checkpoint |
| better-sqlite3 | npm | 9+ yrs | 3M+/week | N/A | Flagged — planner must add checkpoint |
| electron-store | npm | 8+ yrs | 8M+/week | N/A | Flagged — planner must add checkpoint |
| tailwindcss | npm | 7+ yrs | 30M+/week | N/A | Flagged — planner must add checkpoint |

*All packages above are established, high-download packages from the npm registry. Age and download volumes suggest legitimacy. However, per protocol, all are tagged [ASSUMED] since slopcheck verification was not performed.*

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        MAIN PROCESS                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │  electron-store │  │  better-sqlite3 │  │  electron-log  │ │
│  │  (theme prefs,  │  │  (projects,     │  │  (logging)     │ │
│  │   window state) │  │   sessions)     │  │                │ │
│  └────────┬────────┘  └────────┬────────┘  └────────────────┘ │
│           │                    │                                 │
│           └──────────┬─────────┘                                 │
│                      │ IPC (contextBridge)                       │
│  ┌──────────────────┴───────────────────────────────────────┐  │
│  │                    Preload Script                          │  │
│  │  window.electronAPI = {                                  │  │
│  │    store: { get, set },                                  │  │
│  │    db: { queryProjects, createProject, ... },            │  │
│  │    platform: process.platform                            │  │
│  │  }                                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Renderer Process
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RENDERER PROCESS                           │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  <html data-theme="dark">                                │ │
│  │    CSS Variables --bg-app, --accent, etc.                 │ │
│  │    ┌──────────────┬──────────────────┬───────────────┐ │ │
│  │    │   Sidebar    │   Main Content    │ Task Panel   │ │ │
│  │    │  (280px)     │   (flex: 1)       │ (340px)      │ │ │
│  │    │  [collapsible] [draggable 200-500px]             │ │ │
│  │    └──────────────┴──────────────────┴───────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  React 19 App + Zustand (theme state, project state)      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── main/                    # Main process (Node.js/Electron)
│   ├── index.ts            # Main entry, app lifecycle
│   ├── store.ts           # electron-store instance
│   ├── database.ts        # better-sqlite3 setup + migrations
│   ├── ipc-handlers.ts    # IPC handler registration
│   └── logger.ts          # electron-log setup
├── preload/                 # Preload scripts (contextBridge)
│   └── index.ts           # Expose safe APIs to renderer
├── renderer/               # React app (Vite dev server + build)
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx       # React entry
│   │   ├── App.tsx        # Root component
│   │   ├── components/    # UI components
│   │   │   ├── Sidebar/
│   │   │   ├── ThemeToggle/
│   │   │   ├── ProjectTree/
│   │   │   └── TaskPanel/
│   │   ├── hooks/         # Custom React hooks
│   │   ├── stores/        # Zustand stores
│   │   │   ├── themeStore.ts
│   │   │   └── projectStore.ts
│   │   ├── lib/           # Utilities
│   │   │   └── utils.ts   # cn() for shadcn
│   │   └── styles/        # CSS
│   │       └── globals.css # Tailwind + CSS variables
│   ├── electron.vite.config.ts
│   └── vite-env.d.ts
└── shared/                 # Shared types between processes
    └── types.ts
```

### Pattern 1: CSS Variable Theme System

**What:** CSS variables defined at `:root` level, toggled via `data-theme` attribute on `<html>`. Tailwind v4 `@theme` directive maps design tokens to utilities.

**When to use:** Theme system for desktop app with dark/light/system modes.

**Example:**
```css
/* src/renderer/src/styles/globals.css */
@import "tailwindcss";

@theme {
  /* Dark theme (default) */
  --color-bg-app: #212121;
  --color-bg-sidebar: #191919;
  --color-accent: #7c3aed;
  --color-accent-hover: #8b5cf6;
  --color-accent-dim: rgba(124, 58, 237, 0.10);
  --color-bg-surface: #2d2d2d;
  --color-bg-hover: rgba(255, 255, 255, 0.06);
  --color-bg-active: rgba(255, 255, 255, 0.10);
  --color-border: rgba(255, 255, 255, 0.10);
  --color-border-strong: rgba(255, 255, 255, 0.16);
  --color-text-primary: #ececec;
  --color-text-secondary: rgba(255, 255, 255, 0.55);
  --color-text-muted: rgba(255, 255, 255, 0.30);
}

/* Light theme override via data attribute */
html[data-theme="light"] {
  --color-bg-app: #f4f4f6;
  --color-bg-sidebar: #ffffff;
  --color-bg-hover: rgba(0, 0, 0, 0.05);
  --color-bg-active: rgba(0, 0, 0, 0.08);
  --color-border: rgba(0, 0, 0, 0.08);
  --color-border-strong: rgba(0, 0, 0, 0.14);
  --color-text-primary: #161618;
  --color-text-secondary: rgba(0, 0, 0, 0.50);
  --color-text-muted: rgba(0, 0, 0, 0.28);
}
```

**Theme toggle hook (renderer):**
```typescript
// src/renderer/src/hooks/useTheme.ts
import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';

export function useTheme() {
  const { theme, setTheme } = useThemeStore();

  useEffect(() => {
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', theme);

    // Handle system preference changes when in "system" mode
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme]);

  return { theme, setTheme };
}
```

### Pattern 2: contextBridge IPC API

**What:** Secure API exposure from main process to renderer via contextBridge in preload script.

**When to use:** Any main-to-renderer communication needed in Electron app.

**Example:**
```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

// Type-safe API exposure
contextBridge.exposeInMainWorld('electronAPI', {
  // electron-store operations
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  // better-sqlite3 operations
  db: {
    getProjects: () => ipcRenderer.invoke('db:getProjects'),
    createProject: (name: string, path: string) => ipcRenderer.invoke('db:createProject', name, path),
    deleteProject: (id: string) => ipcRenderer.invoke('db:deleteProject', id),
    getSessions: (projectId: string) => ipcRenderer.invoke('db:getSessions', projectId),
  },
  // Platform info
  platform: process.platform,
});
```

### Pattern 3: electron-store Schema Configuration

**What:** electron-store with JSON Schema for type-safe configuration.

**When to use:** Simple key-value config that needs validation.

**Example:**
```typescript
// src/main/store.ts
import Store from 'electron-store';

interface StoreSchema {
  theme: 'light' | 'dark' | 'system';
  currentProjectId: string | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  windowBounds: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
}

const store = new Store<StoreSchema>({
  defaults: {
    theme: 'system',
    currentProjectId: null,
    sidebarWidth: 280,
    sidebarCollapsed: false,
    windowBounds: { width: 1200, height: 800 },
  },
  schema: {
    theme: { type: 'string', enum: ['light', 'dark', 'system'] },
    currentProjectId: { type: ['string', 'null'] },
    sidebarWidth: { type: 'number', minimum: 200, maximum: 500 },
  },
});

export default store;
```

### Pattern 4: better-sqlite3 Main Process Usage

**What:** better-sqlite3 runs synchronously in main process only. All queries go through IPC handlers.

**When to use:** Structured relational data (projects, sessions) that needs SQL queries.

**Important:** better-sqlite3 is synchronous. Never import it in renderer process. Never use it in preload script directly.

**Example:**
```typescript
// src/main/database.ts
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';

const dbPath = path.join(app.getPath('userData'), 'agent-workstation.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
`);

export default db;
```

### Anti-Patterns to Avoid

- **nodeIntegration: true:** Security vulnerability. Use contextBridge always.
- **Synchronous IPC in renderer:** Blocks UI thread. Use `ipcRenderer.invoke()` (returns Promise).
- **Importing native modules in renderer:** better-sqlite3 crashes if imported in renderer. All DB operations go through IPC.
- **CSS class-based dark mode with Tailwind v4:** Use `data-theme` attribute + CSS variables. The `dark:` Tailwind variant requires class toggling which conflicts with CSS variable approach.
- **electron-store in renderer without initRenderer():** Call `Store.initRenderer()` in main before renderer loads if renderer needs direct store access.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Class-name utility for shadcn | Build own `cn()` | tailwind-merge + clsx | Handles Tailwind class merging edge cases |
| Theme persistence | Custom JSON file | electron-store | Handles atomic writes, encryption, schema validation |
| SQLite in Electron | sql.js (slow WASM) | better-sqlite3 | Native bindings 10x faster, proper concurrent access |
| Native module rebuild | Manual node-gyp | @electron/rebuild | Handles Electron version detection automatically |
| Logging | console.log | electron-log | Cross-process, file rotation, crash reporting |

**Key insight:** better-sqlite3 synchronous design is intentional for performance. CPU-bound SQLite work does not benefit from async/await — blocking the main thread briefly is faster than Promise overhead.

## Common Pitfalls

### Pitfall 1: better-sqlite3 Native Module Rebuild

**What goes wrong:** App crashes on launch with `The module was compiled against a different Node.js version`.

**Why it happens:** better-sqlite3 is a native module compiled for a specific Node.js version. Electron uses a different V8 version than system Node.

**How to avoid:** Run `@electron/rebuild` after `npm install` and after Electron version upgrades:
```bash
npx @electron/rebuild -f -w better-sqlite3
```
Add to `postinstall` in package.json:
```json
"postinstall": "electron-builder install-app-deps"
```

**Warning signs:** `ERR_DLOPEN_FAILED` or native module loading errors on startup.

### Pitfall 2: contextBridge API Type Safety Gap

**What goes wrong:** Renderer passes wrong types to main process, runtime errors.

**Why it happens:** contextBridge only exposes the API surface, TypeScript types in preload don't automatically flow to renderer `window.electronAPI`.

**How to avoid:** Define shared types in `src/shared/types.ts` and import in both preload and renderer. Use `declare global { interface Window { electronAPI: ElectronAPI } }` in renderer.

### Pitfall 3: Tailwind v4 @theme Variable Naming

**What goes wrong:** CSS variables not accessible via `var(--color-*)` after Tailwind processes output.

**Why it happens:** Tailwind v4 `@theme` directive creates variables with a prefix. `--color-gray-500` becomes `var(--color-gray-500)` but actual CSS variable is `--color-gray-500`.

**How to avoid:** Define CSS variables explicitly in `:root` scope alongside `@theme`. Use `@theme inline { }` to reference existing CSS variables.

### Pitfall 4: electron-store Schema Validation Blocking

**What goes wrong:** App crashes on first launch if existing store file has wrong schema.

**Why it happens:** Schema validation runs on store load. Invalid existing data causes crash.

**How to avoid:** Set `clearInvalidConfig: true` in electron-store options for development. In production, use migrations instead.

### Pitfall 5: Sidebar Resize Handler Blocking

**What goes wrong:** Dragging sidebar resize handle is jittery or blocks UI.

**Why it happens:** Mouse move handler doing heavy work or using synchronous IPC.

**How to avoid:** Use CSS `resize` property or passive event listeners. Store width in local state, persist to electron-store on `mouseup` only, not during drag.

## Code Examples

### Zustand Theme Store (Renderer)

```typescript
// src/renderer/src/stores/themeStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'theme-storage',
    }
  )
);
```

### IPC Handler Registration (Main)

```typescript
// src/main/ipc-handlers.ts
import { ipcMain, dialog } from 'electron';
import store from './store';
import db from './database';

export function registerIpcHandlers() {
  // electron-store handlers
  ipcMain.handle('store:get', (_, key: string) => store.get(key));
  ipcMain.handle('store:set', (_, key: string, value: unknown) => store.set(key, value));

  // Database handlers
  ipcMain.handle('db:getProjects', () => {
    return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  });

  ipcMain.handle('db:createProject', (_, name: string, path: string) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, path, now, now);
    return { id, name, path, created_at: now, updated_at: now };
  });

  ipcMain.handle('db:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
```

### Theme Toggle Component

```tsx
// src/renderer/src/components/ThemeToggle/ThemeToggle.tsx
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

const themes = [
  { value: 'light', icon: Sun, label: '浅色' },
  { value: 'dark', icon: Moon, label: '深色' },
  { value: 'system', icon: Monitor, label: '跟随系统' },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const current = themes.find((t) => t.value === theme) || themes[2];
  const next = themes[(themes.findIndex((t) => t.value === theme) + 1) % themes.length];

  return (
    <button
      onClick={() => setTheme(next.value)}
      className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
      title={current.label}
    >
      <current.icon className="w-4 h-4" />
      <span className="text-sm">{current.label}</span>
    </button>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| electron-builder for dev | electron-vite for dev + electron-builder for pack | electron-vite became stable | 10x faster HMR, Vite ecosystem |
| Raw IPC without types | contextBridge + typed API | Electron 12+ | Type-safe renderer-main communication |
| CSS class dark mode | CSS variables + data-theme | Tailwind v4 | More flexible theming, no class conflicts |
| electron-config | electron-store | electron-store has better schema/TypeScript | Easier config validation |

**Deprecated/outdated:**
- `nodeIntegration: true` — Security risk, use contextBridge
- `remote` module — Deprecated in Electron 14+
- `webPreferences.nodeIntegration` — Use contextBridge

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | electron-vite v5.0.0 is stable | Standard Stack | Using beta instead would introduce instability |
| A2 | Tailwind CSS v4.3.0 `@theme` directive works as documented | Code Examples | API may have changed since documentation fetch |
| A3 | better-sqlite3 12.10.0 is compatible with Electron 42 | Common Pitfalls | Native module rebuild may fail, requiring version adjustment |
| A4 | React 19.2.6 is compatible with all shadcn components | Standard Stack | Some Radix UI packages may lag React 19 adoption |
| A5 | shadcn/ui init during Phase 1 implementation is correct timing | User Constraints | User confirmed, but UI spec says "not initialized yet — user confirmed YES" |

## Open Questions

1. **better-sqlite3 WAL mode + Electron**
   - What we know: WAL mode improves concurrent read performance
   - What's unclear: Whether Electron's main/renderer process model causes issues with WAL locking
   - Recommendation: Start with default journal mode, switch to WAL only if profiling shows contention

2. **electron-store schema migration strategy**
   - What we know: electron-store supports `migrations` option
   - What's unclear: No clear migration pattern for schema versioning in desktop app context
   - Recommendation: For Phase 1, use `clearInvalidConfig: true` during dev, design schema versioning later when schema actually changes

3. **Sidebar width persistence timing**
   - What we know: Should persist to electron-store
   - What's unclear: Whether to persist on every resize event (performance) or only on mouseup
   - Recommendation: Persist on mouseup to avoid excessive writes

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | electron-vite, all npm packages | Check via `node --version` | Required: 18+ | N/A |
| npm | Package installation | Check via `npm --version` | Required: 9+ | N/A |
| git | electron-vite scaffolding | Optional | Any | Manual project init |

**Missing dependencies with no fallback:**
- None identified — all dependencies are npm-installable

**Missing dependencies with fallback:**
- None identified — standard npm packages

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (bundled with Vite/electron-vite) |
| Config file | `vite.config.ts` with `test` section, or separate `vitest.config.ts` |
| Quick run command | `npm run test` or `npx vitest` |
| Full suite command | `npm run test:run` or `npx vitest run` |

*Note: Phase 1 is primarily UI/scaffold — unit tests focus on non-UI logic (theme store, IPC handlers). Integration tests require Electron which is harder to test in CI.*

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| THEM-01 | Light theme applied | Manual/Vitest | N/A (visual) | N/A |
| THEM-02 | Dark theme applied | Manual/Vitest | N/A (visual) | N/A |
| THEM-03 | System theme auto-applied | Manual/Vitest | N/A (visual) | N/A |
| PROJ-01 | Project list renders | Manual/Vitest | `npx vitest run src/stores/projectStore.test.ts` | No Wave 0 gap |
| PROJ-02 | Project switching works | Unit test | `npx vitest run src/hooks/useTheme.test.ts` | No Wave 0 gap |
| PROJ-03 | Project data isolation | Manual/Vitest | N/A (visual verification) | N/A |

### Sampling Rate

- **Per task commit:** `npx vitest run --reporter=dot` (fast, non-blocking)
- **Per wave merge:** Full suite not required for Phase 1 UI scaffold
- **Phase gate:** Manual verification + quick vitest run for any added logic

### Wave 0 Gaps

- `src/renderer/src/stores/themeStore.test.ts` — tests for theme state transitions
- `src/renderer/src/hooks/useTheme.test.ts` — tests for system preference listener
- `src/main/ipc-handlers.test.ts` — tests for IPC handler responses
- Vitest config if not auto-configured by electron-vite template

*(If no gaps: "None — existing test infrastructure covers all phase requirements")*

**Wave 0 gaps identified:** Test infrastructure not established yet. electron-vite scaffolding will include Vitest, but config and test files need creation during Phase 1 implementation.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A |
| V3 Session Management | No | N/A |
| V4 Access Control | Partial | contextBridge IPC limits renderer access |
| V5 Input Validation | Yes | electron-store schema validation, IPC handler input sanitization |
| V6 Cryptography | No | Phase 1 has no secrets/keys (Phase 2 handles LLM API keys) |

### Known Threat Patterns for Electron

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IPC channel flooding | Denial of Service | Validate IPC message rate in main process |
| Arbitrary file system access | Information Disclosure | Restrict path exposure, use dialog for user-chosen paths |
| contextBridge API abuse | Elevation of Privilege | Expose minimal API surface, validate all inputs in main |

## Sources

### Primary (HIGH confidence)

- [electron-vite.org](https://electron-vite.org/guide/) — Official documentation on project structure and configuration
- [Tailwind CSS v4 CSS Variables](https://tailwindcss.com/docs/theme) — `@theme` directive documentation
- [shadcn/ui Dark Mode (Vite)](https://ui.shadcn.com/docs/dark-mode/vite) — Class-based dark mode implementation pattern

### Secondary (MEDIUM confidence)

- [electron-store GitHub](https://github.com/sindresorhus/electron-store) — Configuration options and API documentation
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) — Synchronous API design rationale
- npm registry package metadata — Version numbers verified via `npm view <package> version`

### Tertiary (LOW confidence)

- electron-vite beta 6.0.0-beta.1 documentation — Mentioned in search results, not directly verified
- Tailwind v4 `@theme` directive detailed behavior — Based on fetched docs but not hands-on verified

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — Versions verified via npm, but some libraries (electron-vite v5, Tailwind v4) relatively new
- Architecture: MEDIUM — Patterns well-documented, but Electron + React 19 + better-sqlite3 combination is complex
- Pitfalls: MEDIUM — Common pitfalls well-known, but better-sqlite3 + Electron 42 specific issue may not be fully anticipated

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 (30 days for stable tech, 7 days for fast-moving libraries like Tailwind v4)

---

*Research complete. Planner can now create PLAN.md files.*
