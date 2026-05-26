# Coding Conventions

**Analysis Date:** 2026-05-26

## Naming Patterns

**Files:**
- TypeScript source: `camelCase.ts` or `camelCase.tsx` (e.g., `providerUrl.ts`, `sessionStore.ts`)
- Test files: Same name with `.test.ts` suffix (e.g., `provider-url.test.ts`)
- UI components: PascalCase directory + PascalCase file (e.g., `Sidebar/Sidebar.tsx`)

**Functions:**
- camelCase for all functions (e.g., `normalizeProviderApiUrl`, `createDeepAgentRuntime`)
- Verb-prefix for actions: `get*`, `set*`, `create*`, `build*`, `load*`, `resolve*`

**Types/Interfaces:**
- PascalCase (e.g., `ThemeState`, `DeleteFileInput`, `RuntimeModelOverrides`)
- Suffix for interface variants: `*Options`, `*Config`, `*Input`, `*Row`

**Variables:**
- camelCase (e.g., `projectPath`, `apiUrl`, `isActive`)
- Boolean prefixes: `is*`, `has*`, `should*` (e.g., `isProtectedPath`, `hasReasoning`)
- Suffix `List` for arrays (e.g., `providersList`)

**Constants:**
- UPPER_SNAKE_CASE for module-level constants (e.g., `DEFAULT_INTERRUPT_ON`)
- camelCase for object-typed constants (e.g., `deepAgent` instances)

## Code Style

**Formatting:**
- Tool: Prettier (via Shadcn/ui `components.json`)
- Tab width: 2 spaces (implied by TypeScript standard)
- Semicolons: Yes
- Quote style: Single quotes for strings

**Linting:**
- Tool: TypeScript compiler with `strict: true`
- No ESLint config file found - relies on TypeScript strict mode

**TypeScript Configuration:**
- Target: ES2022
- Module: ESNext
- ModuleResolution: bundler
- Strict mode enabled
- `noEmit: true` (type checking only)

## Import Organization

**Order:**
1. Node.js built-in modules (e.g., `fs`, `path`, `crypto`, `os`)
2. External packages (e.g., `from 'vitest'`, `from '@langchain/core/tools'`)
3. Internal modules (e.g., `from './store'`, `from '../shared/provider-url'`)
4. Type imports (e.g., `import type { MCPServer }`)

**Path Aliases:**
- `@` → `src/renderer/src` (defined in `tsconfig.web.json` and `vitest.config.ts`)

**Example:**
```typescript
import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';
import type { MCPServer } from '../../shared/types';
import { useThemeStore } from '@/stores/themeStore';
```

## Error Handling

**Patterns:**

1. **Try-catch with optional chaining:**
```typescript
try {
  // operation
} catch (err: any) {
  console.error('Failed to parse models for provider:', p.id, err);
  // fallback or rethrow
}
```

2. **Error message extraction:**
```typescript
error?.message || String(error)
```

3. **AbortError handling:**
```typescript
if (error?.name === 'AbortError' || controller.signal.aborted) {
  throw err;
}
```

4. **Silent failures with logging:**
```typescript
catch (error) {
  console.warn(`Failed to register DeepAgents harness profile for "${trimmed}":`, error);
}
```

5. **Error throwing for missing resources:**
```typescript
if (!provider) {
  throw new Error(`LLM Provider with ID ${providerId} not found.`);
}
```

## Logging

**Framework:** `console.log` / `console.error` / `console.warn`

**Patterns:**
- Category prefix in brackets: `[LLM STREAM]`, `[DEBUG]`, `[RUNTIME]`
- JSON stringify for complex data: `console.log('[LLM STREAM] Token:', JSON.stringify(token))`
- Error logging with context: `console.error('Failed to parse models for provider:', p.id, err)`

**Example:**
```typescript
console.log(`[LLM STREAM] 监听到 Native Reasoning 字段流开启，向前端发送 <think>`);
```

## Comments

**When to Comment:**
- Chinese comments for complex logic (as seen in the codebase)
- Explain non-obvious decisions
- Document fallbacks and edge cases

**Style:**
- Inline comments after logic: `// fallback or default`
- Block comments for complex algorithms
- TODO comments in Chinese

**Example:**
```typescript
// 确保主聊天入口始终绑定项目默认 Master Agent
const finalAgentId = ensureDefaultAgentForSession(projectId) || agentId || null;
```

## Function Design

**Size:** Small, focused functions preferred

**Parameters:**
- Type annotated (e.g., `input: DeleteFileInput`)
- Destructuring for objects (e.g., `({ file_path }) => { ... }`)
- Nullable parameters explicitly typed (e.g., `agentId?: string | null`)

**Return Values:**
- Explicit return types for exported functions
- Async functions return `Promise<T>`

## Module Design

**Exports:**
- Named exports for utilities: `export function createDeleteFileTool(...)`
- Default exports for stores: `export const useThemeStore = create<ThemeState>()(...)`

**Barrel Files:** Not used - direct imports via path aliases

**State Management (Zustand):**
```typescript
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'theme-storage' }
  )
);
```

## React Component Conventions

**Structure:**
1. Imports
2. Type definitions
3. Component function
4. Default export

**Hooks:**
- Custom hooks in `hooks/` directory with `use*` prefix
- Access store via `useStore.getState()` for actions (not hook form)

**Example:**
```typescript
export function useTheme() {
  const { theme, setTheme } = useThemeStore();
  useEffect(() => { /* ... */ }, [theme]);
  return { theme, setTheme };
}
```

## Security Patterns

**API Key Masking:**
- Keys masked before sending to renderer: `api_key: '••••••••'`
- Decryption only in main process

**Path Validation:**
- Protected paths checked: `/.env`, `/.git`, `/node_modules`, `/out`, `/dist`
- Path traversal prevention: reject `..` and `~` in paths

---

*Convention analysis: 2026-05-26*
