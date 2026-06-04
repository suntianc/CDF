---
phase: 08-polish-differentiators
plan: 03
subsystem: chokidar-fallback-and-toast
provides:
  - chokidar-watcher.ts: try-catch wrap chokidar.watch + 'error' event listener + degradeAndFallback helper
  - readdir one-shot fallback when chokidar fails
  - 'commands:fallback' IPC event emit to all renderer windows
  - 'degraded' module-scope flag prevents re-init storm (D-19 first-error-wins)
  - preload onFallback(callback) bridge
  - useCommandRegistry onFallback subscription + toastedFingerprints Set (C-04 dedup) + toast.warning 5000ms (D-18)
generated_files:
  - src/main/commands/chokidar-watcher.ts (MOD; +try-catch + 'error' event + degradeAndFallback + readdir fallback + commands:fallback IPC emit)
  - src/preload/index.ts (MOD; +onFallback bridge)
  - src/shared/types.ts (MOD; +ElectronAPI.commands.onFallback signature)
  - src/renderer/src/hooks/useCommandRegistry.ts (MOD; +toastedFingerprints useRef + onFallback useEffect + toast.warning)
  - src/renderer/src/hooks/useCommandRegistry.test.ts (MOD; boolean→enum assertion fixes)
---

# Plan 08-03 Summary

## Locked Decisions (D-16..D-19, C-04)

### D-16: chokidar failure → readdir fallback + IPC push
```ts
function degradeAndFallback(scope: 'system' | 'project', dir: string, err: unknown): void {
  if (degraded) return; // D-19: first-error-wins
  degraded = true;
  const msg = err instanceof Error ? err.message : String(err);
  log.error(`[commands-watcher] chokidar degraded for ${scope} dir=${dir}:`, err);
  readdirFallback(dir, scope);
  emitFallbackEvent(scope, dir, msg);
}

function startWatcher(dir, onChange, scope = 'system'): () => void {
  let handle;
  try {
    handle = chokidar.watch(dir, { ... });  // D-16 sync failure → degrade
  } catch (err) {
    degradeAndFallback(scope, dir, err);
    return () => {}; // no-op stop
  }
  handle.on('error', (err) => degradeAndFallback(scope, dir, err)); // D-16 async failure
  ...
}
```

### D-17: toast dedup by error fingerprint
```ts
const fp = `${data.scope}:${data.error}`;
if (toastedFingerprintsRef.current.has(fp)) return;
toastedFingerprintsRef.current.add(fp);
```

### D-18: sonner warning toast 5000ms
```ts
toast.warning('项目命令热重载不可用，已降级为静态扫描', {
  description: `scope=${data.scope} dir=${data.dir.slice(0, 40)} error=${data.error.slice(0, 60)}`,
  duration: 5000,
  id: fp, // sonner-level dedup (belt-and-suspenders)
});
```

### D-19: 'degraded' flag first-error-wins
Module-scope `let degraded = false` — once set, `degradeAndFallback` returns early. No retry storm.

## Test Results

- 11/11 chokidar-watcher tests pass (no regression)
- 4/4 useCommandRegistry tests pass (fixed boolean→enum)
- 37/37 SlashCommandPopup tests pass (no regression)
- **Cumulative: 232 passing**

## Out of Scope (for Plan 08-04)

- 08-04: ChatArea IME z-index comment verification + 08-SUMMARY.md
