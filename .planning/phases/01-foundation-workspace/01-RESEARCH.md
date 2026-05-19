# Phase 1: Foundation & Workspace — Technical Research

**Date:** 2026-05-19
**Status:** Complete ✓

---

## 1. Electron + React + TypeScript Scaffolding

### Tool: electron-vite

**Status:** Recommended ✅ (confirmed by CONTEXT.md decision)

**Version:** electron-vite v3.x (latest, 2026)

**Setup command:**
```bash
npm create @quick-start/electron@latest pi-workbench
# Select: React + TypeScript template
```

**Project Structure** (from electron-vite template):
```
pi-workbench/
├── src/
│   ├── main/           # Electron main process
│   │   └── index.ts
│   ├── preload/        # Preload scripts (contextBridge)
│   │   └── index.ts
│   └── renderer/       # React app (Vite-powered)
│       ├── src/
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   └── assets/
│       │       └── main.css
│       └── index.html
├── electron.vite.config.ts
├── package.json
└── tsconfig*.json
```

**Key details:**
- Uses Vite for renderer process (HMR), esbuild for main/preload
- Separate `main`, `preload`, `renderer` directories
- Native ESM support (Electron 30+ requires ESM)
- Template version `create-electron-vite` is the official scaffolding tool

### Tailwind CSS v4 Setup

**Status:** Required (shadcn/ui dependency)

**Installation:**
```bash
npm install -D tailwindcss @tailwindcss/vite
```

**Vite config update** (`electron.vite.config.ts`):
```typescript
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
```

**CSS entry** (`src/renderer/src/assets/main.css`):
```css
@import "tailwindcss";
```

### Shadcn/UI Setup

**Status:** Recommended ✅ (confirmed by CONTEXT.md D-01)

**Key steps:**
1. Create `vite.config.ts` (copy of electron.vite.config.ts) — Shadcn CLI needs it for detection
2. Set up `jsconfig.json` or `tsconfig.json` with `@/*` alias pointing to `src/renderer/src/*`
3. Run `npx shadcn@latest init`
4. Fix `components.json` aliases after init

**Known gotchas:**
- Shadcn CLI may complain about missing framework detection — workaround: create `vite.config.ts` sibling
- Tailwind v4 changes cursor behavior — shadcn buttons may need explicit `cursor-pointer`
- ESLint needs its own alias mapping for `@/`

### Key Dependencies (Final List)

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | 30+ | Desktop framework |
| `react` | ^19 | UI framework |
| `react-dom` | ^19 | DOM rendering |
| `typescript` | ^5 | Type safety |
| `electron-vite` | ^3 | Build tooling |
| `@vitejs/plugin-react` | latest | React Vite plugin |
| `tailwindcss` | ^4 | Utility CSS |
| `@tailwindcss/vite` | latest | Tailwind Vite plugin |
| `shadcn/ui` | latest | Component library (npx init) |
| `@radix-ui/*` | latest | Primitive components (shadcn dep) |
| `lucide-react` | latest | Icons (shadcn dep) |
| `class-variance-authority` | latest | Variant styling (shadcn dep) |
| `clsx` + `tailwind-merge` | latest | `cn()` utility (shadcn dep) |

---

## 2. Data Persistence: electron-store

**Status:** Recommended ✅ (confirmed by CONTEXT.md D-03)

**Version:** 11.0.2 (latest, Oct 2025 — actively maintained)
**Requirements:** Electron 30+, Node.js 20+, ESM only
**GitHub stars:** 5k | **Used by:** 33.5k projects

### API Summary

```typescript
import Store from 'electron-store';

const store = new Store({
  defaults: {
    workspaces: [],
    providers: [],
    theme: 'system',
    windowState: { x: null, y: null, width: 1200, height: 800 }
  },
  encryptionKey: 'your-key', // For API key encryption
  encryptionAlgorithm: 'aes-256-gcm', // Authentication + encryption
});
```

### Integration Pattern

**Preferred: Main process only, expose via IPC**
- Initialize `Store` in main process
- Create IPC handlers (`ipcMain.handle`) for get/set/delete
- Expose typed API through preload `contextBridge`
- Renderer calls typed functions via `window.electronAPI`

**Alternative: Renderer-only (with `initRenderer()`)**
- Call `Store.initRenderer()` in main process
- Create `Store` instance directly in renderer
- Simpler but less secure for sensitive data

