# Phase 5: Popup Shell + Keyboard Spike - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

在现有 `ChatArea.tsx:1004` 裸 `<textarea>` 上叠加 cmdk + Radix Popover 的 `/` 命令 popup **壳层**（shell），验证技术路径可行并锁定键盘导航契约。**Phase 5 是 SPIKE，不接 dispatcher / IPC / 插件源**——只交付 popup UI 层与 5 系统占位行的硬编码渲染（3 系统命令 + 描述提示占位），不接任何插件数据流。

In scope: cmdk + Radix Popover 集成；3 系统命令静态显示；`/` 触发 + 过滤 + ↑↓ Enter Esc 键盘契约；IME 健壮性；PITFALLS P6 5 case 回归契约。
Out of scope: dispatcher / IPC / 4 源插件采集（属 Phase 6）；M3 thinking preservation 验证（属 Phase 7 SLASH-REGRESSION）；命令 args 解析（v1.1 全部插件命令不传 args）。

</domain>

<decisions>
## Implementation Decisions

### Row content (popup each row displays)

- **D-01:** Each row displays **only the command name** (e.g., `/goal`, `/context`, `/plan`). No description, no source badge, no keybind hint. **极致简** for Phase 5 SPIKE. Subsequent phases (Phase 6+) can add description + source badge + keybind hint without breaking this baseline.

### Empty state + no-commands case

- **D-02:** Popup **always shows 3 hardcoded system placeholders** (`/goal` `/context` `/plan`) when first opened, even if no plugin commands are registered. This gives a stable visual baseline.
- **D-03:** When user types a filter that **matches nothing**, popup shows an **interactive hint placeholder** line (e.g., `试试输入 /goal · /context · /plan 查看可用命令` or `无匹配命令`). Not empty rows. Provides feedback that the popup is alive and guides the user.

### Selection persistence across popup opens

- **D-04:** Every time popup reopens, the **first row (top) is always highlighted**. No memory of the last selected row. Maximally predictable. cmdk's default behavior. This is the simplest choice; can revisit in v1.2 polish phase if users want frecency.

### Filtering strategy

- **D-05:** Filtering is **substring + case-insensitive + NFKC-normalized** on the command name. E.g., `/go` matches `/goal`; `/CTX` matches `/context`; `/上文` matches `/context` (NFKC for CJK compatibility). **Not fuzzy** (skipping chars). Matches Claude Code's behavior and is the simplest mental model.
- **D-06:** Filter searches **only command name**, not description. Description-based search deferred to a future phase (would require descriptions to exist; in Phase 5 there are none).

### Tab/Enter selection completion (command text insertion)

- **D-07:** Both **Tab** and **Enter** keys have **identical behavior** in Phase 5 SPIKE: insert the highlighted command text (e.g., `/goal`) into the textarea, **close the popup**, and **do not execute** the command. `e.preventDefault()` is required for Tab to override textarea's default focus-shift behavior. In Phase 2+ when the dispatcher is wired, Enter will diverge from Tab — Enter will trigger command execution (dispatcher flow), while Tab continues to just complete text without firing. Phase 1 SPIKE = "Tab and Enter are the same; insert text + close popup".

### Claude's Discretion

- **C-01:** The exact text of the "interactive hint placeholder" (D-03) is left to Claude — pick a clear, short hint that fits CDF's tone.
- **C-02:** The visual position of the popup (above vs below textarea) is left to Claude — Claude Code style is below-textarea anchored; Radix Popover supports both. Default to below, can flip if needed for small viewports.
- **C-03:** Whether to use `cmdk.Command.List` vs `cmdk.Command.Group` for the 3 system placeholders is left to Claude — they're functionally similar; pick whichever is cleaner.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.1 Milestone Artifacts

