---
quick_task: 260607-i7c
title: Add i18n (zh-CN + en-US) for renderer UI
type: execute
completed: 2026-06-07
status: complete
duration: ~5min
tasks_completed: 3/3
files_modified: 13
---

# Quick Task 260607-i7c: Add i18n (zh-CN + en-US) for renderer UI

## Summary

Added internationalization support to the CDF renderer UI using `i18next` + `react-i18next`. Renderer now supports zh-CN (default) and en-US, with manual language switching from the Sidebar settings menu and persistence via electron-store. First-launch detection follows `navigator.language`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Install i18n deps and add language to electron-store schema | `885a7e9` | package.json, package-lock.json, src/main/store.ts |
| 2 | Create i18n init, locales, and Zustand i18nStore with persistence sync | `8e56d63` | src/renderer/src/i18n/* (4 files), src/renderer/src/stores/i18nStore.{ts,test.ts}, src/renderer/src/main.tsx, src/renderer/src/App.tsx |
| 3 | Wire Language selector in Sidebar and replace hardcoded strings with t() calls | `c501d11` | src/renderer/src/components/Sidebar/Sidebar.tsx |

## Test Results

- 9/9 i18n tests pass (6 i18nStore + 3 i18n init)
- 11/11 i18n + theme store tests pass
- 3 pre-existing test failures in `src/main/deepagent/anthropic-*` (unrelated to i18n; documented in STATE.md as v1.0-era artifacts)

## Files Created/Modified

**Created:**
- `src/renderer/src/i18n/index.ts` — i18next init with zh-CN + en-US resources
- `src/renderer/src/i18n/locales/zh-CN.json` — Chinese locale (default)
- `src/renderer/src/i18n/locales/en-US.json` — English locale
- `src/renderer/src/i18n/index.test.ts` — i18n init tests (3 cases)
- `src/renderer/src/stores/i18nStore.ts` — Zustand store with `currentLanguage`, `setLanguage`, `initFromStore`
- `src/renderer/src/stores/i18nStore.test.ts` — i18nStore tests (6 cases)

**Modified:**
- `package.json` — added `i18next@^26.3.1` and `react-i18next@^17.0.8` to dependencies
- `package-lock.json` — locked new deps
- `src/main/store.ts` — added `language: 'zh-CN' | 'en-US'` to `StoreSchema`, defaults, and JSON schema validation
- `src/renderer/src/main.tsx` — added `import './i18n'` before render
- `src/renderer/src/App.tsx` — added `useEffect` to call `initFromStore()` on mount
- `src/renderer/src/components/Sidebar/Sidebar.tsx` — replaced 14 hardcoded strings with `t('sidebar.*')` calls; added language `<select>` in settings menu

## Deviations from Plan

None — plan executed exactly as written.

## Implementation Notes

- **Persistence model**: i18n uses electron-store (per plan) instead of Zustand `persist` middleware (which is what `themeStore` uses). This is intentional — theme uses localStorage via Zustand `persist`, but `themeStore.ts` line 12 uses `persist` because it's a simple key-value. i18n reads from electron-store on boot via `initFromStore()` then syncs writes through `setLanguage()`. No `persist` middleware needed.
- **Language detection**: `navigator.language.toLowerCase().startsWith('zh')` covers zh-CN, zh-TW, zh-HK, etc. → 'zh-CN'. Everything else → 'en-US'.
- **Validation**: `setLanguage` runtime-validates input against the union type; invalid input is rejected without state change, IPC, or i18n side-effects.
- **Select element**: native `<select>` instead of custom dropdown (per project CLAUDE.md simplicity-first). No new components needed.
- **No main process changes**: existing `store:get` / `store:set` IPC channels reused; no new IPC routes added.

## Verification Checklist

- [x] i18n deps installed and listed in `package.json`
- [x] electron-store schema extended with `language` field
- [x] `i18n.ts` initializes both locales with React binding
- [x] `useI18nStore` exports with `currentLanguage`, `setLanguage`, `initFromStore`
- [x] App.tsx calls `initFromStore()` on mount
- [x] main.tsx imports i18n before render
- [x] 14 hardcoded sidebar strings replaced with `t()` calls
- [x] Language selector visible at top of settings menu
- [x] Zero Chinese characters in `Sidebar.tsx`
- [x] i18n tests pass (9/9)
- [x] Pre-existing test failures unrelated to this task (acknowledged in STATE.md)

## Out of Scope (per plan)

- Main process menus, IPC error messages, LLM prompts, logs
- Other components beyond Sidebar (14 strings here are the only hardcoded ones per spec)
- Custom dropdown component (native select is intentional)
- Light/dark theme persistence (already handled by existing `themeStore`)
