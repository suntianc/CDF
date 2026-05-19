---
plan: 01
wave: 1
depends_on: []
files_modified:
  - package.json
  - electron.vite.config.ts
  - tsconfig.json
  - tsconfig.node.json
  - tsconfig.web.json
  - vite.config.ts
  - src/main/index.ts
  - src/preload/index.ts
  - src/renderer/src/main.tsx
  - src/renderer/src/App.tsx
  - src/renderer/src/assets/main.css
  - src/renderer/src/env.d.ts
  - src/renderer/src/lib/utils.ts
  - src/main/store.ts
  - src/main/ipc.ts
  - src/preload/index.d.ts
autonomous: false
requirements_addressed: [UI-01, UI-05, PROV-04]
---

# Plan 01: Project Scaffolding, IPC Infrastructure & Window Shell

## Objective

Scaffold the Electron + React + TypeScript project from zero, establish the IPC communication layer between main/renderer processes, and implement the basic BrowserWindow shell with window state persistence.

---

## Tasks

### Task 1.1: Scaffold electron-vite project with Tailwind and shadcn/ui

<read_first>
- `.planning/phases/01-foundation-workspace/01-RESEARCH.md` (Sections 1, 7 — scaffold steps, gotchas)
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-01, D-02 — component library decisions)
</read_first>

<action>
Create the project using the electron-vite quick-start template, then install and configure all dependencies:

1. Run: `npm create @quick-start/electron@latest pi-workbench -- --template react-ts` in the project root
2. Run: `cd pi-workbench && npm install`
3. Install Tailwind v4: `npm install -D tailwindcss @tailwindcss/vite`
4. Configure `electron.vite.config.ts`:
   - Add `@tailwindcss/vite` plugin to renderer plugins
   - Add `@` alias: `resolve: { alias: { '@': resolve('src/renderer/src') } }`
   ```typescript
   // electron.vite.config.ts
   import { resolve } from 'path'
   import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
   import react from '@vitejs/plugin-react'
   import tailwindcss from '@tailwindcss/vite'

   export default defineConfig({
     main: { plugins: [externalizeDepsPlugin()] },
     preload: { plugins: [externalizeDepsPlugin()] },
     renderer: {
       resolve: { alias: { '@': resolve('src/renderer/src') } },
       plugins: [react(), tailwindcss()]
     }
   })
   ```
5. Add `@import "tailwindcss";` at the top of `src/renderer/src/assets/main.css`
6. Verify Tailwind works — add `className="text-3xl font-bold text-emerald-600"` to App.tsx render, run `npm run dev`, confirm green text
7. Create `vite.config.ts` (duplicate renderer part from electron.vite.config.ts for shadcn CLI detection)
8. Configure `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json` with `@/*` -> `src/renderer/src/*` path alias
9. Run: `npx shadcn@latest init -y --defaults`
10. Fix `components.json` aliases:
    ```json
    "aliases": {
      "components": "@/components",
      "utils": "@/lib/utils",
      "ui": "@/components/ui",
      "lib": "@/lib",
      "hooks": "@/hooks"
    }
    ```
11. Install initial shadcn components: `npx shadcn@latest add button card dialog input badge separator sheet tabs tooltip -y`
12. Verify: `npx shadcn@latest info` exits with no errors
13. Create `src/renderer/src/lib/utils.ts` if not auto-generated:
    ```typescript
    import { type ClassValue, clsx } from 'clsx'
    import { twMerge } from 'tailwind-merge'

    export function cn(...inputs: ClassValue[]) {
      return twMerge(clsx(inputs))
    }
    ```
</action>

<acceptance_criteria>
- `package.json` exists with electron, react, tailwindcss as dependencies
- `electron.vite.config.ts` contains `tailwindcss()` in renderer plugins array
- `src/renderer/src/assets/main.css` starts with `@import "tailwindcss"`
- `tsconfig.json` has path alias `"@/*": ["./src/renderer/src/*"]`
- `components.json` exists with valid aliases
- `src/renderer/src/lib/utils.ts` exists and exports `cn()` function
- `src/renderer/src/components/ui/button.tsx` exists (shadcn button component installed)
- `npm run dev` starts without compilation errors
</acceptance_criteria>

---

### Task 1.2: Implement electron-store persistence layer in main process

