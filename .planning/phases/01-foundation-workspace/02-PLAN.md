---
plan: 02
wave: 2
depends_on: [01]
files_modified:
  - src/renderer/src/App.tsx
  - src/renderer/src/main.tsx
  - src/renderer/src/assets/main.css
  - src/renderer/src/components/Sidebar.tsx
  - src/renderer/src/components/SidebarNav.tsx
  - src/renderer/src/components/WorkspaceList.tsx
  - src/renderer/src/components/WelcomeDialog.tsx
  - src/renderer/src/components/ThemeProvider.tsx
  - src/renderer/src/hooks/useTheme.ts
  - src/renderer/src/hooks/useWorkspace.ts
  - src/renderer/src/lib/theme-config.ts
autonomous: false
requirements_addressed: [UI-01, UI-02, UI-03, UI-04, UI-05, WS-02]
---

# Plan 02: Sidebar Layout, Theme System & Welcome Dialog

## Objective

Build the core UI shell: sidebar navigation with Vercel-inspired styling, theme provider with light/dark/system support, and the welcome dialog displayed in the main content area.

---

## Tasks

### Task 2.1: Create ThemeProvider and useTheme hook

<read_first>
- `src/renderer/src/main.tsx` (will be modified — entry point)
- `src/renderer/src/assets/main.css` (will be modified — dark mode CSS)
- `.planning/phases/01-foundation-workspace/01-UI-SPEC.md` (Color section — light/dark mode values)
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-20, D-21, D-22, D-23 — theme decisions)
- `.planning/phases/01-foundation-workspace/01-RESEARCH.md` (Section 6 — theme implementation)
- `src/preload/index.d.ts` (window.electronAPI types — themeGet, themeSet)
</read_first>

<action>
Create the theme system with React context, system preference detection, and Tailwind v4 dark mode class:

1. Create `src/renderer/src/lib/theme-config.ts`:
   ```typescript
   export type Theme = 'light' | 'dark' | 'system'
   export const THEME_STORAGE_KEY = 'pi-workbench-theme'
   ```

2. Create `src/renderer/src/hooks/useTheme.tsx`:
   ```tsx
   import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

   type Theme = 'light' | 'dark' | 'system'

   interface ThemeContextValue {
     theme: Theme
     resolvedTheme: 'light' | 'dark'
     setTheme: (theme: Theme) => void
   }

   const ThemeContext = createContext<ThemeContextValue | null>(null)

   function getSystemTheme(): 'light' | 'dark' {
     if (typeof window === 'undefined') return 'light'
     return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
   }

   export function ThemeProvider({ children }: { children: ReactNode }) {
     const [theme, setThemeState] = useState<Theme>('system')
     const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

     // Load saved theme on mount
     useEffect(() => {
       window.electronAPI.themeGet().then((saved) => {
         const t = saved || 'system'
         setThemeState(t as Theme)
       })
     }, [])

     // Resolve effective theme
     useEffect(() => {
       const effective = theme === 'system' ? getSystemTheme() : theme
       setResolvedTheme(effective)

       // Apply class to html element for Tailwind v4 dark mode
       document.documentElement.classList.toggle('dark', effective === 'dark')

       // Persist theme preference
       window.electronAPI.themeSet(theme)
     }, [theme])

     // Listen for system theme changes
     useEffect(() => {
       const mq = window.matchMedia('(prefers-color-scheme: dark)')
       const handler = () => {
         if (theme === 'system') {
           const sys = getSystemTheme()
           setResolvedTheme(sys)
           document.documentElement.classList.toggle('dark', sys === 'dark')
         }
       }
       mq.addEventListener('change', handler)
       return () => mq.removeEventListener('change', handler)
     }, [theme])

     const setTheme = (t: Theme) => {
       setThemeState(t)
     }

     return (
       <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
         {children}
       </ThemeContext.Provider>
     )
   }

   export function useTheme(): ThemeContextValue {
     const ctx = useContext(ThemeContext)
     if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
     return ctx
   }
   ```

