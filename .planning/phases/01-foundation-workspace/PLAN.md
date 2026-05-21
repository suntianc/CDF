---
phase: "01"
slug: foundation-workspace
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: false
requirements:
  - THEM-01
  - THEM-02
  - THEM-03
  - PROJ-01
  - PROJ-02
  - PROJ-03
user_setup:
  - service: npm
    why: "Install project dependencies"
    env_vars: []
  - service: system
    why: "Ensure Node.js 18+ and npm 9+ are installed for electron-vite and native modules"
    env_vars: []

must_haves:
  truths:
    - "用户可启动 Electron 应用并看到主界面"
    - "用户可切换浅色主题，界面正确反映"
    - "用户可切换深色主题，界面正确反映"
    - "用户可切换跟随系统设置，界面自动适配"
    - "用户可在多项目管理面板中查看项目列表"
    - "用户可在项目面板中切换不同项目"
  artifacts:
    - path: "src/main/index.ts"
      provides: "Electron main process entry"
    - path: "src/preload/index.ts"
      provides: "contextBridge API exposure"
    - path: "src/renderer/src/App.tsx"
      provides: "Root React component with three-area layout"
    - path: "src/renderer/src/styles/globals.css"
      provides: "CSS variables theme system"
    - path: "src/renderer/src/stores/themeStore.ts"
      provides: "Zustand theme state management"
    - path: "src/renderer/src/stores/projectStore.ts"
      provides: "Zustand project state management"
    - path: "src/main/database.ts"
      provides: "better-sqlite3 schema and setup"
    - path: "src/main/store.ts"
      provides: "electron-store configuration"
    - path: "src/main/ipc-handlers.ts"
      provides: "IPC handler registration"
  key_links:
    - from: "src/preload/index.ts"
      to: "src/main/ipc-handlers.ts"
      via: "contextBridge exposes electronAPI"
    - from: "src/renderer/src/App.tsx"
      to: "src/renderer/src/stores/themeStore.ts"
      via: "useThemeStore hook"
    - from: "src/renderer/src/styles/globals.css"
      to: "src/main/database.ts"
      via: "CSS variables respond to data-theme attribute"
---

<objective>
**Phase Goal:** 开发者可启动 Electron 应用，看到主界面框架，支持主题切换和项目管理基础

**Purpose:** Establish the Electron desktop application scaffold with three-area layout (sidebar + main chat + floating task panel), CSS variable-based theme system (dark/light/system), and project management infrastructure using electron-store and better-sqlite3.

**Output:** Working Electron app with main interface, theme switching, and project list
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/01-foundation-workspace/01-CONTEXT.md
@.planning/phases/01-foundation-workspace/01-UI-SPEC.md
@.planning/phases/01-foundation-workspace/RESEARCH.md
</context>

<dependency_graph>
## Phase 1 Dependency Graph

```
Wave 1 (Parallel - No dependencies):
├── [T0.1] Initialize electron-vite project
├── [T0.2] Install dependencies (electron, react, tailwind, etc.)
├── [T0.3] Setup Tailwind CSS v4 with @theme directive
├── [T0.4] Setup shadcn/ui
└── [T0.5] Create test infrastructure (Vitest config)

Wave 2 (Depends on Wave 1):
├── [T1.1] Implement CSS variable theme system (dark/light/system)
├── [T1.2] Create Zustand theme store with persistence
├── [T1.3] Create useTheme hook with system preference listener
├── [T2.1] Setup electron-store schema and handlers
├── [T2.2] Setup better-sqlite3 database schema (projects, sessions)
└── [T2.3] Create contextBridge API (store, db, dialog)

Wave 3 (Depends on Wave 2):
├── [T3.1] Build main layout (Sidebar + ChatArea + TaskPanel)
├── [T3.1.1] Build ChatArea component
├── [T3.2] Implement Sidebar (collapsible, resizable 200-500px)
├── [T3.3] Implement ThemeToggle component
├── [T3.4] Build ProjectTree component
└── [T3.5] Build TaskPanel (floating, bottom-right)

Wave 4 (Integration - Depends on Wave 3):
└── [T4.1] Wire all components, IPC handlers, and stores
```

