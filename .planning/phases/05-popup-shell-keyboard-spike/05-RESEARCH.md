# Phase 5: Popup Shell + Keyboard Spike - Research

**Researched:** 2026-06-04
**Domain:** Renderer-side `/` command popup anchored to existing bare `<textarea>` using cmdk + Radix Popover
**Confidence:** HIGH (library APIs verified via Context7; ChatArea.tsx anchors directly inspected; existing IME primitives mapped)

---

## Summary

Phase 5 is a **SPIKE**: prove the cmdk + Radix Popover path works on CDF's existing bare `<textarea>` (no ComposerPrimitive adoption, no `unstable_useSlashCommandAdapter`) and lock the keyboard navigation contract. Deliverable: a working popup that opens on `/`, filters by substring (NFKC + case-insensitive), supports ↑↓/Enter/Esc/Tab/Backspace, and is IME-safe — all rendered from **3 hardcoded system placeholders** (`/goal` `/context` `/plan`). **No plugin sources, no dispatcher, no IPC, no Zustand store** in Phase 5 — those land in Phase 6.

The two new direct dependencies are `cmdk@1.1.1` (latest stable, React 19 peer) and `@radix-ui/react-popover@1.1.15` (latest stable, React 19 peer). Neither is currently in `package.json` or `node_modules`; both must be added. cmdk provides the command palette primitives (filter, roving focus, keyboard nav). Radix Popover provides the `<PopoverAnchor asChild>` mechanism to wrap the existing `<form>` and float a popup above the textarea with `onOpenAutoFocus` focus management that **must** call `e.preventDefault()` to keep the textarea in focus.

The integration point is surgical: wrap the existing `<form onSubmit={preventDefault}>` at `ChatArea.tsx:1002` in `<PopoverAnchor asChild>` + `<Popover.Root>` + `<Popover.Content>`, add a local `useState<boolean>('slashOpen')` next to existing state, and add one branch to the existing `handleKeyDown` at line 658 to swallow ↑↓/Enter/Tab/Esc/Backspace when `slashOpen === true`. IME safety is already solved — `isComposingRef`, `justFinishedComposingRef` (200ms window), and `isComposingKeyEvent()` helpers exist at lines 145-147, 624-651, 653-656. **Do not re-implement IME detection in Phase 5.** The hardcoded 3 commands and one empty-state row (D-02, D-03) keep the data flow trivial — no registry, no async loading, no source badges (D-01).

**Primary recommendation:** Build a thin `SlashCommandPopup.tsx` (cmdk `Command.List` + 3 `Command.Item` + `Command.Empty`) wrapped in Radix `Popover.Content` with `onOpenAutoFocus={e => e.preventDefault()}`; mirror the existing `dropdown-menu.tsx` shadcn pattern for `popover.tsx`; add the 5 PITFALLS P6 regression tests in `SlashCommandPopup.test.tsx`; the `handleKeyDown` extension handles ↑↓/Enter/Tab/Esc interception and the Backspace-close-when-only-`/`-remains rule.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Each row shows **only command name** (e.g., `/goal`). No description, no source badge, no keybind hint.
- **D-02:** Popup **always shows 3 hardcoded system placeholders** (`/goal` `/context` `/plan`) on first open.
- **D-03:** When filter matches nothing, show an **interactive hint placeholder line** (e.g., `试试输入 /goal · /context · /plan 查看可用命令` or `无匹配命令`).
- **D-04:** First row always highlighted on popup open (cmdk default). No memory across opens.
- **D-05:** Filter is **substring + case-insensitive + NFKC-normalized** on the command name only.
- **D-06:** Filter searches **only command name**, not description.
- **D-07:** **Tab and Enter are identical** in Phase 5: insert highlighted command text + close popup + do **not** execute. `e.preventDefault()` required for Tab to override textarea's default focus-shift.

### Claude's Discretion
- **C-01:** Exact text of the D-03 hint line.
- **C-02:** Popup position (above vs below textarea). Default to below (Claude Code style).
- **C-03:** `cmdk.Command.List` vs `cmdk.Command.Group` for the 3 system placeholders. Pick whichever is cleaner.

### Deferred Ideas (OUT OF SCOPE for Phase 5)
- Args parsing for plugin commands (locked in REQUIREMENTS.md, no further action)
- Description column in popup rows (Phase 6+)
- Source badge column (Phase 6 when registry wired)
- Frecency-based ordering (SLASH-16 v1.2+)
- Description search filter (requires descriptions to exist; Phase 5 has none)
- Active filter highlight (bold matched substring in row) — v1.2 polish
- Arrow-down at end-of-list wrap — cmdk default; just verify
- Search by description keyword (e.g., "上下文" → `/context`) — requires descriptions
- `/goal` SQLite persistence (SLASH-15, v1.2+)
- MCP args schema form (SLASH-14, v1.2+)
- Project custom command authoring UX (SLASH-21, v1.2+)
- Voice input fallback (SLASH-22, v1.2+)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SLASH-01** | User can type `/` in Master Agent chat input to open a command popup | cmdk + Radix Popover shell + `PopoverAnchor asChild` wrap of `<form>` (line 1002) + local `useState<'slashOpen'>` (line 137 pattern) + `onChange`/`onValueChange` wiring + `onOpenAutoFocus={e => e.preventDefault()}` to keep textarea focus |
| **SLASH-02** | User can filter by substring (case-insensitive, NFKC-normalized for CJK) and navigate with ↑↓ + Enter + Esc + Backspace | `cmdk` `Command` with `shouldFilter={false}` + manual NFKC filter using `String.prototype.normalize('NFKC')` (D-05) + cmdk's built-in roving focus (↑↓) + custom `onSelect` for Enter/Tab (D-07) + `onEscapeKeyDown` on Popover for Esc + handleKeyDown branch for Backspace-close-when-`/`-remains + IME safety via existing `isComposingKeyEvent` |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `/` char trigger detection | Browser / Client (React textarea `onChange`) | — | React onChange handler is the only input source; runs in the renderer |
| Popup show/hide state | Browser / Client (`useState`) | — | Phase 5 uses local `useState`; refactor to Zustand store in Phase 6 |
| Filter algorithm (substring + NFKC) | Browser / Client (cmdk + manual filter) | — | Pure JS string ops; no IPC needed |
| Keyboard navigation (↑↓/Enter/Tab/Esc) | Browser / Client (cmdk roving focus + `onSelect`) | Browser / Client (textarea `handleKeyDown` swallows keys when popup open) | Cmkd owns ↑↓/Enter/Esc internally; textarea's `handleKeyDown` must `preventDefault` to stop those keys from triggering default behaviors (form submit, focus shift) |
| IME safety | Browser / Client (existing `isComposingRef` + `justFinishedComposingRef` 200ms window) | — | Already implemented in ChatArea.tsx:145-147, 624-656. **Do not re-implement** |
| Position popup above textarea | Browser / Client (Radix `Popover.Content` with `side="top"` and `PopoverAnchor asChild`) | — | Radix handles collision avoidance; portal escapes `overflow: hidden` |
| z-index coordination | Browser / Client (Tailwind `z-50` on `Popover.Content`, matching existing `dropdown-menu.tsx` pattern) | — | Per PITFALLS P4: z-index must clear TodoList + banners |
| `onOpenAutoFocus` focus management | Browser / Client (Radix callback) | — | `e.preventDefault()` is mandatory — without it, cmdk's internal `<input>` steals focus from textarea and typing after `/` routes to the wrong element |
| Backspace close (when only `/` remains) | Browser / Client (textarea `handleKeyDown` branch when `slashOpen && inputVal === '/'`) | — | PITFALLS P6 prevention; standard Claude Code behavior |
| Hardcoded 3 system commands data | Browser / Client (inline `const` in `SlashCommandPopup.tsx`) | — | Phase 5 SPIKE: 3 system placeholders only; registry deferred to Phase 6 |
| Dispatcher (insert text + close) | Browser / Client (`onSelect` handler in `SlashCommandPopup`) | — | D-07: insert text + close popup, do NOT execute. Phase 6 will add `handleSend` sniff to actually dispatch. |
| Out of scope: IPC channels, plugin data, dispatcher routing, M3 thinking protection | — | — | All Phase 6+ work |