- `.planning/PROJECT.md` — v1.1 Current Milestone section, "What This Is", Core Value, Constraints
- `.planning/REQUIREMENTS.md` — SLASH-01 (popup trigger), SLASH-02 (filter + keyboard), SLASH-12 (naming conflicts), SLASH-13 (registry refresh); MCP args semantics (extra text = natural-language context)
- `.planning/ROADMAP.md` §"Phase 5: Popup Shell + Keyboard Spike" — Goal, Requirements, Success Criteria, Plan list
- `.planning/research/SUMMARY.md` — 4-agent research synthesis: stack, architecture, pitfalls, features
- `.planning/research/STACK.md` — `cmdk@1.1.1` + `@radix-ui/react-popover@1.1.15` versions + npm view verification
- `.planning/research/ARCHITECTURE.md` — integration with existing ChatArea.tsx, IPC channel inventory, `payload.overrides` extension point at `llm.ts:324`
- `.planning/research/FEATURES.md` — table stakes (T1-T15) for `/` popup UX
- `.planning/research/PITFALLS.md` — 9 critical pitfalls to avoid in Phase 5 (especially P1 trap of `unstable_useSlashCommandAdapter`, P6 keyboard/character bugs, P5 message-start detection)

### v1.0 Codebase Anchors

- `src/renderer/src/components/ChatArea/ChatArea.tsx:1004-1014` — main composer `<textarea>` with `value={inputVal}`, `onChange`, `onCompositionStart/End`, `onKeyDown={handleKeyDown}`, `placeholder="给 Master Agent 发送消息..."`. Wrapped in `<form onSubmit={(e) => e.preventDefault()}>` — this form is the natural `<PopoverAnchor asChild>` target.
- `src/renderer/src/components/ChatArea/ChatArea.tsx:611` — `handleSend` function: where to add the "is this a `/` command?" sniff (after the existing IME check, before the actual send)
- `src/renderer/src/components/ChatArea/ChatArea.tsx:658-675` — `handleKeyDown` function: where to intercept `Enter`/`↑↓` when popup is open (popup open → textarea keyboard events go to cmdk instead)
- `src/renderer/src/components/ChatArea/ChatArea.tsx:761` — welcome screen textarea (different from main composer at 1004; not in Phase 5 scope but good to know)
- `src/renderer/src/components/ui/badge.tsx` — existing shadcn-style `<Badge>` component for source badges (NOT used in Phase 5 per D-01, but available for Phase 6+)
- `src/renderer/src/components/ui/dropdown-menu.tsx` — existing shadcn-style Radix-based pattern (uses Radix DropdownMenu; Radix Popover follows same wrapper style)
- `src/renderer/src/stores/sessionStore.ts` — Zustand store; future Phase 5/6/7 add `slashOpen` state, `sessionGoals` Map, etc.
- `src/shared/types.ts` — where to add `SlashCommand`, `CommandDispatchAction`, `CommandSource` types in Phase 6

### External Library Docs

- `cmdk@1.1.1` — `Command` primitive + `Command.List`/`Command.Item`/`Command.Input`; `shouldFilter` prop; `onOpenAutoFocus` callback; cmdk wraps React's `roving-focus` for ↑↓ navigation
- `@radix-ui/react-popover@1.1.15` — `Popover.Root`/`Popover.Trigger`/`Popover.Content`/`Popover.Anchor` (use `asChild` to wrap our form); `onOpenAutoFocus` callback to call `e.preventDefault()`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`<Badge>` component** (`src/renderer/src/components/ui/badge.tsx`): shadcn-style, accepts className prop, CSS variables from theme. Phase 5 doesn't use it (D-01) but Phase 6+ will for source badges.
- **Existing form wrapper**: ChatArea's main composer is already inside `<form onSubmit={preventDefault}>` — perfect `<PopoverAnchor asChild>` target, no structural change needed.
- **IME safety primitives**: `isComposingRef`, `justFinishedComposingRef`, `isComposingKeyEvent` are already in ChatArea. The new `handleKeyDown` branch for popup intercept just needs to call `isComposingKeyEvent(e)` first; do NOT re-implement IME detection.
- **CustomSelect / DropdownMenu shadcn pattern**: `src/renderer/src/components/ui/dropdown-menu.tsx` shows the project's Radix wrapper conventions (cn() className, Radix primitives, theme CSS variables). Use as the reference for `popover.tsx` shim.
- **Existing `useSlashCommandStore` will be added** in Phase 6 (not Phase 5). Phase 5 can use local `useState` in ChatArea for `slashOpen` boolean; refactor to Zustand store in Phase 6.