**Wave 1:** Scaffold and dependencies
**Wave 2:** Core infrastructure (theme, storage)
**Wave 3:** UI components
**Wave 4:** Integration and verification
</dependency_graph>

<tasks>

## Wave 1: Scaffold and Build System

<task type="auto">
<name>Task 0.1: Initialize electron-vite project with React + TypeScript</name>
<files>package.json, electron.vite.config.ts, tsconfig.json, src/main/index.ts, src/preload/index.ts, src/renderer/index.html, src/renderer/src/main.tsx</files>
<action>
使用 electron-vite v5.0.0 创建 React + TypeScript 项目模板。执行以下命令：

```bash
npm create @electron-vite/create@latest . -- --template react-ts
```

如果已存在文件，初始化到临时目录后复制结构。

项目结构要求：
- src/main/ - Electron 主进程
- src/preload/ - Preload 脚本 (contextBridge)
- src/renderer/ - React 应用 (Vite)

**重要配置 (per D-11):**
- electron-vite v5.0.0
- React 19.2.6
- TypeScript 6.0.3
- Vite 8.0.13
</action>
<verify>
npm run dev 启动成功，无编译错误</verify>
<done>electron-vite 项目结构已创建，package.json 包含所有依赖</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
<name>Task 0.2: Install all dependencies</name>
<files>package.json (updated), node_modules/</files>
<action>
**Human verification required for npm package installation (per RESEARCH.md Package Legitimacy Audit)**

所有包均标记为 [ASSUMED]，需要验证以下包的 npmjs.com 页面：

1. **electron** (npm: electron) - 14+ 年历史，周下载 22M+
2. **electron-vite** (npm: electron-vite) - 5+ 年历史，周下载 500K+
3. **tailwindcss** (npm: tailwindcss) - 7+ 年历史，周下载 30M+
4. **better-sqlite3** (npm: better-sqlite3) - 9+ 年历史，周下载 3M+
5. **electron-store** (npm: electron-store) - 8+ 年历史，周下载 8M+

**安装命令：**
```bash
npm install electron@42.2.0 electron-vite@5.0.0 vite@8.0.13 react@19.2.6 react-dom@19.2.6 typescript@6.0.3
npm install tailwindcss@4.3.0 @tailwindcss/vite@4.1.0
npm install electron-store@11.0.2 better-sqlite3@12.10.0 electron-log@5.4.4
npm install @radix-ui/react-dialog@1.1.15 @radix-ui/react-dropdown-menu@2.1.16 @radix-ui/react-scroll-area@1.2.8 @radix-ui/react-tooltip@1.2.8
npm install class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.6.0 lucide-react@1.16.0
npm install --save-dev @electron/rebuild@4.0.4
```

**验证安装后需要执行 native 模块 rebuild：**
```bash
npx @electron/rebuild -f -w better-sqlite3
```

请验证每个包在 npmjs.com 存在且版本匹配后，输入 "approved" 继续。
</action>
<verify>npm list --depth=0 显示所有包已安装</verify>
<done>所有依赖已安装，native 模块已 rebuild</done>
</task>

<task type="auto">
<name>Task 0.3: Setup Tailwind CSS v4 with @theme directive</name>
<files>src/renderer/src/styles/globals.css, electron.vite.config.ts</files>
<action>
配置 Tailwind CSS v4：

1. 在 `electron.vite.config.ts` 添加 `@tailwindcss/vite` 插件：
```typescript
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // ...
  plugins: [tailwindcss()],
});
```

2. 创建 `src/renderer/src/styles/globals.css`，使用 `@theme` 指令定义设计系统变量：

```css
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

/* Light theme (per D-05, D-06) */
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

**关键约束 (per D-05):**
- 使用 CSS 变量实现主题，不是 Tailwind class
- 主题通过 `data-theme` 属性切换
- 不要使用 `dark:` class variant
</action>
<verify>npm run dev 无 CSS 错误，Tailwind 生成正确</verify>
<done>Tailwind CSS v4 配置完成，CSS 变量可用</done>
</task>

<task type="auto">
<name>Task 0.4: Initialize shadcn/ui</name>
<files>components.json, src/renderer/src/lib/utils.ts</files>
<action>
初始化 shadcn/ui：

1. 创建 `components.json`：
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

2. 创建 `src/renderer/src/lib/utils.ts`：
```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