### Encryption Strategy for API Keys

- Use `encryptionKey` option with a machine-derived key (not hardcoded)
- Use `aes-256-gcm` algorithm for authenticated encryption (tamper detection)
- Note: electron-store encryption is for **obscurity** not security (key is in app bundle)
- For stronger security: consider Electron's `safeStorage` API (OS-level encryption via Keychain/libsecret)

### Storage Schema (Phase 1)

```typescript
interface StoreSchema {
  workspaces: Array<{
    path: string;
    name: string;
    lastOpened: string; // ISO date
  }>;
  recentWorkspaces: string[]; // paths, ordered by recent
  providers: Array<{
    id: string;
    type: 'anthropic' | 'openai' | 'google' | 'custom';
    name: string;
    apiKey: string; // encrypted
    baseUrl?: string; // for custom OpenAI-compatible
    models: string[];
    defaultModel?: string;
  }>;
  theme: 'light' | 'dark' | 'system';
  windowState: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    maximized: boolean;
  };
}
```

---

## 3. Electron IPC Architecture

**Status:** Recommended pattern

### Architecture

```
┌─────────────────────────────────────────────────┐
│  Renderer Process (React)                       │
│  ┌───────────────────────────────────────────┐  │
│  │  window.electronAPI.xxx()                  │  │
│  └──────────────┬────────────────────────────┘  │
│                 │ contextBridge                  │
│  ┌──────────────▼────────────────────────────┐  │
│  │  Preload Script                            │  │
│  │  ipcRenderer.invoke / ipcRenderer.send     │  │
│  └──────────────┬────────────────────────────┘  │
└─────────────────┼────────────────────────────────┘
                  │ IPC (async)
┌─────────────────▼────────────────────────────────┐
│  Main Process (Electron + pi SDK)                │
│  ┌───────────────────────────────────────────┐  │
│  │  ipcMain.handle('channel', handler)        │  │
│  │  electron-store (persistence)              │  │
│  │  pi SDK (AgentSession management)          │  │
│  │  Electron native APIs (dialog, window)     │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### IPC Channels (Phase 1)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `store:get` | Renderer→Main | Get store value |
| `store:set` | Renderer→Main | Set store value |
| `store:delete` | Renderer→Main | Delete store value |
| `dialog:selectFolder` | Renderer→Main | Open folder picker |
| `workspace:list` | Renderer→Main | Get workspace list |
| `workspace:add` | Renderer→Main | Add workspace |
| `workspace:switch` | Renderer→Main | Switch active workspace |
| `theme:get` | Renderer→Main | Get current theme |
| `theme:set` | Renderer→Main | Set theme |
| `window:stateSave` | Renderer→Main | Save window state |
| `providers:list` | Renderer→Main | Get providers |
| `providers:save` | Renderer→Main | Save provider config |
| `providers:test` | Renderer→Main | Test provider connection |

### Best Practices
- Use `ipcMain.handle` / `ipcRenderer.invoke` for request-response (returns Promise)
- Use `webContents.send` for main→renderer push events (e.g., provider connection status)
- Never expose raw `ipcRenderer` in contextBridge — expose specific functions only
- Type all channel payloads for type safety

---

## 4. pi SDK Main Process Integration

**Status:** Confirmed approach (CONTEXT.md — direct main process integration)

### Integration Pattern

The pi SDK (`@earendil-works/pi-coding-agent`) provides `createAgentSession()` which can be called directly in Electron's main process. No subprocess or bridge needed.

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";

// In main process
async function initializePiSession(workspacePath: string) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  
  const { session } = await createAgentSession({
    cwd: workspacePath,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });
  
  return session;
}
```

### Key Considerations

1. **Session Management:** For each workspace, create a separate `AgentSession` in main process memory
2. **Event Streaming:** Forward `message_update` events from session to renderer via IPC (`webContents.send`)
3. **Provider Config:** AuthStorage and ModelRegistry support custom paths — use electron-store stored config
4. **API Keys:** Set via `authStorage.setRuntimeApiKey(provider, key)` from stored config
5. **ESM Compatibility:** electron-store v11 and pi SDK are both ESM — ensure `"type": "module"` in package.json