### Established Patterns

- **shadcn-style `cn()` className utility**: import from `src/renderer/src/lib/utils`; combine Tailwind classes with `cn()` for conditional styling.
- **Radix primitives wrap pattern**: each Radix-based component lives in `src/renderer/src/components/ui/{name}.tsx` and re-exports the sub-components. Following the pattern, the new `popover.tsx` shim goes there.
- **Theme CSS variables**: `var(--color-bg-surface)`, `var(--color-border)`, `var(--color-accent)` etc. Use these instead of hardcoded colors for theme consistency.
- **No new dev deps beyond `cmdk` + `@radix-ui/react-popover`**: 2 packages only. `sonner` deferred to Phase 6 (when we need `CommandConflictError` toast).

### Integration Points

- **`src/renderer/src/components/ChatArea/ChatArea.tsx`**: The ONLY production source file Phase 5 modifies. Two specific insertion points: (1) the composer `<form>` (line 1002) to add `<PopoverAnchor asChild>` and `<SlashCommandPopup>`; (2) `handleKeyDown` (line 658) to intercept ↑↓/Enter/Esc when popup open.
- **`src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx`**: new file. cmdk `<Command>` wrapper, hardcoded 3 system placeholders, filter logic, keyboard nav.
- **`src/renderer/src/components/ui/popover.tsx`**: new shim file. Thin re-export of `@radix-ui/react-popover` following the dropdown-menu shim pattern.
- **`src/renderer/src/stores/`**: NO new file in Phase 5. Phase 6 adds `slashCommandStore.ts`.
- **No `src/main/` changes**: Phase 5 is renderer-only. No IPC, no main process.
- **No `package.json` new deps in Phase 5**: `cmdk` + `@radix-ui/react-popover` are both already transitive (verifiable via `npm ls`); just need to add as direct deps in package.json.

</code_context>

<specifics>
## Specific Ideas

- **"极致简"** 是 v1.1 的核心 design philosophy. Phase 5 SPIKE 拒绝 over-engineer. If something feels "too much for a SPIKE", drop it.
- The user explicitly chose "**仅命令名**" for row content over "名+描述" or "名+描述+源 badge" — even though the 7-color source badge system is already designed in ROADMAP.md, Phase 5 holds off on it. Phase 6+ will add description + badge.
- The user explicitly chose "**每次重置到顶**" for selection reset over persistence — maximizes predictability. Frecency ordering is in `Future Requirements` (SLASH-16) for v1.2.
- The user explicitly chose "**substring**" for filtering over "fuzzy" — simplest mental model, Claude Code compatible.
- **"3 系统占位 + 占位交互提示"** for empty state — the placeholders are stable anchors; the hint message is a single inline row (not a separate UI element) to keep the popup simple.

</specifics>

<deferred>
## Deferred Ideas

### From this discussion

- **Args parsing for plugin commands** (per SLASH-08 v1.1 design, extra text is appended as natural-language context, NOT parsed as args) — already locked in REQUIREMENTS.md, no further action needed here
- **Description column in popup rows** (would be added in Phase 6+ when plugin commands have descriptions)
- **Source badge column** (would be added in Phase 6 when plugin registry is wired)
- **Frecency-based ordering** (SLASH-16 in Future Requirements, v1.2+)
- **Description search filter** (would require descriptions to exist; not in Phase 5 scope)
- **Active filter highlight** (e.g., bold the matched substring within the row) — would be a nice-to-have in v1.2 polish
- **Arrow-down from textarea when popup open at end-of-list** (cmdk default behavior; just verify in implementation)
- **Search by description keyword** (e.g., "上下文" → `/context`) — requires descriptions to exist; deferred

### Noted in passing

- **`/goal` SQLite persistence** (SLASH-15) — Phase 3 in v1.1, in-memory for now
- **MCP args schema form** (SLASH-14) — v1.2+ when MCP commands need args
- **Project custom command authoring UX** (SLASH-21) — v1.2+
- **Voice input fallback for popup** (SLASH-22) — v1.2+

</deferred>

---

*Phase: 5-Popup Shell + Keyboard Spike*
*Context gathered: 2026-06-04*