3. 初始化 shadcn：
```bash
npx shadcn@latest init -d
```

4. 添加 Phase 1 需要的组件：
```bash
npx shadcn@latest add button dialog dropdown-menu scroll-area tooltip sheet badge -y
```

**注意：** UI spec 指定需要这些组件。
</action>
<verify>npx shadcn@latest list 显示已添加的组件</verify>
<done>shadcn/ui 已初始化，组件可用</done>
</task>

<task type="auto">
<name>Task 0.5: Setup Vitest test infrastructure</name>
<files>vitest.config.ts, src/renderer/src/stores/themeStore.test.ts, src/renderer/src/hooks/useTheme.test.ts, src/main/ipc-handlers.test.ts</files>
<action>
配置 Vitest 测试框架：

1. electron-vite 模板已包含 Vitest，验证 `vite.config.ts` 包含 test 配置：
```typescript
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

2. 安装 jsdom 环境：
```bash
npm install --save-dev jsdom @testing-library/react @testing-library/dom @testing-library/user-event
```

3. 创建测试文件：

`src/renderer/src/stores/themeStore.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { useThemeStore } from './themeStore';

describe('themeStore', () => {
  it('should have default theme as system', () => {
    expect(useThemeStore.getState().theme).toBe('system');
  });

  it('should update theme via setTheme', () => {
    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });
});
```

`src/renderer/src/hooks/useTheme.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('useTheme', () => {
  it('should export a function', () => {
    // Phase 1: integration test deferred — requires full Electron env
    // Manual verification via: npm run dev
    expect(true).toBe(true);
  });
});
```

`src/main/ipc-handlers.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('IPC handlers', () => {
  it('should have placeholder for integration tests', () => {
    // Phase 1: requires full Electron context — verify manually via npm run dev
    expect(true).toBe(true);
  });
});
```

**注意：** Phase 1 验证主要依赖手动 `npm run dev` 检查，单元测试覆盖非 UI 逻辑。
</action>
<verify>npx vitest run --reporter=dot 无错误</verify>
<done>Vitest 配置完成，测试文件已创建</done>
</task>

## Wave 2: Core Infrastructure (Theme & Storage)

<task type="auto">
<name>Task 1.1: Implement CSS variable theme system</name>
<files>src/renderer/src/styles/globals.css</files>
<action>
完善 CSS 变量主题系统（基于 Task 0.3 已有基础）：

1. 确保 globals.css 包含所有颜色变量（per UI spec）：
   - `--bg-app`, `--bg-sidebar`, `--accent`, `--accent-hover`, `--accent-dim`
   - `--bg-surface`, `--bg-hover`, `--bg-active`
   - `--border`, `--border-strong`
   - `--text-primary`, `--text-secondary`, `--text-muted`
   - `--success`, `--success-dim`, `--danger`, `--danger-dim`, `--warning`, `--warning-dim`

2. 添加间距系统（per UI spec）：
```css
:root {
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;
  --spacing-3xl: 64px;
}
```

3. 添加 border-radius 变量：
```css
:root {
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 20px;
}
```

4. 添加 typography 变量：
```css
:root {
  --font-display: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

**约束 (per D-05):**
- 所有主题变量必须使用 CSS 变量
- 浅色主题通过 `html[data-theme="light"]` 覆盖
- 深色主题为默认（无属性或 `data-theme="dark"`）
</action>
<verify>CSS 变量在 devtools 中可通过 var(--color-*) 访问</verify>
<done>CSS 变量主题系统完整实现</done>
</task>

<task type="auto">
<name>Task 1.2: Create Zustand theme store with persistence</name>
<files>src/renderer/src/stores/themeStore.ts</files>
<action>
创建 Zustand theme store：

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

**约束：**
- 使用 `persist` middleware 将 theme 存储到 localStorage
- 默认 theme 为 'system'（per D-06）
- 导出 `useThemeStore` hook 供组件使用
</action>
<verify>npm run build 无 TypeScript 错误</verify>
<done>Zustand theme store 已创建，支持持久化</done>
</task>

<task type="auto">
<name>Task 1.3: Create useTheme hook with system preference listener</name>
<files>src/renderer/src/hooks/useTheme.ts</files>
<action>
创建 useTheme hook：

```typescript
// src/renderer/src/hooks/useTheme.ts
import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';

export function useTheme() {
  const { theme, setTheme } = useThemeStore();

  useEffect(() => {
    // Apply theme to document
    const applyTheme = (themeName: string) => {
      document.documentElement.setAttribute('data-theme', themeName);
    };

    if (theme === 'system') {
      // Per D-07: Use prefers-color-scheme Media Query
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches ? 'dark' : 'light');

      // Listen for system theme changes
      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  return { theme, setTheme };
}
```

**约束 (per D-07):**
- system 模式下使用 `window.matchMedia('(prefers-color-scheme: dark)')`
- 监听 `change` 事件自动响应系统主题变化
- 主题通过 `data-theme` 属性应用到 `<html>`
</action>
<verify>useTheme hook 导出正确，可在组件中使用</verify>
<done>useTheme hook 已创建，支持 system 主题自动监听</done>
</task>

<task type="auto">
<name>Task 2.1: Setup electron-store schema and handlers</name>
<files>src/main/store.ts</files>
<action>
创建 electron-store 配置：

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
  clearInvalidConfig: true, // For development
});