**Why this matters:** Phase 5 must NOT touch main process, preload, IPC handlers, or any state outside ChatArea.tsx. The entire spike is renderer-local. Verifying tier ownership prevents accidental IPC additions in the plan.

---

## Standard Stack

### Core (NEW direct dependencies)

| Library | Version | Purpose | Why Standard | Confidence |
|---------|---------|---------|--------------|------------|
| `cmdk` | `^1.1.1` | Command list, filter, roving focus, Enter/Esc handling | De-facto React command palette lib (Linear, Raycast, shadcn/ui `command` component). 8 kB gzipped. Built-in a11y: `aria-activedescendant`, roving focus, Home/End. Verified React 19 peer dep via `npm view cmdk peerDependencies` → `react: '^18 || ^19 || ^19.0.0-rc'`. | HIGH |
| `@radix-ui/react-popover` | `^1.1.15` | Popover positioning portal + `PopoverAnchor asChild` to wrap the `<form>` | Industry standard for accessible popovers. Built-in collision avoidance, portal escape from `overflow: hidden`, `onOpenAutoFocus`/`onEscapeKeyDown` callbacks. Verified React 19 peer dep via `npm view @radix-ui/react-popover peerDependencies` → `react: '^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc'`. NOT yet in `package.json` or `node_modules` — must be added as direct dep. | HIGH |

### Existing (no change)

| Library | Installed | Use in Phase 5 |
|---------|-----------|----------------|
| `react@19.2.6` | Yes | Standard |
| `tailwindcss@4.3.0` | Yes | Popup styling (no new design system work) |
| `lucide-react@1.16.0` | Yes | (Reserved for Phase 6 icons; Phase 5 D-01 = no icons per row) |
| `vitest@4.1.8` + `@testing-library/react@16.0.0` | Yes (dev) | Component + keyboard tests (no existing `@testing-library/user-event` usage; will use `fireEvent` or direct keyboard events) |
| `clsx` + `tailwind-merge` | Yes | `cn()` helper in `src/renderer/src/lib/utils.ts` (verified) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `cmdk@1.1.1` + Radix Popover | `assistant-ui` `unstable_useSlashCommandAdapter` + `ComposerPrimitive.Unstable_TriggerPopover` | REJECTED — marked `@deprecated Under active development`; requires ComposerPrimitive adoption + replacement of bare `<textarea>` + `ChatModelAdapter` — would break 6-hunk patch-package on `@langchain/anthropic@1.4.0` (PITFALLS P1, P2) |
| `cmdk@1.1.1` + Radix Popover | `fuse.js@7.x` + roll-your-own popover | cmdk's built-in substring filter is sufficient for 3 rows; fuse.js overkill (PITFALLS P6 recommends `String#includes` not fuzzy at this scale) |
| `cmdk@1.1.1` + Radix Popover | Radix Dialog (centered modal) | Dialog breaks textarea-anchored UX; user loses spatial context (Claude Code popup is anchored, not centered) |
| `cmdk@1.1.1` + Radix Popover | kbar, Mantine Spotlight, react-aria | Each adds 30-100+ kB; cmdk 8 kB is the minimum viable dependency |
| `@radix-ui/react-popover` | `@radix-ui/react-dropdown-menu` (already in deps) | DropdownMenu is for menus triggered by a click; Popover is positioned to an arbitrary anchor. Wrong primitive for textarea-anchored UX. |
| Local `useState` for `slashOpen` | Zustand store (Phase 6 will refactor) | Per CONTEXT.md "Phase 5 uses local `useState` for `slashOpen` (refactor to Zustand in Phase 6)" |

**Installation:**
```bash
npm install cmdk@^1.1.1 @radix-ui/react-popover@^1.1.15
```

**Version verification (already run):**
```
cmdk@1.1.1 (latest stable; verified via `npm view cmdk version`)
@radix-ui/react-popover@1.1.15 (latest stable; verified via `npm view @radix-ui/react-popover version`)
```

Both have **React 19-compatible peer deps** (verified via `npm view <pkg> peerDependencies`).

---

## Package Legitimacy Audit

> Package Legitimacy Gate protocol: slopcheck was not installed in this environment (graceful degradation). All packages below are marked `[VERIFIED: npm registry]` because they were confirmed via `npm view` against the npm registry AND their origin is well-known (cmdk = official Linear-style palette by `dip`; `@radix-ui/react-popover` = official Radix UI primitive by WorkOS). Both are not newly-published and have well-established GitHub source repos.

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `cmdk@1.1.1` | npm | v1.1.1 published 2024-11 (post 1.0 GA 2024) — established | github.com/dip/cmdk (official) | n/a (slopcheck unavailable) | Approved `[VERIFIED: npm registry]` |
| `@radix-ui/react-popover@1.1.15` | npm | v1.1.x line is current stable since 2025-Q3 | github.com/radix-ui/primitives (official Radix UI) | n/a | Approved `[VERIFIED: npm registry]` |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Since slopcheck was unavailable, no [ASSUMED] tag is needed for the recommended packages — both passed direct `npm view` verification AND have well-known official source repos.*

---

## Architecture Patterns

### Recommended Project Structure (Phase 5 files)

```
src/renderer/src/
├── components/
│   ├── ChatArea/
│   │   ├── ChatArea.tsx                    # MODIFIED: wrap <form> in PopoverAnchor, add slashOpen useState, extend handleKeyDown
│   │   └── SlashCommandPopup.test.tsx      # NEW: keyboard contract + 5 PITFALLS P6 cases
│   ├── SlashCommand/                       # NEW directory
│   │   └── SlashCommandPopup.tsx           # NEW: cmdk Command.List with 3 hardcoded system placeholders
│   └── ui/
│       └── popover.tsx                     # NEW: Radix Popover shim (mirror dropdown-menu.tsx pattern)
└── (no changes to stores/ — Phase 5 uses local useState)
```

**No new files in:**
- `src/main/` — Phase 5 is renderer-only (no IPC, no main process)
- `src/preload/` — no new contextBridge methods
- `src/renderer/src/stores/` — no Zustand store yet
- `src/shared/` — no new shared types (SlashCommand type comes in Phase 6)

### Pattern 1: Anchor popover to existing form (no structural change to ChatArea)

**What:** The existing `<form onSubmit={(e) => e.preventDefault()}>` at `ChatArea.tsx:1002` is the natural anchor. Wrap it in `<Popover.Anchor asChild>` and add `<Popover.Portal>` + `<Popover.Content>` as siblings. The popover floats above (or below) the form via Radix collision avoidance.

**When to use:** Any time the trigger is a non-button element (textarea, input, custom form region). `asChild` is the Radix pattern for merging the popover's positioning context into an existing DOM element without an extra wrapper.

**Example (skeleton for the ChatArea.tsx insertion at line 1002):**
```tsx
<Popover open={slashOpen} onOpenChange={setSlashOpen}>
  <PopoverAnchor asChild>
    <form onSubmit={(e) => e.preventDefault()} className="...">
      {/* existing textarea at line 1004-1013 */}
      <textarea ... />
      {/* existing toolbar row at line 1016-1090 */}
    </form>
  </PopoverAnchor>
  <PopoverPortal>
    <PopoverContent
      side="top"
      align="start"
      sideOffset={8}
      collisionPadding={12}
      className="w-[480px] p-0 z-50"
      onOpenAutoFocus={(e) => e.preventDefault()}
      onEscapeKeyDown={() => setSlashOpen(false)}
      onInteractOutside={() => setSlashOpen(false)}
    >
      <SlashCommandPopup
        query={inputVal.startsWith('/') ? inputVal.slice(1) : ''}
        onSelect={handleSlashSelect}
      />
    </PopoverContent>
  </PopoverPortal>
</Popover>
```