<read_first>
- `src/main/index.ts` (will be modified)
- `.planning/phases/01-foundation-workspace/01-RESEARCH.md` (Section 2 — electron-store API, Section 5 — window state)
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` (D-03, D-04, D-05 — persistence decisions)
</read_first>

<action>
Create the data persistence layer using electron-store in the main process:

1. Install: `npm install electron-store`
2. Create `src/main/store.ts`:
   ```typescript
   import Store from 'electron-store'

   interface StoreSchema {
     workspaces: Array<{
       path: string
       name: string
       lastOpened: string
     }>
     providers: Array<{
       id: string
       type: 'anthropic' | 'openai' | 'google' | 'custom'
       name: string
       apiKey: string
       baseUrl?: string
       models: string[]
       defaultModel?: string
     }>
     theme: 'light' | 'dark' | 'system'
     windowState: {
       x?: number
       y?: number
       width: number
       height: number
       maximized: boolean
     }
   }

   const store = new Store<StoreSchema>({
     defaults: {
       workspaces: [],
       providers: [],
       theme: 'system',
       windowState: { width: 1200, height: 800, maximized: false }
     },
     encryptionKey: 'pi-workbench-store-encryption-key',
     encryptionAlgorithm: 'aes-256-gcm'
   })

   export default store
   ```
3. Ensure `"type": "module"` in `package.json` (required by electron-store v11 ESM)
</action>

<acceptance_criteria>
- `src/main/store.ts` exists
- `src/main/store.ts` exports a `Store` instance with defaults for workspaces, providers, theme, windowState
- `store.ts` uses `encryptionKey` and `encryptionAlgorithm: 'aes-256-gcm'` options
- `package.json` contains `"type": "module"`
- Store can be imported in main process without errors
</acceptance_criteria>

---

### Task 1.3: Set up IPC communication bridge

<read_first>
- `src/main/store.ts` (created in Task 1.2)
- `src/main/index.ts` (will be modified)
- `src/preload/index.ts` (will be modified)
- `.planning/phases/01-foundation-workspace/01-RESEARCH.md` (Section 3 — IPC architecture)
</read_first>

<action>
Establish the IPC infrastructure between main and renderer processes:

1. Create `src/main/ipc.ts` with IPC handlers:
   ```typescript
   import { ipcMain, dialog } from 'electron'
   import store from './store'

   export function registerIpcHandlers(): void {
     // Store operations
     ipcMain.handle('store:get', (_event, key: string) => {
       return store.get(key)
     })
     ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
       store.set(key, value)
       return true
     })
     ipcMain.handle('store:delete', (_event, key: string) => {
       store.delete(key)
       return true
     })

     // Folder dialog
     ipcMain.handle('dialog:selectFolder', async () => {
       const result = await dialog.showOpenDialog({
         properties: ['openDirectory']
       })
       return result.canceled ? null : result.filePaths[0]
     })

     // Workspace operations
     ipcMain.handle('workspace:list', () => {
       return store.get('workspaces', [])
     })
     ipcMain.handle('workspace:add', (_event, workspacePath: string) => {
       const workspaces = store.get('workspaces', [])
       const existing = workspaces.find(w => w.path === workspacePath)
       if (!existing) {
         workspaces.push({
           path: workspacePath,
           name: workspacePath.split('/').pop() || workspacePath,
           lastOpened: new Date().toISOString()
         })
         store.set('workspaces', workspaces)
       } else {
         existing.lastOpened = new Date().toISOString()
         store.set('workspaces', workspaces)
       }
       return store.get('workspaces')
     })
     ipcMain.handle('workspace:switch', (_event, workspacePath: string) => {
       const workspaces = store.get('workspaces', [])
       const ws = workspaces.find(w => w.path === workspacePath)
       if (ws) ws.lastOpened = new Date().toISOString()
       store.set('workspaces', workspaces)
       store.set('lastWorkspace', workspacePath)
       return workspacePath
     })

     // Theme operations
     ipcMain.handle('theme:get', () => store.get('theme', 'system'))
     ipcMain.handle('theme:set', (_event, theme: 'light' | 'dark' | 'system') => {
       store.set('theme', theme)
       return true
     })

     // Provider operations
     ipcMain.handle('providers:list', () => store.get('providers', []))
     ipcMain.handle('providers:save', (_event, provider: Record<string, unknown>) => {
       const providers = store.get('providers', [])
       const idx = providers.findIndex(p => p.id === provider.id)
       if (idx >= 0) providers[idx] = provider as typeof providers[0]
       else providers.push(provider as typeof providers[0])
       store.set('providers', providers)
       return true
     })
     ipcMain.handle('providers:delete', (_event, providerId: string) => {
       const providers = store.get('providers', [])
       store.set('providers', providers.filter(p => p.id !== providerId))
       return true
     })
     ipcMain.handle('providers:test', async (_event, _provider: Record<string, unknown>) => {
       // Stub for Phase 1 — returns success/failure simulation
       return { success: true, message: 'Connection test stub' }
     })

     // Window state
     ipcMain.handle('window:stateSave', (_event, state: Record<string, unknown>) => {
       store.set('windowState', state)
       return true
     })
   }
   ```

2. Update `src/preload/index.ts`:
   ```typescript
   import { contextBridge, ipcRenderer } from 'electron'

   const electronAPI = {
     // Store
     storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
     storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
     storeDelete: (key: string) => ipcRenderer.invoke('store:delete', key),

     // Workspace
     workspaceList: () => ipcRenderer.invoke('workspace:list'),
     workspaceAdd: (path: string) => ipcRenderer.invoke('workspace:add', path),
     workspaceSwitch: (path: string) => ipcRenderer.invoke('workspace:switch', path),
     selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

     // Theme
     themeGet: () => ipcRenderer.invoke('theme:get'),
     themeSet: (theme: 'light' | 'dark' | 'system') => ipcRenderer.invoke('theme:set', theme),

     // Providers
     providersList: () => ipcRenderer.invoke('providers:list'),
     providersSave: (provider: Record<string, unknown>) => ipcRenderer.invoke('providers:save', provider),
     providersDelete: (id: string) => ipcRenderer.invoke('providers:delete', id),
     providersTest: (provider: Record<string, unknown>) => ipcRenderer.invoke('providers:test', provider),

     // Window
     windowStateSave: (state: Record<string, unknown>) => ipcRenderer.invoke('window:stateSave', state),
   }

   contextBridge.exposeInMainWorld('electronAPI', electronAPI)
   ```

3. Create `src/preload/index.d.ts` for TypeScript types:
   ```typescript
   interface ElectronAPI {
     storeGet: (key: string) => Promise<any>
     storeSet: (key: string, value: unknown) => Promise<boolean>
     storeDelete: (key: string) => Promise<boolean>
     workspaceList: () => Promise<any[]>
     workspaceAdd: (path: string) => Promise<any[]>
     workspaceSwitch: (path: string) => Promise<string>
     selectFolder: () => Promise<string | null>
     themeGet: () => Promise<'light' | 'dark' | 'system'>
     themeSet: (theme: 'light' | 'dark' | 'system') => Promise<boolean>
     providersList: () => Promise<any[]>
     providersSave: (provider: Record<string, unknown>) => Promise<boolean>
     providersDelete: (id: string) => Promise<boolean>
     providersTest: (provider: Record<string, unknown>) => Promise<{ success: boolean; message: string }>
     windowStateSave: (state: Record<string, unknown>) => Promise<boolean>
   }

   interface Window {
     electronAPI: ElectronAPI
   }
   ```

4. Update `src/main/index.ts` to register handlers and restore window state:
   ```typescript
   import { app, BrowserWindow, shell } from 'electron'
   import { join } from 'path'
   import { electronApp, optimizer, is } from '@electron-toolkit/utils'
   import { registerIpcHandlers } from './ipc'
   import store from './store'

   function createWindow(): void {
     const windowState = store.get('windowState', { width: 1200, height: 800, maximized: false })

     const mainWindow = new BrowserWindow({
       width: windowState.width,
       height: windowState.height,
       ...(windowState.x != null && windowState.y != null
         ? { x: windowState.x, y: windowState.y }
         : {}),
       show: false,
       webPreferences: {
         preload: join(__dirname, '../preload/index.js'),
         sandbox: false
       }
     })

     if (windowState.maximized) {
       mainWindow.maximize()
     }

     mainWindow.on('ready-to-show', () => {
       mainWindow.show()
     })

     mainWindow.on('close', () => {
       const bounds = mainWindow.getBounds()
       store.set('windowState', {
         x: bounds.x,
         y: bounds.y,
         width: bounds.width,
         height: bounds.height,
         maximized: mainWindow.isMaximized()
       })
     })

     mainWindow.webContents.setWindowOpenHandler((details) => {
       shell.openExternal(details.url)
       return { action: 'deny' }
     })

     if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
       mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
     } else {
       mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
     }
   }

   app.whenReady().then(() => {
     electronApp.setAppUserModelId('com.pi-workbench')

     app.on('browser-window-created', (_, window) => {
       optimizer.watchWindowShortcuts(window)
     })

     registerIpcHandlers()
     createWindow()

     app.on('activate', () => {
       if (BrowserWindow.getAllWindows().length === 0) createWindow()
     })
   })

   app.on('window-all-closed', () => {
     if (process.platform !== 'darwin') app.quit()
   })
   ```
</action>

<acceptance_criteria>
- `src/main/ipc.ts` exists with all IPC handlers listed above
- `src/preload/index.ts` exposes `window.electronAPI` object with all methods
- `src/preload/index.d.ts` has the `Window.electronAPI` type declaration
- `src/main/index.ts` calls `registerIpcHandlers()` in `app.whenReady()`
- `src/main/index.ts` restores window from `store.get('windowState')` and saves on close
- `store:get` handler returns store values by key
- `store:set` handler writes values to store
- `dialog:selectFolder` opens native folder dialog
- `npm run dev` starts the app window with correct dimensions
- Closing and restarting the app restores window size and position
</acceptance_criteria>

---

## Verification Criteria

- [ ] Electron window starts with correct dimensions from persisted state
- [ ] Window position/size saved on close, restored on startup
- [ ] All IPC channels registered without errors
- [ ] Preload exposes all required APIs
- [ ] Tailwind classes render in the renderer
- [ ] shadcn components can be imported and rendered

## must_haves

- Working Electron app that opens a window
- IPC communication established between main and renderer
- electron-store persisting and reading data
- Window state survives restart
</acceptance_criteria>