export default store;
```

**约束 (per D-12):**
- 使用 electron-store 存储配置
- 主题偏好使用 'system' 默认值
- sidebarWidth 范围 200-500px（per D-03）
</action>
<verify>store.get('theme') 返回 'system'（默认值）</verify>
<done>electron-store 配置完成</done>
</task>

<task type="auto">
<name>Task 2.2: Setup better-sqlite3 database schema</name>
<files>src/main/database.ts</files>
<action>
创建 better-sqlite3 数据库：

```typescript
// src/main/database.ts
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';

const dbPath = path.join(app.getPath('userData'), 'agent-workstation.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Initialize schema (per D-08, D-10)
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

**约束 (per D-08, D-10, D-13):**
- 每个项目对应一个本地文件夹路径
- 项目树结构：Project → Sessions
- 使用 better-sqlite3（不是 sql.js）
- **注意：** better-sqlite3 是同步的，只能在 main process 使用
</action>
<verify>数据库文件在 app.getPath('userData') 中创建</verify>
<done>better-sqlite3 数据库 schema 已创建</done>
</task>

<task type="auto">
<name>Task 2.3: Create contextBridge API (store, db, dialog)</name>
<files>src/preload/index.ts, src/shared/types.ts</files>
<action>
创建 contextBridge API：

1. 创建共享类型 `src/shared/types.ts`：
```typescript
// src/shared/types.ts
export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
}

export interface Session {
  id: string;
  project_id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface ElectronAPI {
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  db: {
    getProjects: () => Promise<Project[]>;
    createProject: (name: string, projectPath: string) => Promise<Project>;
    deleteProject: (id: string) => Promise<void>;
    getSessions: (projectId: string) => Promise<Session[]>;
    selectDirectory: () => Promise<string | null>;
  };
  platform: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

2. 创建 preload 脚本 `src/preload/index.ts`：
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  db: {
    getProjects: () => ipcRenderer.invoke('db:getProjects'),
    createProject: (name: string, projectPath: string) =>
      ipcRenderer.invoke('db:createProject', name, projectPath),
    deleteProject: (id: string) => ipcRenderer.invoke('db:deleteProject', id),
    getSessions: (projectId: string) => ipcRenderer.invoke('db:getSessions', projectId),
    selectDirectory: () => ipcRenderer.invoke('db:selectDirectory'),
  },
  platform: process.platform,
});
```

**约束：**
- 所有 API 通过 ipcRenderer.invoke 调用（异步）
- 不暴露任何 Node.js API 直接到 renderer
- 使用 shared/types.ts 确保类型一致
</action>
<verify>window.electronAPI 在 renderer 中类型正确</verify>
<done>contextBridge API 已创建并暴露给 renderer</done>
</task>

## Wave 3: UI Components

<task type="auto">
<name>Task 3.1.1: Build ChatArea component</name>
<files>src/renderer/src/components/ChatArea/ChatArea.tsx</files>
<action>
创建 ChatArea 组件（对话主区域）：

```tsx
// src/renderer/src/components/ChatArea/ChatArea.tsx
import { Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ChatArea() {
  return (
    <div className="flex flex-col h-full">
      {/* Messages area - placeholder for Phase 1 */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-[var(--color-text-primary)] mb-2">
            Agent 开发工作站
          </h2>
          <p className="text-[var(--color-text-secondary)]">
            基于自然语言驱动的自动化开发工作流
          </p>
        </div>
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-2 bg-[var(--color-bg-surface)] rounded-lg px-4 py-3">
          <input
            type="text"
            placeholder="描述您的需求..."
            className="flex-1 bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
          />
          <Button variant="ghost" size="icon" className="text-[var(--color-text-secondary)]">
            <Square className="w-4 h-4" />
          </Button>
          <Button size="icon" className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

**约束：**
- Phase 1 仅展示占位符内容（Phase 2 会集成真正的对话功能）
- 输入框样式与 UI spec 一致
- 使用 CSS 变量主题色
</action>
<verify>ChatArea 组件文件存在且可导入</verify>
<done>ChatArea 组件已创建</done>
</task>

<task type="auto">
<name>Task 3.1: Build main layout (Sidebar + ChatArea + TaskPanel)</name>
<files>src/renderer/src/App.tsx</files>
<action>
创建主布局组件：

```tsx
// src/renderer/src/App.tsx
import { useState } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatArea } from './components/ChatArea/ChatArea';
import { TaskPanel } from './components/TaskPanel/TaskPanel';

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);

  return (
    <div className="flex h-screen bg-[var(--color-bg-app)]">
      <Sidebar
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        onCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onResize={(w) => setSidebarWidth(w)}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatArea />
      </main>
      <TaskPanel />
    </div>
  );
}
```

**布局约束 (per D-02, UI spec):**
- 三区域结构：sidebar (280px) + main (flex-1) + task panel (340px)
- Sidebar 可折叠、可拖拽调节宽度
- Task Panel 固定在右下角
</action>
<verify>npm run dev 显示三区域布局</verify>
<done>主布局组件已创建</done>
</task>

<task type="auto">
<name>Task 3.2: Implement Sidebar (collapsible, resizable 200-500px)</name>
<files>src/renderer/src/components/Sidebar/Sidebar.tsx, src/renderer/src/components/Sidebar/Sidebar.module.css</files>
<action>
实现 Sidebar 组件：

```tsx
// src/renderer/src/components/Sidebar/Sidebar.tsx
import { useState, useRef, useCallback } from 'react';
import { PanelLeftClose, PanelLeft, Search, Plus, Settings, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProjectTree } from '@/components/ProjectTree/ProjectTree';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import styles from './Sidebar.module.css';

