# Testing Patterns

**Analysis Date:** 2026-05-26

## Test Framework

**Runner:**
- Vitest v3 (from `package.json`: `"vitest": "^3.0.0"`)
- Config file: `vitest.config.ts`

**Assertion Library:**
- Built into Vitest: `expect`

**Run Commands:**
```bash
npm test              # Run all tests (vitest run)
npm run test:watch    # Watch mode (vitest)
```

**Test Environment:**
- jsdom (configured in `vitest.config.ts`)
- Globals enabled: `globals: true`

## Test File Organization

**Location:**
- Co-located with source files
- Same directory as implementation

**Naming:**
- `*.test.ts` for TypeScript files
- `*.test.tsx` for React components

**Examples:**
```
src/shared/provider-url.test.ts
src/main/llm.test.ts
src/main/deepagent/file-tools.test.ts
src/renderer/src/stores/themeStore.test.ts
src/renderer/src/hooks/useTheme.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it } from 'vitest';

describe('functionName or ComponentName', () => {
  it('should do something specific', () => {
    expect(result).toBe(expected);
  });

  it('should handle error case', async () => {
    await expect(promise).rejects.toThrow('error message');
  });
});
```

**Setup/Teardown:**
```typescript
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

describe('test suite', () => {
  let projectPath: string;

  beforeEach(() => {
    // Setup before each test
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-test-'));
  });

  afterEach(() => {
    // Cleanup after each test
    fs.rmSync(projectPath, { recursive: true, force: true });
  });
});
```

## Mocking

**Framework:** Vitest's `vi` global

**Spy/Function Mocking:**
```typescript
import { vi } from 'vitest';

// Create mock function
const mockFn = vi.fn();

// Mock implementation
mockFn.mockResolvedValue(value);
mockFn.mockRejectedValue(new Error('error'));
mockFn.mockImplementation((input) => value);

// Check calls
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).toHaveBeenCalledWith(expectedArg);
```

**Module Mocking:**
```typescript
vi.mock('./some-module', () => ({
  createDeepAgentRuntime: vi.fn().mockResolvedValue({...}),
  // or
  someFunction: mockImplementation
}));
```

**Restore mocks:**
```typescript
beforeEach(() => {
  vi.restoreAllMocks(); // or vi.clearAllMocks()
});
```

**Window/Electron API Mocking:**
```typescript
window.electronAPI = {
  store: { get: vi.fn(), set: vi.fn() },
  db: { getProjects: vi.fn(), ... },
  llm: { chat: vi.fn(async () => { ... }) },
  platform: 'darwin',
};
```

## Fixtures and Factories

**Test Data:**
- Inline object literals for simple cases
- Helper functions for complex setup

**Example:**
```typescript
const sessions = [
  {
    id: 'session-1',
    project_id: 'project-1',
    name: 'Test Session',
    parent_session_id: null,
    summary: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
];
useSessionStore.setState({ sessions, activeSessionId: 'session-1' });
```

**Temp Directory Pattern:**
```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempProjectPath = path.join(os.tmpdir(), `cdf-test-${Math.random().toString(36).slice(2)}`);

beforeEach(() => {
  fs.rmSync(tempProjectPath, { recursive: true, force: true });
  fs.mkdirSync(tempProjectPath, { recursive: true });
});
```

## Coverage

**Requirements:** None enforced (no coverage config found)

**View Coverage:** Not configured

## Test Types

**Unit Tests:**
- Pure functions: `provider-url.ts`, `file-tools.ts`
- Store logic: `themeStore.ts`, `sessionStore.ts`
- Isolated components with mocked dependencies

**Integration Tests:**
- IPC handlers with mocked database
- LLM chat flow with mocked runtime

**E2E Tests:** Not used

## Common Patterns

**Async Testing:**
```typescript
it('should handle async operation', async () => {
  const result = await someAsyncFunction();
  expect(result).toBe(expected);
});
```

**Waiting for Callbacks:**
```typescript
await vi.waitFor(() => {
  expect(send).toHaveBeenCalledWith('llm:chunk-req-approval', expect.objectContaining({ type: 'approval_required' }));
});
```

**Error Assertions:**
```typescript
await expect(deleteFile.invoke({ file_path: '/.env' })).rejects.toThrow('protected path');
```

**Promise-Based Async Iterators:**
```typescript
const firstRun = {
  messages: (async function* () {})(),
  toolCalls: (async function* () {})(),
  output: Promise.resolve({}),
};
streamEvents.mockResolvedValueOnce(firstRun);
```

**State Reset:**
```typescript
beforeEach(() => {
  vi.restoreAllMocks();
  useSessionStore.setState({ /* initial state */ });
});
```

## Testing Zustand Stores

**Pattern:**
```typescript
import { useThemeStore } from './themeStore';

describe('themeStore', () => {
  it('should have default theme as system', () => {
    expect(useThemeStore.getState().theme).toBe('system');
  });

  it('should update theme via setTheme', () => {
    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
  });
});
```

## Testing React Hooks

**Pattern:**
```typescript
import { describe, it, expect } from 'vitest';

describe('useTheme', () => {
  it('should export a function', () => {
    expect(typeof useTheme).toBe('function');
  });
});
```

**Note:** Full hook testing requires `@testing-library/react` which is installed but tests currently use simple assertions.

## What to Mock

**Mock:**
- `window.electronAPI` (Electron IPC)
- File system operations (use temp directories)
- External API calls (fetch)
- Database operations (better-sqlite3)

**Do NOT Mock:**
- Pure utility functions being tested
- Simple type conversions
- Well-tested third-party libraries

---

*Testing analysis: 2026-05-26*