3. Update `src/renderer/src/assets/main.css` to include Tailwind v4 dark mode variant and Vercel CSS custom properties:
   ```css
   @import "tailwindcss";

   @custom-variant dark (&:where(.dark, .dark *));

   @theme {
     --color-canvas: #ffffff;
     --color-canvas-soft: #fafafa;
     --color-canvas-soft-2: #f5f5f5;
     --color-ink: #171717;
     --color-body: #4d4d4d;
     --color-mute: #888888;
     --color-hairline: #ebebeb;
     --color-hairline-strong: #a1a1a1;
     --color-link: #0070f3;
     --color-error: #ee0000;
     --color-error-soft: #f7d4d6;
     --color-warning: #f5a623;
     --color-warning-soft: #ffefcf;
     --color-success: #0070f3;

     --spacing-xs: 4px;
     --spacing-sm: 8px;
     --spacing-md: 16px;
     --spacing-lg: 24px;
     --spacing-xl: 32px;
     --spacing-2xl: 48px;
     --spacing-3xl: 64px;

     --radius-xs: 4px;
     --radius-sm: 6px;
     --radius-md: 8px;
     --radius-lg: 12px;
     --radius-xl: 16px;
     --radius-pill: 100px;
     --radius-full: 9999px;
   }

   /* Vercel stacked shadow utilities */
   .shadow-card {
     box-shadow: 0 0 0 1px #00000014, 0px 1px 1px #00000005;
   }
   .shadow-elevated {
     box-shadow: 0 0 0 1px #00000014, 0px 1px 1px #00000005, 0px 2px 2px #0000000a;
   }
   .shadow-sidebar {
     box-shadow: 0 0 0 1px #00000014, 0px 1px 1px #00000005, 0px 2px 2px #0000000a, 0px 8px 8px -8px #0000000a;
   }
   .shadow-dialog {
     box-shadow: 0 0 0 1px #00000014, 0px 1px 1px #00000005, 0px 8px 16px -4px #0000000a, 0px 24px 32px -8px #0000000f;
   }

   html, body, #root {
     height: 100%;
     margin: 0;
   }

   body {
     font-family: Inter, system-ui, -apple-system, sans-serif;
     -webkit-font-smoothing: antialiased;
   }
   ```

4. Update `src/renderer/src/main.tsx` to wrap with ThemeProvider:
   ```tsx
   import './assets/main.css'
   import React from 'react'
   import ReactDOM from 'react-dom/client'
   import App from './App'
   import { ThemeProvider } from './hooks/useTheme'

   ReactDOM.createRoot(document.getElementById('root')!).render(
     <React.StrictMode>
       <ThemeProvider>
         <App />
       </ThemeProvider>
     </React.StrictMode>
   )
   ```
</action>

<acceptance_criteria>
- `src/renderer/src/hooks/useTheme.tsx` exports `ThemeProvider` and `useTheme`
- `src/renderer/src/lib/theme-config.ts` exports `Theme` type and `THEME_STORAGE_KEY`
- `src/renderer/src/assets/main.css` contains `@custom-variant dark` and all Vercel CSS custom properties
- `src/renderer/src/main.tsx` wraps `<App>` with `<ThemeProvider>`
- `document.documentElement` has `dark` class when dark theme is active
- Theme persists across restart (uses electronAPI.themeGet/Set)
- System theme changes auto-apply when theme is 'system'
</acceptance_criteria>

---

### Task 2.2: Build Sidebar Navigation component

<read_first>
- `src/renderer/src/App.tsx` (will be modified)
- `.planning/phases/01-foundation-workspace/01-UI-SPEC.md` (Component Definitions — Sidebar section, Button Variants, ASCII layout)
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-10, D-11, D-13 — layout decisions)
- `src/renderer/src/hooks/useTheme.tsx` (for theme-aware styling)
- `src/preload/index.d.ts` (electronAPI types)
</read_first>

<action>
Build the sidebar layout component following the Vercel-inspired UI-SPEC:

1. Create `src/renderer/src/components/Sidebar.tsx`:
   ```tsx
   import { useState } from 'react'
   import { Settings, Code2, Puzzle, Plus, MessageSquare } from 'lucide-react'
   import type { ReactNode } from 'react'

   interface NavItemProps {
     icon: ReactNode
     label: string
     active?: boolean
     disabled?: boolean
     comingSoon?: boolean
     onClick?: () => void
   }

   function NavItem({ icon, label, active, disabled, comingSoon, onClick }: NavItemProps) {
     return (
       <button
         onClick={disabled ? undefined : onClick}
         className={`
           flex items-center gap-3 w-full px-3 py-1.5 text-sm rounded-sm transition-colors
           ${disabled
             ? 'text-[#888888] cursor-not-allowed'
             : active
               ? 'bg-[#f5f5f5] text-[#171717] font-medium dark:bg-[#252525] dark:text-white'
               : 'text-[#4d4d4d] hover:bg-[#f5f5f5] dark:text-[#888] dark:hover:bg-[#252525]'
           }
         `}
       >
         <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>
         <span className="flex-1 text-left">{label}</span>
         {comingSoon && (
           <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f5f5f5] text-[#888] dark:bg-[#252525]">
             即将推出
           </span>
         )}
       </button>
     )
   }

   interface SidebarProps {
     activeNav: string
     onNavigate: (page: string) => void
     workspaces: Array<{ path: string; name: string }>
     onAddWorkspace: () => void
     onSwitchWorkspace: (path: string) => void
   }

   export function Sidebar({ activeNav, onNavigate, workspaces, onAddWorkspace, onSwitchWorkspace }: SidebarProps) {
     return (
       <aside className="w-[256px] h-full flex flex-col bg-white dark:bg-[#1a1a1a] border-r border-[#ebebeb] dark:border-[#2a2a2a] shadow-sidebar select-none">
         {/* New Chat Button (placeholder for Phase 2) */}
         <div className="px-3 pt-3 pb-2">
           <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#4d4d4d] hover:bg-[#f5f5f5] dark:hover:bg-[#252525] rounded-[6px] transition-colors">
             <MessageSquare className="w-4 h-4" />
             <span>新对话</span>
           </button>
         </div>

         {/* Navigation Items */}
         <nav className="flex-1 px-3 space-y-0.5">
           <NavItem
             icon={<Code2 className="w-4 h-4" />}
             label="Skills"
             disabled
             comingSoon
           />
           <NavItem
             icon={<Puzzle className="w-4 h-4" />}
             label="MCP"
             disabled
             comingSoon
           />
           <NavItem
             icon={<Settings className="w-4 h-4" />}
             label="设置"
             active={activeNav === 'settings'}
             onClick={() => onNavigate('settings')}
           />

           {/* Divider */}
           <div className="my-2 border-t border-[#ebebeb] dark:border-[#2a2a2a]" />

           {/* Workspace Section */}
           <div className="flex items-center justify-between px-1 py-1">
             <span className="text-xs font-medium text-[#888] uppercase tracking-wide">工作区</span>
             <button
               onClick={onAddWorkspace}
               className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[#f5f5f5] dark:hover:bg-[#252525] text-[#888] transition-colors"
               title="添加工作区"
             >
               <Plus className="w-3.5 h-3.5" />
             </button>
           </div>

           {/* Workspace List */}
           <div className="space-y-0.5">
             {workspaces.length === 0 ? (
               <p className="px-2 py-2 text-xs text-[#888]">尚未添加工作区</p>
             ) : (
               workspaces.map((ws) => (
                 <button
                   key={ws.path}
                   onClick={() => onSwitchWorkspace(ws.path)}
                   className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#4d4d4d] hover:bg-[#f5f5f5] dark:hover:bg-[#252525] rounded-[6px] transition-colors truncate"
                 >
                   <span className="w-1.5 h-1.5 rounded-full bg-[#ebebeb] shrink-0" />
                   {ws.name}
                 </button>
               ))
             )}
           </div>
         </nav>
       </aside>
     )
   }
   ```

2. Update `src/renderer/src/App.tsx` with the sidebar + main content layout:
   ```tsx
   import { useState, useEffect, useCallback } from 'react'
   import { Sidebar } from './components/Sidebar'
   import { WelcomeDialog } from './components/WelcomeDialog'

   function App(): JSX.Element {
     const [activeNav, setActiveNav] = useState('welcome')
     const [workspaces, setWorkspaces] = useState<Array<{ path: string; name: string }>>([])

     // Load workspaces on mount
     useEffect(() => {
       window.electronAPI.workspaceList().then(setWorkspaces)
     }, [])

     const handleNavigate = useCallback((page: string) => {
       setActiveNav(page)
     }, [])

     const handleAddWorkspace = useCallback(async () => {
       const folderPath = await window.electronAPI.selectFolder()
       if (folderPath) {
         const updated = await window.electronAPI.workspaceAdd(folderPath)
         setWorkspaces(updated)
       }
     }, [])

     const handleSwitchWorkspace = useCallback(async (path: string) => {
       await window.electronAPI.workspaceSwitch(path)
     }, [])

     return (
       <div className="flex h-full bg-[#fafafa] dark:bg-[#171717] text-[#171717] dark:text-white">
         <Sidebar
           activeNav={activeNav}
           onNavigate={handleNavigate}
           workspaces={workspaces}
           onAddWorkspace={handleAddWorkspace}
           onSwitchWorkspace={handleSwitchWorkspace}
         />

         <main className="flex-1 flex items-center justify-center">
           {activeNav === 'welcome' && <WelcomeDialog />}
           {activeNav === 'settings' && (
             <div className="p-8 text-[#888]">设置页面（由 Plan 03 实现）</div>
           )}
         </main>
       </div>
     )
   }

   export default App
   ```