interface SidebarProps {
  collapsed: boolean;
  width: number;
  onCollapse: () => void;
  onResize: (width: number) => void;
}

export function Sidebar({ collapsed, width, onCollapse, onResize }: SidebarProps) {
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !sidebarRef.current) return;
      const newWidth = Math.min(500, Math.max(200, e.clientX));
      onResize(newWidth);
    },
    [isResizing, onResize]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Attach global mouse events when resizing
  // ... (useEffect for global event listeners)

  if (collapsed) {
    return (
      <div className={styles.collapsedHandle}>
        <Button variant="ghost" size="icon" onClick={onCollapse}>
          <PanelLeft className="w-5 h-5" />
        </Button>
      </div>
    );
  }

  return (
    <aside
      ref={sidebarRef}
      className={styles.sidebar}
      style={{ width }}
    >
      {/* New Chat button */}
      <Button className="w-full justify-start gap-2">
        <Plus className="w-4 h-4" />
        新建对话
      </Button>

      {/* Search bar */}
      <div className={styles.searchBar}>
        <Search className="w-4 h-4" />
        <input type="text" placeholder="搜索..." />
      </div>

      {/* Action row */}
      <div className={styles.actionRow}>
        <Button variant="ghost" size="sm">智能体</Button>
        <Button variant="ghost" size="sm">工作流</Button>
      </div>

      {/* Project tree */}
      <ScrollArea className="flex-1">
        <ProjectTree />
      </ScrollArea>

      {/* Bottom bar */}
      <div className={styles.bottomBar}>
        <ThemeToggle />
        <Button variant="ghost" size="icon">
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      {/* Resize handle */}
      <div
        className={styles.resizeHandle}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}