### Phase 1 Integration Points
- Phase 1 doesn't need full agent conversation (Phase 2)
- But Phase 1 should establish the **Agent session lifecycle**:
  - Store pi SDK references in main process
  - Initialize session when workspace loads
  - Wire up IPC channels that Phase 2 will use for chat streaming

---

## 5. Window State Management

**Status:** Recommended approach

### Implementation
- Use `electron-store` to persist window bounds
- Listen to `close` event on BrowserWindow
- Save `getBounds()` (x, y, width, height) and `isMaximized()`
- Restore on app ready: create window with saved bounds, maximize if needed

```typescript
// Main process
const windowState = store.get('windowState');

mainWindow = new BrowserWindow({
  width: windowState.width ?? 1200,
  height: windowState.height ?? 800,
  x: windowState.x,
  y: windowState.y,
});

if (windowState.maximized) {
  mainWindow.maximize();
}

mainWindow.on('close', () => {
  const bounds = mainWindow.getBounds();
  store.set('windowState', {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: mainWindow.isMaximized(),
  });
});
```

---

## 6. Theme Implementation

**Status:** System + manual toggle (D-20)

### Tailwind v4 Dark Mode
```css
/* main.css */
@import "tailwindcss";

/* Use Tailwind v4's class-based dark mode */
@custom-variant dark (&:where(.dark, .dark *));
```

### React Context
```typescript
type Theme = 'light' | 'dark' | 'system';

// ThemeProvider component manages:
// 1. Reading persisted theme from store (via IPC)
// 2. Applying `dark` class to <html> element
// 3. Listening to system preference changes (matchMedia)
// 4. Exposing toggle function via context
```

### Implementation Notes
- Store preference in electron-store (`theme: 'light' | 'dark' | 'system'`)
- For `system`: listen to `window.matchMedia('(prefers-color-scheme: dark)')` changes
- Apply class to `<html>` element: `document.documentElement.classList.toggle('dark', isDark)`
- Tailwind's `dark:` variants work automatically when `.dark` class is on `<html>`

---

## 7. Project Scaffold Recommendations

### Step-by-step scaffold order

1. `npm create @quick-start/electron@latest pi-workbench` (React + TypeScript template)
2. Install Tailwind v4: `npm install -D tailwindcss @tailwindcss/vite`
3. Configure `electron.vite.config.ts` with tailwind plugin + `@/` alias
4. Add `@import "tailwindcss"` to renderer CSS
5. Create `vite.config.ts` (copy of renderer config for Shadcn CLI detection)
6. Configure `tsconfig.json` with `@/*` path alias
7. `npx shadcn@latest init` → follow prompts
8. `npx shadcn@latest add button` (verify setup)
9. Install `electron-store`: `npm install electron-store`
10. Set up IPC infrastructure (preload + main handlers)
11. Build UI components (sidebar, settings page, workspace management)

### Validation Checklist
- [ ] `npm run dev` starts Electron window with HMR
- [ ] Tailwind classes render correctly
- [ ] Shadcn button renders with proper styling
- [ ] electron-store reads/writes in main process
- [ ] IPC calls work from renderer to main
- [ ] Theme switching works (light/dark/system)
- [ ] Window state persists across restart

---

## 8. Potential Pitfalls

### Electron + ESM
- electron-store v11 requires ESM (`"type": "module"` in package.json)
- pi SDK is ESM-native
- Ensure all imports use ESM syntax (no `require()`)
- electron-vite handles ESM conversion for renderer automatically

### Shadcn CLI + electron-vite
- Shadcn CLI looks for `vite.config.*` in project root
- electron-vite uses `electron.vite.config.*` — create a duplicate `vite.config.*` for CLI detection
- Can consolidate to single `vite.config.ts` by telling electron-vite to use it via `--config ./vite.config.ts`

### Tailwind v4 Breaking Changes
- `@import "tailwindcss"` replaces older `@tailwind` directives
- Shadcn may need Tailwind v4-specific adjustments (cursor, ring utilities)
- Check: `npx shadcn@latest add button` handles this, but verify

### electron-store encryption
- `encryptionKey` is not secure against determined attackers (key is in app bundle)
- Acceptable for obscurity (D-05). Document this trade-off.
- For Phase 1 API key storage, this is sufficient.

---

*Research completed: 2026-05-19*
*Sources: electron-vite.org, shadcn/ui docs, sindresorhus/electron-store, Electron IPC docs, pi SDK docs (v2.1.4)*