</action>

<acceptance_criteria>
- `src/renderer/src/components/Sidebar.tsx` exports `Sidebar` component
- Sidebar is 256px wide with right-edge hairline border
- Sidebar shows nav items: Skills (disabled + "即将推出" badge), MCP (disabled + "即将推出"), 设置 (clickable)
- Workspace section shows empty state "尚未添加工作区" when no workspaces
- Clicking "+" button in workspace section calls `window.electronAPI.selectFolder()`
- Workspace items appear as clickable rows after adding
- `App.tsx` renders sidebar + main content area layout
</acceptance_criteria>

---

### Task 2.3: Build WelcomeDialog component

<read_first>
- `src/renderer/src/App.tsx` (contains usage context)
- `.planning/phases/01-foundation-workspace/01-UI-SPEC.md` (Welcome Dialog section, Copywriting Contract)
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-12 — welcome dialog decisions)
</read_first>

<action>
Create the welcome dialog component centered in the main content area:

Create `src/renderer/src/components/WelcomeDialog.tsx`:
```tsx
export function WelcomeDialog() {
  return (
    <div className="flex flex-col items-center justify-center text-center max-w-md mx-auto px-8 py-12">
      {/* Mesh gradient decorative element */}
      <div className="w-24 h-24 mb-8 rounded-[16px] bg-gradient-to-br from-[#007cf0] via-[#7928ca] via-[#ff0080] to-[#ff4d4d] opacity-80" />

      <h1 className="text-[24px] font-semibold leading-[32px] tracking-[-0.96px] text-[#171717] dark:text-white mb-3">
        我们该做什么？
      </h1>

      <p className="text-[16px] leading-[24px] text-[#4d4d4d] dark:text-[#888]">
        开始与 AI agent 对话
        <br />
        或从左侧选择一个工作区
      </p>

      <div className="mt-8 flex gap-3">
        <button className="px-3 py-1.5 bg-[#171717] text-white text-sm font-medium leading-5 rounded-[100px] hover:opacity-90 transition-opacity">
          开始对话
        </button>
        <button className="px-3 py-1.5 bg-white text-[#171717] text-sm font-medium leading-5 rounded-[100px] border border-[#ebebeb] hover:bg-[#fafafa] transition-colors dark:bg-[#1a1a1a] dark:text-white dark:border-[#2a2a2a]">
          添加工作区
        </button>
      </div>
    </div>
  )
}
```
</action>

<acceptance_criteria>
- `src/renderer/src/components/WelcomeDialog.tsx` exists and exports `WelcomeDialog`
- Component renders centered heading "我们该做什么？" in 24px font-semibold
- Component renders body text "开始与 AI agent 对话 / 或从左侧选择一个工作区"
- Component has a gradient decorative element at top
- Component has two pill buttons: "开始对话" (primary) and "添加工作区" (secondary)
- Dark mode: heading is white, body text is #888, buttons invert correctly
</acceptance_criteria>

---

## Verification Criteria

- [ ] Sidebar renders at 256px width with correct nav items
- [ ] Skills and MCP are disabled with "即将推出" badge
- [ ] Settings nav highlights when active
- [ ] Workspace list shows empty state and updates on add
- [ ] Welcome dialog renders centered with gradient accent
- [ ] Theme toggles light/dark/system correctly
- [ ] Theme preference persists across restart
- [ ] Dark mode applies Tailwind dark: variants correctly

## must_haves

- Sidebar + main content area layout visible (UI-01)
- Sidebar navigation with correct items (UI-02)
- Theme switching works (UI-04)
- Welcome dialog displayed as landing page (D-12)
</acceptance_criteria>