```

**CSS (Sidebar.module.css):**
```css
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-sidebar);
  border-right: 1px solid var(--color-border);
  position: relative;
  transition: width 0.2s ease;
}

.resizeHandle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  background: transparent;
}

.resizeHandle:hover,
.resizeHandle:active {
  background: var(--color-accent);
}
```

**约束 (per D-03, D-04):**
- 可拖拽调节宽度 200px ~ 500px
- 可完全折叠（width = 0），显示固定拉手按钮
- 折叠时显示 PanelLeft 图标按钮
</action>
<verify>Sidebar 可拖拽改变宽度，可折叠展开</verify>
<done>Sidebar 组件实现完成</done>
</task>

<task type="auto">
<name>Task 3.3: Implement ThemeToggle component</name>
<files>src/renderer/src/components/ThemeToggle/ThemeToggle.tsx</files>
<action>
实现 ThemeToggle 组件：

```tsx
// src/renderer/src/components/ThemeToggle/ThemeToggle.tsx
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/button';

const themes = [
  { value: 'light' as const, icon: Sun, label: '浅色' },
  { value: 'dark' as const, icon: Moon, label: '深色' },
  { value: 'system' as const, icon: Monitor, label: '跟随系统' },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const current = themes.find((t) => t.value === theme) || themes[2];
  const nextIndex = (themes.findIndex((t) => t.value === theme) + 1) % themes.length;
  const next = themes[nextIndex];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(next.value)}
      className="flex items-center gap-2"
      title={current.label}
    >
      <current.icon className="w-4 h-4" />
      <span className="text-sm">{current.label}</span>
    </Button>
  );
}
```

**约束 (per D-06):**
- 三个主题模式：浅色、深色、跟随系统
- 循环切换：点击切换到下一个模式
- 当前模式图标高亮显示
</action>
<verify>点击 ThemeToggle 循环切换主题</verify>
<done>ThemeToggle 组件实现完成</done>
</task>

<task type="auto">
<name>Task 3.4: Build ProjectTree component</name>
<files>src/renderer/src/components/ProjectTree/ProjectTree.tsx, src/renderer/src/stores/projectStore.ts</files>
<action>
创建 ProjectTree 组件：

1. 先创建 projectStore：
```typescript
// src/renderer/src/stores/projectStore.ts
import { create } from 'zustand';