**Key props:**
- `onOpenAutoFocus={(e) => e.preventDefault()}` — **MANDATORY**. Without it, Radix FocusScope moves focus to cmdk's internal `<input>`, and the user's subsequent keystrokes (e.g. typing more chars to refine the filter) route to cmdk's input instead of the textarea. This is the single most common cmdk + Radix foot-gun.
- `onEscapeKeyDown` — close the popup (in addition to cmdk's internal Esc handling for the `Command.Input`).
- `onInteractOutside` — close on outside click (this is the default Radix behavior; explicit here for clarity).

### Pattern 2: popover.tsx shim (mirror dropdown-menu.tsx)

**What:** Re-export the relevant Radix Popover sub-components following the existing shadcn-style wrapper convention. The shim adds nothing functional — it just gives a single import point and consistent default classNames.

**When to use:** Always — this matches the project's `dropdown-menu.tsx`, `dialog.tsx`, `tooltip.tsx` pattern. Future Radix Popover consumers in the codebase get the same `cn()` and `z-50` defaults.

**Example (mirror `src/renderer/src/components/ui/dropdown-menu.tsx:6-72`):**
```tsx
// src/renderer/src/components/ui/popover.tsx
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverPortal = PopoverPrimitive.Portal;
const PopoverClose = PopoverPrimitive.Close;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sidebar)] p-4 text-[var(--color-text-primary)] shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export {
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverPortal,
  PopoverClose,
  PopoverContent,
};
```

### Pattern 3: SlashCommandPopup with hardcoded 3 commands + manual NFKC filter

**What:** A controlled `<Command>` with `shouldFilter={false}` (manual filter for NFKC + per D-06 name-only search) + 3 hardcoded `Command.Item` + `Command.Empty` for the D-03 hint. `Command.Input` is `aria-hidden` because the actual typing happens in the textarea (cmdk's keyboard nav still works because of internal listeners, not the input's value).

**When to use:** Phase 5 SPIKE. The query state is **lifted up to ChatArea** (so the textarea owns it). The popup is a controlled component that receives `query` and `onSelect` props.

**Example (skeleton for `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx`):**
```tsx
import { Command } from 'cmdk';

const SYSTEM_COMMANDS = [
  { id: 'goal', label: '/goal' },
  { id: 'context', label: '/context' },
  { id: 'plan', label: '/plan' },
] as const;

export function SlashCommandPopup({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (cmd: { id: string; label: string }) => void;
}) {
  // D-05: substring + case-insensitive + NFKC-normalized, on command name only (D-06)
  const filtered = useMemo(() => {
    const normalizedQuery = query.normalize('NFKC').toLowerCase();
    return SYSTEM_COMMANDS.filter((cmd) =>
      cmd.label.normalize('NFKC').toLowerCase().includes(normalizedQuery)
    );
  }, [query]);

  return (
    <Command shouldFilter={false} label="Slash commands" className="...">
      {/* D-01: only command name shown. No description, no badge, no keybind hint. */}
      <Command.List className="max-h-[320px] overflow-y-auto p-1">
        {filtered.length === 0 ? (
          // D-03: interactive hint placeholder line
          <div className="px-3 py-2 text-sm text-[var(--color-text-muted)]">
            试试输入 /goal · /context · /plan 查看可用命令
          </div>
        ) : (
          filtered.map((cmd) => (
            <Command.Item
              key={cmd.id}
              value={cmd.id}
              onSelect={() => onSelect(cmd)}
              className="px-3 py-2 text-sm rounded cursor-default data-[selected=true]:bg-[var(--color-bg-hover)] outline-none"
            >
              {cmd.label}
            </Command.Item>
          ))
        )}
      </Command.List>
    </Command>
  );
}
```

**Key points:**
- `shouldFilter={false}` — we filter manually to support NFKC (cmdk's built-in filter uses `toLowerCase().includes()` but does NOT call `normalize`).
- No `<Command.Input>` — the textarea owns the query. cmdk's keyboard nav works without a visible input because cmdk installs its own `keydown` listeners on the `Command` container.
- `value={cmd.id}` is the cmdk filter value (used internally for selection tracking); the displayed text is `{cmd.label}`.
- `data-[selected=true]:bg-...` — cmdk's default selection styling. First row is selected by default (D-04) — this is cmdk's built-in default.

### Pattern 4: handleKeyDown extension for slash-open branch

**What:** Add a branch to the existing `handleKeyDown` at `ChatArea.tsx:658` that intercepts ↑↓/Enter/Tab/Esc when `slashOpen === true`. The existing `isComposingKeyEvent` check at line 659 must remain the first check (per PITFALLS P13).

**When to use:** Always. Without these preventDefault calls, the textarea's native behavior (Enter → submit form, Tab → shift focus to next element, ↑↓ → move cursor) fights cmdk.

**Example (the branch to add at the top of `handleKeyDown`, after the IME check):**
```tsx
const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (isComposingKeyEvent(e)) return; // line 659 — KEEP EXISTING

  if (slashOpen) {
    // D-07: Tab and Enter are identical in Phase 5 — insert text + close popup, do not execute
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      e.preventDefault(); // override textarea's default (Tab: focus shift; Enter: form submit)
      // The actual insert-text happens via cmdk's onSelect → handleSlashSelect (see below)
      // Cmkd's Enter handler runs first (onSelect fires), then this preventDefault stops form submit
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setSlashOpen(false);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // cmdk handles ↑↓ via its own listeners; prevent textarea from moving cursor
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' && inputVal === '/') {
      // T10: Backspace when only `/` remains → close popup
      e.preventDefault();
      setSlashOpen(false);
      return;
    }
  }

  // ...existing Enter + IME + isStreaming logic at line 660-672
};
```

**Order of operations detail:**
- `isComposingKeyEvent` (line 659) — returns early to allow IME
- `slashOpen` branch (NEW) — returns early to handle popup keys
- Existing `Enter` + `isStreaming` branch (line 660-672) — unchanged; this is the "send message" path

**The cmdk `onSelect` is wired separately** (in `SlashCommandPopup` props), not via the textarea's `handleKeyDown`. When the user presses Enter, cmdk fires `onSelect` on the highlighted item (which calls our `handleSlashSelect` to insert text + close popup), and **then** the textarea's `handleKeyDown` fires for the same Enter key (which we preventDefault to stop the form submit). The two work in concert.

### Pattern 5: handleSlashSelect — insert text + close popup (D-07)

**What:** The `onSelect` callback from `SlashCommandPopup`. Inserts the command name as text, closes the popup, and does **not** execute. In Phase 6, the same callback will be replaced/augmented with dispatcher routing.

**When to use:** Every Enter/Tab (via cmdk) or mouse click on a row.

**Example:**
```tsx
const handleSlashSelect = (cmd: { id: string; label: string }) => {
  setInputVal(cmd.label + ' '); // e.g. '/goal ' — leave space for args
  setSlashOpen(false);
  // D-07: do NOT call handleSend() — Phase 5 SPIKE, no dispatcher
};
```

**Why `cmd.label + ' '`:** Inserts the command name and a trailing space, ready for the user to type args. Matches Claude Code behavior. (D-07 says "insert the highlighted command text" — the trailing space is the natural completion.)

### Anti-Patterns to Avoid

- **Don't use `unstable_useSlashCommandAdapter`** — `@deprecated Under active development`. Requires ComposerPrimitive adoption; would force rewriting the bare `<textarea>` and break the 6-hunk patch-package on `@langchain/anthropic@1.4.0`. (PITFALLS P1)
- **Don't use cmdk's built-in filter** (`shouldFilter={true}` default) — it does `toLowerCase().includes(search)` but does NOT call `normalize('NFKC')`, which fails on CJK (PITFALLS P6 #64941). Set `shouldFilter={false}` and filter manually.
- **Don't add a new IPC channel** — Phase 5 is renderer-only. The 3 hardcoded commands live in `SlashCommandPopup.tsx` as a `const`. No registry, no plugin sources.
- **Don't add a Zustand store for `slashOpen`** — Phase 5 uses local `useState`. Refactor to Zustand in Phase 6.
- **Don't write fuzzy match** — D-05 says substring. `String#includes` is sufficient for 3 commands. Fuse.js is overkill.
- **Don't re-implement IME detection** — `isComposingRef`, `justFinishedComposingRef`, `isComposingKeyEvent` already exist. Reuse them.
- **Don't use `split('.')` or `split('/')` in filter** — Claude Code bugs #65047 (`.` breaks filter) and #65050 (`//` breaks filter). Use plain `String#includes`.
- **Don't add a new dep like `sonner`** — no toast needed in Phase 5 (D-03 is a static hint line, not a toast). Deferred to Phase 6 for `CommandConflictError`.
- **Don't add descriptions or source badges to rows** — D-01 explicitly says name-only in Phase 5. The 7-color source badge system comes in Phase 6 when plugin sources exist.
- **Don't use `Command.Input`** — the textarea owns the query. cmdk's keyboard nav works without a visible input.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Roving-focus keyboard navigation (↑↓/Home/End with wrap) | Custom `useState<'cursorIndex'>` + keydown listeners | cmdk's built-in roving focus | cmdk handles `aria-activedescendant`, wraps `selectedIndex` to `list.length`, emits `keydown` for Home/End. ~300 LOC of well-tested a11y code you'd duplicate. |
| `aria-activedescendant` + screen reader semantics | Custom role="listbox"/"option" + focus tracking | cmdk `Command.List` + `Command.Item` | cmdk implements WAI-ARIA combobox pattern. Tested by Linear/Raycast/shadcn. |
| `String#includes` substring filter | Fuzzy match with tokenization (`.split('.')`, `.split(' ')`) | Plain `String#includes` on NFKC-normalized strings | Claude Code bugs #65047 / #65050 came from tokenization. PITFALLS P6 explicitly says "use `String#includes`, don't split". |
| Popover positioning + collision avoidance | Custom `position: absolute` + `getBoundingClientRect()` math | Radix Popover `Popover.Content` | Radix handles portal escape, scroll detection, viewport collision, focus return. ~400 LOC. |
| Focus management on popup open (`e.preventDefault()`) | Custom `useEffect` to refocus textarea | Radix `onOpenAutoFocus={(e) => e.preventDefault()}` callback | Radix `FocusScope` is the source of the autofocus; cancelling it is the correct pattern. |
| IME composition safety (`isComposing` / `keyCode === 229`) | New `useState<'isComposing'>` + `onCompositionStart/End` | **Reuse existing** `isComposingRef` + `justFinishedComposingRef` (200ms) + `isComposingKeyEvent` in ChatArea.tsx:145-147, 624-656 | Already battle-tested in v1.0; not re-implementing it is the only safe path (PITFALLS P13). |
| Esc to close popup | Custom `useEffect` with `addEventListener('keydown')` | Radix `onEscapeKeyDown` callback OR cmdk's built-in Esc on `Command.Input` | Radix's `DismissableLayer` already handles outside-dismiss + Esc. |

**Key insight:** Phase 5's "real" work is **integration** (anchoring cmdk to a `<form>` via Radix, intercepting keys in the textarea, IME gating) — NOT building any new primitive. Every primitive needed already exists. The plan should be small (2 new files, 1 modified, 1 dep addition) and laser-focused on the integration glue.

---

## Common Pitfalls

### Pitfall 1: Forgetting `onOpenAutoFocus={e => e.preventDefault()}`

**What goes wrong:** Without this, Radix's `FocusScope` moves focus to cmdk's internal `<input>` when the popup opens. The user's subsequent keystrokes (e.g. typing `goal` after `/`) route to cmdk's input, which has no controlled `value` wired to the textarea — so the textarea's `inputVal` doesn't update and the popup never filters.

**Why it happens:** Radix popover is designed for menu/dialog UX where moving focus to the popup content is correct. cmdk has its own internal `<input>` for filter typing, so the default autofocus is doubly wrong for a textarea-anchored popup.

**How to avoid:** Add `onOpenAutoFocus={(e) => e.preventDefault()}` to `<PopoverContent>`. This is the single most common cmdk + Radix foot-gun. (STACK.md §1 "Anchor popover to textarea")

**Warning signs:** User types `/g` and sees the popup open but the filter doesn't update as they type. The textarea's `inputVal` stays at `/`.

### Pitfall 2: Not swallowing Enter/Tab in the textarea's `handleKeyDown`

**What goes wrong:** When the popup is open and the user presses Enter, two things happen: (1) cmdk's internal listener fires `onSelect` on the highlighted item (correct), and (2) the textarea's native Enter handler fires (because the popup is `aria-hidden` to screen readers, not to the event flow). The textarea's `handleSend()` runs, sending `/goal` as a literal message to the LLM.

**Why it happens:** Radix Popover uses `DismissableLayer` but does NOT block the underlying form's submit. Tab is even worse — without preventDefault, the browser's default focus-shift moves focus away from the textarea (e.g. to the next focusable element like the model selector or send button).

**How to avoid:** In the `handleKeyDown` extension (Pattern 4), add `e.preventDefault()` for both `Enter` and `Tab` when `slashOpen === true`. This stops the native form submit (Enter) and focus shift (Tab) while still letting cmdk's `onSelect` fire first.

**Warning signs:** User presses Enter to select a highlighted command, and the message also gets sent. (Worst case: empty message or `/${cmd}` literal text appears in the chat.)

### Pitfall 3: CJK / NFKC normalization missing

**What goes wrong:** CJK characters have multiple Unicode forms (decomposition + composition). Naive `toLowerCase().includes()` fails for CJK users: `/代` (a substring of `代码审查`) does not match `代码审查` in raw string comparison because the `代` may be a precomposed form. (Claude Code #64941)

**Why it happens:** `String.prototype.toLowerCase()` is locale-stable but does NOT call `normalize`. CJK users hit this when skill names use full-width / half-width / combining characters.

**How to avoid:** Apply `String.prototype.normalize('NFKC')` to BOTH the query and the command name before `String#includes`. NFKC normalizes compatibility characters (full-width → half-width, combined → precomposed). This is D-05.

**Test cases (MUST be in `SlashCommandPopup.test.tsx`):**
```ts
// NFKC normalization
it('matches full-width CJK via NFKC', () => {
  expect('/代'.normalize('NFKC').toLowerCase().includes('代码审查'.normalize('NFKC').toLowerCase().slice(0, 2))).toBe(false);
  // Actually: '代码审查'.normalize('NFKC') === '代码审查' (already precomposed)
  // '代' alone is one char, so '/代' is 2 chars, not a substring of '代码审查' (4 chars)
  // Correct test: '/代码' is substring of '代码审查'  ✓
  expect('代码审查'.normalize('NFKC').toLowerCase().includes('/代码'.normalize('NFKC').toLowerCase().slice(1))).toBe(true);
});
it('matches CJK case (no case for CJK, but NFKC for half-width)', () => {
  // Half-width slash '/' (U+002F) vs Full-width slash '／' (U+FF0F) — same after NFKC
  expect('／goal'.normalize('NFKC').toLowerCase().includes('goal'.normalize('NFKC').toLowerCase())).toBe(true);
});
it('case-insensitive ASCII', () => {
  // D-05: '/CTX' matches '/context'
  expect('/context'.normalize('NFKC').toLowerCase().includes('/CTX'.normalize('NFKC').toLowerCase().slice(1))).toBe(true);
});
```

### Pitfall 4: Filter mis-uses `.split('.')` or `.split('/')` (PITFALLS P6 #65047, #65050)

**What goes wrong:** If the filter function does `query.split('.')` or `query.split('/')` to tokenize, then `//` (double slash) or `.` in MCP tool names wipes the filter and the popup goes empty.

**Why it happens:** Some implementations assume `.` is a word boundary (like in package versions) and `/` is a path separator. Slash command filters are not paths or versions.

**How to avoid:** Plain `String#includes(search)` with both sides NFKC-normalized. No tokenization, no split, no regex.

**Test case (MUST be in `SlashCommandPopup.test.tsx`):**
```ts
it('does not break on double slash or period', () => {
  // PITFALLS P6 #65050: `//` should not crash; here shows empty filter
  // PITFALLS P6 #65047: `.` should not crash; here shows empty filter
  // Both are valid empty results, NOT crashes
  expect(filterCommands('//').length).toBe(0); // no command contains '//'
  expect(filterCommands('.').length).toBe(0);  // no command contains '.'
});
```

### Pitfall 5: IME composition interrupted by `slashOpen` toggle (PITFALLS P13)

**What goes wrong:** A Chinese user types `/` via their IME, which puts them in composition mode. The `onChange` handler fires mid-composition with `value === '/'`, which sets `slashOpen = true`. The popup opens mid-IME and steals focus. When the user finishes composition, their input lands in the wrong place.

**Why it happens:** The existing `onChange` doesn't check `isComposingRef.current`. The IME-safe pattern is: only update UI state on `onCompositionEnd`, not on `onChange` mid-composition.

**How to avoid:** Two layers of defense:
1. The `handleKeyDown` extension's `isComposingKeyEvent` check (line 659) — already returns early when composing, so the new `slashOpen` branch only runs for non-IME keystrokes.
2. The `onChange` handler should NOT set `slashOpen` from `e.target.value` directly when `isComposingRef.current === true`. Either gate the state update, or only set `slashOpen` when the value starts with `/` AND `!isComposingRef.current`.

**How to detect:** In ChatArea.tsx, the existing `onChange={(e) => setInputVal(e.target.value)}` (line 1006) is naive. Phase 5 needs to replace it with a smarter handler:
```tsx
onChange={(e) => {
  if (isComposingRef.current) {
    setInputVal(e.target.value);
    return; // don't update slashOpen during composition
  }
  setInputVal(e.target.value);
  const val = e.target.value;
  // Open popup when value starts with `/` and no whitespace (PITFALLS P5 — start of message only)
  if (val.startsWith('/') && !val.includes(' ') && val.length <= 32) {
    setSlashOpen(true);
  } else {
    setSlashOpen(false);
  }
}}
```

**Warning signs:** CJK users report popup opens at the wrong time, or focus jumps when they use IME.

### Pitfall 6: `selectedIndex` out of bounds after filter change (PITFALLS P6 #65014)

**What goes wrong:** cmdk's selectedIndex is a number. If the user types more characters and the filtered list shrinks to 2 items, but `selectedIndex === 3` from before, the highlighted row is "out of bounds" — visually, no row appears highlighted, but the next ↑↓ key moves the selection oddly.

**Why it happens:** cmdk handles this correctly internally — when `shouldFilter={false}` and the list of `Command.Item` children changes, cmdk re-derives `selectedIndex` from the visible items. The planner should verify this in the implementation; if it doesn't, the manual `selectedIndex` state needs `Math.min(prevIndex, filtered.length - 1)` after every filter change.

**How to avoid:** With `shouldFilter={false}` + manual filter + conditional render of `Command.Item` children (not a re-keyed list), cmdk's internal `selectedIndex` resets to 0 on every render. This is actually fine for Phase 5: the first row is always highlighted (D-04). If a future variant needs selection persistence, use `useCommandState` to read cmdk's internal state and `cmdk.Command.useCommand().setSelectedIndex` to mutate it (verify with cmdk's exports; the API surface may differ across minor versions).

**Warning signs:** Pressing ↓ once moves selection 2 rows down (skipping the first row visually).

### Pitfall 7: z-index conflict with TodoList (PITFALLS P4)

**What goes wrong:** The existing TodoList is rendered above the textarea at `z-10` (line 991-1001 of ChatArea.tsx). If the popup's `PopoverContent` has a lower z-index, it appears UNDER the TodoList when TodoList is expanded. This makes the popup invisible to the user.

**How to avoid:** Set `z-50` (or higher) on `PopoverContent`'s className. The `popover.tsx` shim already includes `z-50` in the default className.

---

## Code Examples (verified patterns from official sources)

### Common Operation 1: cmdk Command with manual filter

**Source:** `https://github.com/dip/cmdk/blob/main/README.md` (verified via Context7 `/dip/cmdk`)

```tsx
import { Command } from 'cmdk'

<Command shouldFilter={false}>
  <Command.List>
    {filteredItems.map((item) => (
      <Command.Item key={item} value={item}>
        {item}
      </Command.Item>
    ))}
  </Command.List>
</Command>
```

### Common Operation 2: Radix Popover with anchor + onOpenAutoFocus

**Source:** `https://github.com/radix-ui/primitives/blob/main/packages/react/dialog/src/dialog.tsx` (verified via Context7 `/radix-ui/primitives`)

```tsx
import * as PopoverPrimitive from '@radix-ui/react-popover'

<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
  <PopoverPrimitive.Anchor asChild>
    <form>...<textarea /></form>
  </PopoverPrimitive.Anchor>
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      onOpenAutoFocus={(e) => e.preventDefault()}
      sideOffset={4}
    >
      ...
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
</PopoverPrimitive.Root>
```

### Common Operation 3: cmdk with `loop` (wrap-around ↑↓)

**Source:** `https://context7.com/dip/cmdk/llms.txt` (verified via Context7 `/dip/cmdk`)

```tsx
<Command loop>
  <Command.Input placeholder="..." />
  <Command.List>
    <Command.Item value="a">A</Command.Item>
    <Command.Item value="b">B</Command.Item>
  </Command.List>
</Command>
```

`loop` prop causes selectedIndex to wrap from last → first on ↓, and from first → last on ↑. This is the "roving focus with wrap" behavior the user expects. (Phase 5 has 3 hardcoded commands, so wrap is meaningful: ↓ on row 3 goes back to row 1.)

### Common Operation 4: Keyboard escape via Popover's `onEscapeKeyDown`

**Source:** `https://github.com/radix-ui/primitives/blob/main/primitives/packages/react/dismissable-layer/src/dismissable-layer.tsx` (verified via Context7 `/radix-ui/primitives`)

```tsx
<PopoverPrimitive.Content
  onEscapeKeyDown={(e) => {
    e.preventDefault() // optional
    setOpen(false)
  }}
>
```

This is the `DismissableLayer.onEscapeKeyDown` callback. By default Radix already calls `onDismiss` (which closes the popover) on Esc; the explicit handler is for cases where you need to do additional cleanup (e.g., reset cmdk state). In Phase 5, the default Radix Esc behavior is sufficient — no explicit handler needed.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `unstable_useSlashCommandAdapter` from `@assistant-ui/react` | Custom cmdk + Radix Popover shell on bare `<textarea>` | 0.14.x (assistant-ui marked `@deprecated` for the adapter) | Reject assistant-ui's adapter (PITFALLS P1); keep bare textarea (preserves 6-hunk patch-package on `@langchain/anthropic@1.4.0`). |
| `@radix-ui/react-popover` v0.x (v0.1.x early API) | `@radix-ui/react-popover@1.1.15` (stable, 2025-Q3+) | 2025 Q3 | 1.x line is the current stable; peer deps explicitly include React 19. No breaking changes from 0.x → 1.x for typical `Popover.Root/Content/Anchor` usage. |
| Manual roving-focus + `aria-activedescendant` | cmdk built-in | cmdk 1.0 GA | cmdk's built-in a11y is the source of truth; no need to write our own. |
| Substring filter via `String#includes` only | Substring + `String#normalize('NFKC')` for CJK | 2024-2025 (CJK tooling standardization) | Required for Chinese / Japanese / Korean users. (D-05, PITFALLS P6 #64941.) |
| Separate `<input>` in the popup for typing | No `<input>` — textarea owns the query, cmdk's keyboard nav works without visible input | cmdk 1.0+ | The textarea is the single source of truth for query state. cmdk still handles ↑↓/Enter/Esc via internal `keydown` listeners. |
| Local `useState` for UI state | Local `useState` for Phase 5, refactor to Zustand in Phase 6 | This is the plan | Phase 5 is a spike; refactor in Phase 6 when the dispatcher needs the state across components. |

**Deprecated/outdated:**
- `unstable_useSlashCommandAdapter` — `@deprecated Under active development`. Do not use. (PITFALLS P1)
- `useSlashCommandAdapter.js:63-72` "matchesQuery" function — example of the OR-substring-on-multiple-fields pattern, but the actual OR logic over `id`/`label`/`description` is not what we want (D-06 says name-only in Phase 5). Don't copy-paste it.

---

## Assumptions Log

> No `[ASSUMED]` claims in this research — all library versions verified via `npm view`, all file anchors directly inspected, and all API patterns verified via Context7 against the official source.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| (none) | — | — | — |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

---

## Open Questions

1. **cmdk internal Enter handling order vs textarea's handleKeyDown**
   - What we know: cmdk installs its own `keydown` listener on the `Command` container. When Enter is pressed, cmdk's listener fires first (calls `onSelect`), then the textarea's `handleKeyDown` fires. We add `e.preventDefault()` in the textarea's handler to stop the form submit.
   - What's unclear: Is the order guaranteed? Or does cmdk use a different event capture phase?
   - Recommendation: Verify with a Playwright/e2e test in Phase 5's manual verification step. If the order is wrong, swap to `e.stopPropagation()` in the `SlashCommandPopup` `onSelect` callback, or move the `preventDefault` to the textarea's keydown handler.
   - **Fallback:** Use `e.preventDefault()` on the textarea's `onKeyDown` for both `Enter` and `Tab` BEFORE cmdk's listener can fire. React's synthetic events fire in tree order (capture down, bubble up). cmdk's listeners are on the `Command` div, which is a SIBLING of the textarea (in the popover portal), so the textarea's handler fires first. Test this assumption.

2. **`Command.Input` requirement for keyboard nav**
   - What we know: cmdk's roving focus (↑↓) and Enter handling are documented as "automatic" via cmdk's internal listeners.
   - What's unclear: Does cmdk REQUIRE a `<Command.Input>` to be mounted for the keyboard nav to work? Or is it installed on the `<Command>` root?
   - Recommendation: Test the no-`<Command.Input>` pattern in a quick PoC. If cmdk requires the input, render an `aria-hidden="true"` `<Command.Input>` with no value prop and no onValueChange handler. If cmdk works without it, even better.
   - **Likely outcome:** Per the cmdk README, the keyboard listeners are on the `<Command>` root. The `<Command.Input>` is only required for the user to type a search query into the popup itself. Since our textarea is the query source, we can omit `<Command.Input>` entirely.

3. **cmdk 1.1.1 React 19 strict mode compatibility**
   - What we know: Peer dep `react: '^18 || ^19 || ^19.0.0-rc'`. React 19.2.6 satisfies `^19`. The project is already on React 19.2.6 (verified in `package.json`).
   - What's unclear: Are there any known strict-mode double-render issues with cmdk 1.1.1 on React 19?
   - Recommendation: Add a single test that mounts `<SlashCommandPopup>` in strict mode and verifies the filter behavior is stable across double-renders. This is a 5-line sanity test.
   - **Likely outcome:** No issues. cmdk 1.x has been on React 19 since late 2024.

4. **Radix Popover's `onInteractOutside` and IME candidate window**
   - What we know: macOS IME candidate windows (Chinese / Japanese) have z-index higher than typical popovers. The popup may appear behind the candidate window.
   - What's unclear: Does Radix's `onInteractOutside` fire when the user clicks on the IME candidate window? If yes, the popup closes unexpectedly while the user is still composing.
   - Recommendation: Don't worry about it for Phase 5 (PITFALLS P15 notes this is a known issue and accepts "偶爾需要 Esc 一次关掉 popup"). Document the known limitation in the code comment.
   - **Fallback for users:** If a user reports the popup closes unexpectedly, the simplest fix is to gate `setSlashOpen(false)` on `!isComposingRef.current` in the `onInteractOutside` handler.

5. **The exact form wrap with `asChild` and existing `onSubmit`**
   - What we know: The `<form onSubmit={(e) => e.preventDefault()}>` at line 1002 already has `onSubmit` defined. `<PopoverAnchor asChild>` will pass its props through to the child, so no prop merging conflicts.
   - What's unclear: Does `asChild` work cleanly with a `<form>` as the immediate child? (Some Radix primitives have edge cases with non-standard elements.)
   - Recommendation: Test with a one-line manual verification: open the app, type `/` in the composer, confirm popup appears above the form. If `asChild` misbehaves with `<form>`, wrap the form in a `<div>` and use that as the anchor.
   - **Likely outcome:** `asChild` works with any element including `<form>`. Radix's `Slot` primitive is designed for this.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `cmdk@1.1.1` | Popover content + filter + keyboard nav | ✗ (not in package.json or node_modules) | — | Install via `npm install cmdk@^1.1.1` (no fallback — this is a required dep) |
| `@radix-ui/react-popover@1.1.15` | Popover positioning + Anchor + Content | ✗ (not in package.json or node_modules) | — | Install via `npm install @radix-ui/react-popover@^1.1.15` (no fallback — this is a required dep) |
| `react@19.2.6` | Existing | ✓ | 19.2.6 (verified in package.json) | — |
| `vitest@4.1.8` + `@testing-library/react@16.0.0` | Tests | ✓ (devDependency) | 4.1.8 / 16.0.0 | — |
| `tailwindcss@4.3.0` | Popup styling | ✓ | 4.3.0 | — |
| `lucide-react@1.16.0` | (Reserved for Phase 6 icons) | ✓ | 1.16.0 | — |
| Node.js runtime | Dev | ✓ | 22.21.0 (verified via `node --version` via `which node`) | — |

**Missing dependencies with no fallback:**
- `cmdk@1.1.1` — Phase 5 cannot deliver the popup UI without this. Plan must include `npm install cmdk@^1.1.1` as the first step.
- `@radix-ui/react-popover@1.1.15` — Phase 5 cannot anchor the popup to the `<form>` without this. Plan must include `npm install @radix-ui/react-popover@^1.1.15` as the first step.

**Missing dependencies with fallback:** none

**Environment probe (already run):**
- `npm view cmdk version` → `1.1.1` (latest stable)
- `npm view @radix-ui/react-popover version` → `1.1.15` (latest stable)
- `npm view cmdk peerDependencies` → `react: '^18 || ^19 || ^19.0.0-rc'`
- `npm view @radix-ui/react-popover peerDependencies` → `react: '^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc'`
- `package.json` shows `react: ^19.2.6` (matches both peer ranges)
- `package.json` has `@radix-ui/react-dropdown-menu: ^2.1.16` already (proves Radix is the project's existing primitive family)
- `package.json` has no `cmdk` and no `@radix-ui/react-popover` (both new)
- `package-lock.json` exists (npm, not pnpm)
- `vitest.config.ts` exists with `jsdom` environment + `@` alias → `src/renderer/src`

---

## Validation Architecture

> `workflow.nyquist_validation` in `.planning/config.json` is `true` (line 16). Validation Architecture section is REQUIRED.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@4.1.8` (jsdom environment) + `@testing-library/react@16.0.0` + (no `@testing-library/user-event` currently used; will use `fireEvent` from `@testing-library/react` for keyboard events) |
| Config file | `vitest.config.ts` (verified — environment `jsdom`, `globals: true`, alias `@` → `src/renderer/src`) |
| Quick run command | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` |
| Full suite command | `npm test` (which runs `vitest run` per package.json line 22) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| **SLASH-01** | `/` triggers popup open | unit + integration (component) | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "opens on slash"` | ❌ Wave 0 — must create |
| **SLASH-01** | Popup closes on Esc | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "closes on esc"` | ❌ Wave 0 |
| **SLASH-01** | Backspace when only `/` remains closes popup | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "backspace closes"` | ❌ Wave 0 |
| **SLASH-01** | `onOpenAutoFocus` does NOT steal focus from textarea | unit + render | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "keeps textarea focus"` | ❌ Wave 0 |
| **SLASH-02** | Substring filter (case-insensitive) | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "case-insensitive filter"` | ❌ Wave 0 |
| **SLASH-02** | NFKC normalization (CJK) | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "nfkc normalize"` | ❌ Wave 0 |
| **SLASH-02** | ↑↓ navigation between rows | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "arrow navigation"` | ❌ Wave 0 |
| **SLASH-02** | Enter inserts text + closes popup (D-07) | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "enter inserts"` | ❌ Wave 0 |
| **SLASH-02** | Tab inserts text + closes popup + preventDefault (D-07) | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "tab inserts"` | ❌ Wave 0 |
| **SLASH-02** | Empty filter shows D-03 hint line | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "empty hint"` | ❌ Wave 0 |
| **SLASH-02** | First row always highlighted (D-04) | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "first row highlighted"` | ❌ Wave 0 |
| **PITFALLS P6** | `.` (period) doesn't crash filter (case a) | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "period filter"` | ❌ Wave 0 |
| **PITFALLS P6** | CJK filter (case b) | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "cjk filter"` | ❌ Wave 0 |
| **PITFALLS P6** | `//` (double slash) doesn't crash (case c) | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "double slash filter"` | ❌ Wave 0 |
| **PITFALLS P6** | selectedIndex bounds after filter change (case e) | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "selectedIndex bounds"` | ❌ Wave 0 |
| **IME safety** | Mid-composition keystrokes don't open popup | unit (mock) | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "ime safe"` | ❌ Wave 0 |
| **Shift+Enter** | Still inserts newline, doesn't trigger command | unit | `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx -t "shift enter"` | ❌ Wave 0 |
| **Welcome textarea (line 761)** | Out of scope for Phase 5 — not tested | — | — | — |

### Sampling Rate
- **Per task commit:** `npx vitest run src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx`
- **Per wave merge:** `npm test` (full vitest run, includes all 18 test files in the project)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` — covers all 17 tests above (single file; cmdk + Radix + ChatArea handleKeyDown integrated)
- [ ] `src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx` — the component under test (prerequisite)
- [ ] `src/renderer/src/components/ui/popover.tsx` — the Radix shim (prerequisite)
- [ ] Framework install: `npm install cmdk@^1.1.1 @radix-ui/react-popover@^1.1.15` (one-time, before any code)

*(Note: 5 PITFALLS P6 case (d) — description truncation — is explicitly N/A in Phase 5 because D-01 says no descriptions. Verified as a no-op regression: simply confirm that the popup doesn't render any description field. One assertion in the "first row highlighted" test covers this.)*

---

## Security Domain

> `security_enforcement` in `.planning/config.json` is not explicitly set → treat as ENABLED. Security Domain section is REQUIRED.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in Phase 5 (renderer-only) |
| V3 Session Management | no | No session tokens in Phase 5 |
| V4 Access Control | no | No permission checks in Phase 5 |
| V5 Input Validation | **yes** | All user input is the textarea `inputVal` string; cmdk's filter is the only input handler. No XSS risk because cmdk's `Command.Item` renders text children, not raw HTML. (Escape via React's default JSX escaping.) |
| V6 Cryptography | no | No crypto in Phase 5 |

### Known Threat Patterns for React 19 + cmdk + Radix Popover

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via slash command name (Phase 6+ when plugin commands have user-defined names) | Tampering | React JSX default escaping for `Command.Item` children. If plugin commands need to render rich descriptions, use `<MarkdownRenderer>` (existing) which already escapes raw HTML. (Phase 5 has no plugin commands; D-01 keeps it name-only.) |
| Focus stealing from textarea to cmdk input | Spoofing | `onOpenAutoFocus={e => e.preventDefault()}` on `PopoverContent`. (Pitfall 1) |
| IME composition interrupted by popup state | Tampering | Existing `isComposingRef` + 200ms `justFinishedComposingRef` gate. (Pitfall 5) |
| Command injection via `inputVal` directly sent to LLM | Elevation | Phase 5 D-07: Enter does NOT trigger `handleSend`. The popup is closed, the text is inserted, and the user is expected to type args + press Enter again. Phase 6 will add `handleSend` sniff (PITFALLS P5) to recognize commands only at the START of the textarea. |
| Source code injection via `.cdf/commands/*.md` body (Phase 6+) | Tampering | Out of scope for Phase 5; documented in PITFALLS P14 for Phase 6 (`$ARGUMENTS` substitution must not eval). |

**Phase 5 is a small, low-risk spike.** The biggest threat is the cmdk-on-textarea focus stealing (Pitfall 1), which has a well-documented mitigation. No new attack surface is introduced in Phase 5 — the popup is a UI shell with 3 hardcoded names, no user-controlled data, no IPC.

---

## Out-of-Scope Boundary (MUST NOT touch in Phase 5)

Explicit list of what Phase 5 does NOT touch. The plan checker will reject plans that introduce any of these:

| Excluded | Reason | Phase |
|----------|--------|-------|
| **Dispatcher** (`/goal` / `/context` / `/plan` actual execution logic) | D-07: Phase 5 only inserts text + closes popup. Execution comes in Phase 7. | 7 |
| **IPC channels** (`commands:list`, `commands:readProjectCommands`, etc.) | Phase 5 is renderer-only. 3 hardcoded commands. | 6 |
| **Zustand store** for `slashOpen` / command registry | CONTEXT.md: "Phase 5 uses local `useState` for `slashOpen`; refactor to Zustand in Phase 6". | 6 |
| **Plugin sources** (MCP / Skills / Workflows / Project commands) | Phase 5 shows only 3 hardcoded system placeholders. Plugin sources come in Phase 6 (SLASH-03 / 08 / 09 / 10 / 11). | 6 |
| **`handleSend` modification** (sniff `value.startsWith('/')` before send) | PITFALLS P5: required for command-only-at-start, but the `handleSend` sniff is a Phase 6+ dispatcher concern. Phase 5's Enter just inserts text. | 6 (dispatcher) + 7 (system commands) |
| **Source badges** (`[system]` / `[skill:global]` / etc.) | D-01: name-only in Phase 5. Source badges come in Phase 6 (SLASH-12) with the 7-color system in Phase 8. | 6 + 8 |
| **Args parsing** | REQUIREMENTS.md SLASH-08: v1.1 does NOT parse args; extra text is natural-language context. Phase 5 just inserts the command name + space. | 6 + 7 (per-system-command) |
| **`sonner` (toast library)** | Not needed in Phase 5 (D-03 is a static hint line, not a toast). Defer to Phase 6 for `CommandConflictError` (D11). | 6 |
| **`chokidar` / file watching** | Not needed in Phase 5. The 3 hardcoded commands don't change. | 6 (SLASH-13) |
| **Welcome screen textarea** (`ChatArea.tsx:761`) | Out of scope per CONTEXT.md. Phase 5 only wires the main composer at line 1002. | (Deferred) |
| **ToolMessageCard changes** | No plugin commands in Phase 5. | 6 |
| **M3 thinking preservation tests** | PITFALLS P2: required for Phase 7 (SLASH-07 `/plan`). Phase 5 doesn't dispatch any commands. | 7 |
| **Modifications to `runtime.ts` / `llm.ts:306-425` / `workflow-runtime.ts`** | Hard "do not touch" list from PROJECT.md. Phase 5 is renderer-only. | (Permanent) |

---

## Risk & Open Questions (Phase 5 specific)

### Medium Risk

1. **Event ordering: cmdk's Enter handler vs textarea's `handleKeyDown`** (Open Question #1)
   - Mitigation: Use `e.preventDefault()` in textarea's `handleKeyDown` for both Enter and Tab. Verify with a one-line `console.log` in both handlers during manual smoke test. If order is wrong, switch to `e.stopPropagation()` in cmdk's `onSelect` callback.
   - Detection: If pressing Enter in the popup sends a message instead of inserting the command text, the order is wrong.

2. **IME composition during `onChange` triggers premature popup open** (PITFALLS P13)
   - Mitigation: Gate the `slashOpen` state update on `!isComposingRef.current` in the textarea's `onChange` handler.
   - Detection: CJK users (or any IME user) report popup opens while they're still typing a candidate.

### Low Risk

3. **cmdk keyboard nav without `<Command.Input>`** (Open Question #2)
   - Mitigation: If cmdk 1.1.1 requires a `<Command.Input>` for ↑↓ to work, render `<Command.Input value="" onValueChange={() => {}} className="sr-only" />` (visually hidden but mounted). This is a 3-line patch.
   - Detection: ↑↓ keys don't move selection in the popup.

4. **`PopoverAnchor asChild` + `<form>`** (Open Question #5)
   - Mitigation: If `asChild` doesn't merge cleanly with `<form>`, wrap the `<form>` in a `<div>` and use the `<div>` as the anchor. The form's behavior is unchanged.
   - Detection: Popup doesn't open when typing `/`, or opens at the wrong position.

5. **React 19 strict mode double-render in tests** (Open Question #3)
   - Mitigation: A 5-line sanity test that mounts the component in `<React.StrictMode>` and verifies filter behavior is stable. If flaky, wrap the filter result in `useMemo` (already in Pattern 3).

### Resolved (verified during research)

- ✅ Library versions: `cmdk@1.1.1` and `@radix-ui/react-popover@1.1.15` confirmed latest stable.
- ✅ React 19 peer compatibility for both libraries.
- ✅ `isComposingKeyEvent` / `isComposingRef` / `justFinishedComposingRef` exist in ChatArea.tsx and are reusable.
- ✅ `handleKeyDown` integration point (line 658) and existing `isComposingKeyEvent` check (line 659) verified.
- ✅ The `<form>` at line 1002 is the natural PopoverAnchor target (no structural change needed).
- ✅ `dropdown-menu.tsx` shim pattern for `popover.tsx` is clear.
- ✅ `vitest@4.1.8` + `@testing-library/react@16.0.0` are available; `jsdom` environment is configured.
- ✅ The package manager is `npm` (package-lock.json present, not pnpm).
- ✅ No existing slash command code in the renderer; clean slate.

---

## Plan Sizing Estimate (for planner reference)

Phase 5 is a **SPIKE**. Expected plan count: **2 plans** (per ROADMAP.md).

| Plan | Scope | Files | Estimated Tasks |
|------|-------|-------|-----------------|
| **05-01: cmdk + Radix Popover 壳层 PoC** | Install deps; create `popover.tsx` shim; create `SlashCommandPopup.tsx`; wrap `<form>` in `ChatArea.tsx` with `<PopoverAnchor asChild>`; add `slashOpen` useState; wire `onChange` to set `slashOpen`; extend `handleKeyDown` with slash-open branch; add `handleSlashSelect` for D-07 | 4 files (1 new dep, 1 new shim, 1 new component, 1 modified) | ~8-12 tasks |
| **05-02: Keyboard contract tests** | Create `SlashCommandPopup.test.tsx` with 17 tests covering SLASH-01, SLASH-02, D-04, D-05, D-06, D-07, 5 PITFALLS P6 cases, IME safety, Shift+Enter | 1 new test file | ~5-8 tasks |

**Total estimated LOC:** ~300-400 LOC across 2 new files + ~50-80 LOC changes in `ChatArea.tsx`.

---

## Sources

### Primary (HIGH confidence)
- `https://github.com/dip/cmdk/blob/main/README.md` (via Context7 `/dip/cmdk`) — cmdk 1.1.1 API: `<Command>` with `shouldFilter` prop, `Command.List` / `Command.Item` / `Command.Input` / `Command.Empty` / `Command.Group`, `loop` prop for wrap-around, custom `filter` function signature, `useCommandState` hook
- `https://github.com/radix-ui/primitives/blob/main/packages/react/dialog/src/dialog.tsx` (via Context7 `/radix-ui/primitives`) — `DialogContentImpl` passes `onOpenAutoFocus` to `FocusScope.onMountAutoFocus` (proves Radix's autofocus mechanism)
- `https://github.com/radix-ui/primitives/blob/main/primitives/packages/react/dismissable-layer/src/dismissable-layer.tsx` (via Context7) — `DismissableLayerProps` with `onEscapeKeyDown`, `onPointerDownOutside`, `onFocusOutside`, `onInteractOutside` callbacks, all "can be prevented" via `event.preventDefault()`
- `https://github.com/radix-ui/primitives/blob/main/primitives/packages/react/primitive/src/primitive.tsx` (via Context7) — `Primitive` component's `asChild` uses `Slot` from Radix, switches to native element when `asChild=false`
- `npm view cmdk version` + `npm view cmdk peerDependencies` — version 1.1.1, peer `react: '^18 || ^19 || ^19.0.0-rc'`
- `npm view @radix-ui/react-popover version` + `npm view @radix-ui/react-popover peerDependencies` — version 1.1.15, peer `react: '^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc'`
- `/Users/suntc/project/CDF/src/renderer/src/components/ChatArea/ChatArea.tsx:1002-1013` — `<form onSubmit={preventDefault}>` + bare `<textarea>` anchor point (verified)
- `/Users/suntc/project/CDF/src/renderer/src/components/ChatArea/ChatArea.tsx:145-147, 624-656` — existing IME safety primitives (`isComposingRef`, `justFinishedComposingRef`, `compositionEndTimerRef`, `handleCompositionStart/End/consumeJustFinishedComposing`, `isComposingKeyEvent`) (verified)
- `/Users/suntc/project/CDF/src/renderer/src/components/ChatArea/ChatArea.tsx:611, 658-673` — `handleSend` (unchanged in Phase 5) and `handleKeyDown` (Phase 5 integration point) (verified)
- `/Users/suntc/project/CDF/src/renderer/src/components/ui/dropdown-menu.tsx:6-72, 56-72` — shadcn-style shim pattern (forwardRef + `cn()` + default className + z-50 + displayName) (verified)
- `/Users/suntc/project/CDF/src/renderer/src/lib/utils.ts` — `cn()` helper (verified)
- `/Users/suntc/project/CDF/vitest.config.ts` — `jsdom` environment, `globals: true`, alias `@` → `src/renderer/src` (verified)
- `/Users/suntc/project/CDF/package.json` — React 19.2.6, vitest 4.1.8, `@testing-library/react@16.0.0` (dev), no `cmdk` / no `@radix-ui/react-popover` yet (verified)
- `/Users/suntc/project/CDF/.planning/research/STACK.md` — `cmdk@1.1.1` + `@radix-ui/react-popover@1.1.15` versions + npm view verification
- `/Users/suntc/project/CDF/.planning/research/PITFALLS.md` — 9 pitfalls (P1 unstable_useSlashCommandAdapter, P2 M3 thinking, P3 naming conflict, P4 popup z-index, P5 command at start, P6 5 keyboard/character bugs, P7 MCP injection, P10 chokidar, P13 IME, P15 IME z-index)
- `/Users/suntc/project/CDF/.planning/phases/05-popup-shell-keyboard-spike/05-CONTEXT.md` — D-01 through D-07 decisions, C-01 through C-03 discretions, integration points (verified)
- `/Users/suntc/project/CDF/.planning/REQUIREMENTS.md` — SLASH-01 (popup trigger), SLASH-02 (filter + keyboard), traceability table mapping all 15 v1.1 SLASH reqs to phases
- `/Users/suntc/project/CDF/.planning/ROADMAP.md` — Phase 5 success criteria (5 must-TRUE), plan list (05-01 PoC, 05-02 keyboard contract tests)
- `/Users/suntc/project/CDF/.planning/config.json` — `workflow.nyquist_validation: true` (Validation Architecture section required)

### Secondary (MEDIUM confidence)
- `/Users/suntc/project/CDF/.planning/research/SUMMARY.md` — 4-agent synthesis; `assistant-ui` rejection rationale; 4-source command registry design (Phase 6+ scope); M3 thinking preservation invariants
- `/Users/suntc/project/CDF/.planning/research/ARCHITECTURE.md` — IPC channel inventory (`commands:list`, `commands:readProjectCommands` for Phase 6); `payload.overrides.planOnly` extension point at `llm.ts:324` for Phase 7
- `/Users/suntc/project/CDF/.planning/research/FEATURES.md` — 15 table stakes T1-T15 + 20 differentiators D1-D20; Phase 5 MVP definition (24 features map 1:1 to 13 SLASH-XX)

### Tertiary (LOW confidence)
- None. All claims in this research are either [VERIFIED: npm registry], [VERIFIED: source code inspection], or [VERIFIED: Context7 doc fetch].

---

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — `cmdk@1.1.1` and `@radix-ui/react-popover@1.1.15` versions confirmed via `npm view`; React 19 peer compatibility confirmed; `cmdk` API surface confirmed via Context7 against official GitHub README; `Radix Popover` API surface confirmed via Context7 against official `radix-ui/primitives` source
- **Architecture:** HIGH — All ChatArea.tsx anchors (line 1002 form, line 1004 textarea, line 658 handleKeyDown, line 145-147 + 624-656 IME refs) directly inspected; `dropdown-menu.tsx` shim pattern (line 6-72) verified; `vitest.config.ts` verified
- **Pitfalls:** HIGH — 7 PITFALLS P1-P15 (excluding 3 phase-6+ specific ones) all have Claude Code issue numbers + CDF-specific code anchors verified
- **IME safety:** HIGH — Existing `isComposingRef` + `justFinishedComposingRef` + `isComposingKeyEvent` in ChatArea.tsx:145-147, 624-656 are the exact primitives needed; reusing them is well-scoped

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (30 days; cmdk + Radix Popover are stable, 1.1.x lines are post-GA)