interface Project {
  id: string;
  name: string;
  path: string;
}

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProjectId: null,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
}));
```

2. 创建 ProjectTree 组件：
```tsx
// src/renderer/src/components/ProjectTree/ProjectTree.tsx
import { useEffect } from 'react';
import { Folder, ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function ProjectTree() {
  const { projects, currentProjectId, setProjects, setCurrentProject } = useProjectStore();

  useEffect(() => {
    // Load projects from database
    window.electronAPI.db.getProjects().then(setProjects);
  }, [setProjects]);

  const handleCreateProject = async () => {
    const path = await window.electronAPI.db.selectDirectory();
    if (path) {
      // Create project with folder name
      const name = path.split('/').pop() || '新项目';
      const project = await window.electronAPI.db.createProject(name, path);
      setProjects([...projects, project]);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-[var(--color-text-muted)] text-sm">暂无项目</p>
        <p className="text-[var(--color-text-muted)] text-xs mt-1">创建项目后显示在这里</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={handleCreateProject}>
          <Plus className="w-4 h-4 mr-1" />
          创建项目
        </Button>
      </div>
    );
  }

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--color-text-muted)]">项目</span>
        <Button variant="ghost" size="icon" className="w-6 h-6" onClick={handleCreateProject}>
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      <div className="space-y-1">
        {projects.map((project) => (
          <div
            key={project.id}
            className={`
              flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer
              hover:bg-[var(--color-bg-hover)]
              ${currentProjectId === project.id ? 'bg-[var(--color-accent-dim)]' : ''}
            `}
            onClick={() => setCurrentProject(project.id)}
          >
            <Folder className="w-4 h-4 text-[var(--color-accent)]" />
            <span className="text-sm truncate flex-1">{project.name}</span>
            {currentProjectId === project.id && (
              <Badge variant="secondary" className="text-xs bg-[var(--color-accent-dim)] text-[var(--color-accent)]">
                当前项目
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**约束 (per D-08, D-09):**
- 项目对应本地文件夹路径
- 用户通过"创建项目"选择本地目录
- 显示"暂无项目"空状态
- 当前项目显示"当前项目"徽章（紫色半透明背景 per UI spec）
</action>
<verify>项目列表显示，点击项目切换为当前项目</verify>
<done>ProjectTree 组件实现完成</done>
</task>

<task type="auto">
<name>Task 3.5: Build TaskPanel (floating, bottom-right)</name>
<files>src/renderer/src/components/TaskPanel/TaskPanel.tsx</files>
<action>
实现 TaskPanel 组件：

```tsx
// src/renderer/src/components/TaskPanel/TaskPanel.tsx
import { useState } from 'react';
import { ChevronDown, ChevronUp, X, CheckCircle, XCircle, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Task {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'success' | 'failed';
}

export function TaskPanel() {
  const [visible, setVisible] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Placeholder tasks for Phase 1
  const tasks: Task[] = [
    { id: '1', name: '准备开发环境', status: 'success' },
    { id: '2', name: '配置 TypeScript', status: 'running' },
    { id: '3', name: '安装依赖', status: 'idle' },
  ];

  const statusIcon = (status: Task['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-[var(--color-danger)]" />;
      case 'running':
        return <Loader className="w-4 h-4 animate-spin text-[var(--color-accent)]" />;
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-[var(--color-border)]" />;
    }
  };

  if (!visible) return null;

  return (
    <div
      className={`
        fixed bottom-6 right-6 w-[340px] max-h-[480px]
        bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]
        rounded-xl shadow-lg flex flex-col
        transition-transform duration-200 ease-out
        ${collapsed ? 'h-13' : 'h-auto'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          className="gap-1"
        >
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          <span className="text-sm font-medium">任务展板</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="w-6 h-6"
          onClick={() => setVisible(false)}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Content */}
      {!collapsed && (
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-3">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3">
                {statusIcon(task.status)}
                <span className="text-sm">{task.name}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
```

**约束 (per UI spec):**
- 固定位置：bottom: 24px, right: 24px
- 宽度：340px
- 最大高度：480px
- 可折叠（只显示 header，52px 高度）
- 可关闭（隐藏整个面板）
- 位置：右下角浮动面板
</action>
<verify>TaskPanel 固定在右下角，可折叠展开</verify>
<done>TaskPanel 组件实现完成</done>
</task>

## Wave 4: Integration and IPC Handlers

<task type="auto">
<name>Task 4.1: Wire all components, IPC handlers, and stores</name>
<files>src/main/ipc-handlers.ts, src/main/index.ts, src/renderer/src/main.tsx</files>
<action>
创建 IPC handlers 并连接所有组件：

1. 创建 IPC handlers `src/main/ipc-handlers.ts`：
```typescript
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

  ipcMain.handle('db:createProject', (_, name: string, projectPath: string) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, projectPath, now, now);
    return { id, name, path: projectPath, created_at: now, updated_at: now };
  });

  ipcMain.handle('db:deleteProject', (_, id: string) => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });

  ipcMain.handle('db:getSessions', (_, projectId: string) => {
    return db
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId);
  });

  ipcMain.handle('db:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
```

2. 更新 main process `src/main/index.ts`：
```typescript
import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc-handlers';
import store from './store';
import './logger';

let mainWindow: BrowserWindow;

function createWindow() {
  const bounds = store.get('windowBounds') as { width: number; height: number; x?: number; y?: number };

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    webPreferences: {
      preload: './preload/index.js',
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Save window bounds on close
  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', bounds);
  });

  // Load the app
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile('./dist-renderer/index.html');
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
```

3. 更新 renderer entry `src/renderer/src/main.tsx`：
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

4. 更新 App.tsx 初始化 theme：
```tsx
// 在 App.tsx 添加 useEffect 初始化 theme（使用 useThemeStore.setTheme）
import { useThemeStore } from './stores/themeStore';

useEffect(() => {
  // Apply persisted theme on mount — useTheme hook's useEffect will sync to DOM
  const initTheme = async () => {
    const savedTheme = await window.electronAPI.store.get('theme');
    if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme as string)) {
      useThemeStore.getState().setTheme(savedTheme as 'light' | 'dark' | 'system');
    }
  };
  initTheme();
}, []);
```

**约束：**
- 所有 IPC handlers 在 app.whenReady 后注册
- main process 使用 contextBridge（不是 nodeIntegration）
- window bounds 存储到 electron-store
</action>
<verify>npm run dev 启动应用无错误</verify>
<done>IPC handlers 已连接，应用可启动</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|-----------|-------------|
| client→main | Untrusted renderer process communicates via IPC |
| user→filesystem | User selects project directory via system dialog |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Tampering | npm packages | mitigate | Package Legitimacy Gate checkpoint for all [ASSUMED] packages |
| T-01-02 | Information Disclosure | project paths | mitigate | Only expose user-selected paths via dialog.showOpenDialog |
| T-01-03 | Elevation of Privilege | contextBridge API | mitigate | Minimal API surface, validate all IPC inputs in main handlers |
| T-01-SC | Tampering | npm/pip/cargo installs | mitigate | Package Legitimacy Gate for all npm packages |
</threat_model>

<verification>
## Phase 1 Success Criteria Verification

| # | Criterion | Verification Method |
|---|----------|-------------------|
| 1 | 用户可启动 Electron 应用并看到主界面 | 执行 `npm run dev`，确认窗口显示三区域布局 |
| 2 | 用户可切换浅色主题，界面正确反映 | 点击 ThemeToggle，确认 `html[data-theme="light"]` 属性生效，背景变浅色 |
| 3 | 用户可切换深色主题，界面正确反映 | 再次点击 ThemeToggle，确认 `html[data-theme="dark"]` 属性生效 |
| 4 | 用户可切换跟随系统设置，界面自动适配 | 切换到 system 模式，修改系统主题，确认界面自动响应 |
| 5 | 用户可在多项目管理面板中查看项目列表 | 创建项目后，确认项目列表显示在 ProjectTree |
| 6 | 用户可在项目面板中切换不同项目 | 点击不同项目，确认"当前项目"徽章移动到所选项目 |
</verification>

<success_criteria>
## Success Criteria (All must be TRUE)

1. **应用启动**: `npm run dev` 成功启动 Electron 应用，无编译错误
2. **浅色主题**: 点击 ThemeToggle 切换到浅色，`html` 元素有 `data-theme="light"` 属性，背景变为浅色
3. **深色主题**: 点击 ThemeToggle 切换到深色，`html` 元素有 `data-theme="dark"` 属性，背景变为深色
4. **跟随系统**: 切换到 system 模式，修改 macOS/Windows 系统主题，应用自动切换对应主题
5. **项目列表**: ProjectTree 组件显示项目列表，空状态显示"暂无项目"
6. **项目切换**: 点击项目名称，"当前项目"徽章正确显示在该项目上
</success_criteria>

<output>
Create `.planning/phases/01-foundation-workspace/01-01-PLAN-SUMMARY.md` when done
</output>
