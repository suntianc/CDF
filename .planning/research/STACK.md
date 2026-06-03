# Stack Research — v1.1 `/` Command Popup

**Domain:** Renderer-side slash command palette for Master Agent chat input
**Researched:** 2026-06-04
**Confidence:** HIGH (cmdk + Radix Popover versions verified via npm registry; assistant-ui primitives confirmed in installed v0.14.5; existing ChatArea implementation inspected)

---

## Executive Summary

The existing `ChatArea.tsx` uses a **custom `<textarea>`** with manual `onChange` / `onKeyDown` / `setInputVal` — `@assistant-ui/react@0.14.5` is installed but **NOT actually wired in the renderer** (no `ComposerPrimitive`, no `ThreadPrimitive`, no `useLocalRuntime` anywhere in `src/`). This is the most important finding: the v1.1 work does NOT need to integrate with assistant-ui's chat model. It only needs a **popover anchored to the custom textarea**.

The recommended stack is **`cmdk@1.1.1` + `@radix-ui/react-popover@1.1.15`**, following the exact shadcn-style wrapper pattern already used for `dropdown-menu.tsx` and `dialog.tsx` in `src/renderer/src/components/ui/`. This combination delivers:
- cmdk's built-in fuzzy filter, ↑↓ navigation, Enter/Escape handling
- Radix Popover's portal + collision-aware positioning over the textarea
- Zero refactor of the existing v3 `streamEvents` flow (M3 thinking preserved untouched)

**Deliberately NOT used:** assistant-ui's `unstable_useSlashCommandAdapter` / `ComposerPrimitive.Unstable_TriggerPopover`. It is marked `unstable_` in 0.14.5 and would require adopting `<AssistantRuntimeProvider>` + a custom `ChatModelAdapter`, which would replace the entire current chat pipeline (which is built around `runtime.agent.streamEvents v3` with the M3 thinking patch). Rejecting this keeps the change scope small and stable.

---

## Recommended Stack

### Core (add to `dependencies`)

| Library | Version | Purpose | Why |
|---|---|---|---|
| `cmdk` | `^1.1.1` | Command list, fuzzy filter, keyboard nav, ⏎ selection | De-facto React command palette lib (used by shadcn/ui's `command` component, Linear, Raycast, Vercel). Roving-focus built in, ↑↓/Enter/Esc handled internally, zero-config fuzzy match. ~8 kB gzipped. Peer: react ^18 \|\| ^19 (verified). |
| `@radix-ui/react-popover` | `^1.1.15` | Positioning portal anchored to textarea | Already a transitive dep (1.1.15 in `node_modules`) but not in `package.json`. Radix Popover gives `PopoverAnchor` for cursor-anchored placement, `PopoverPortal` to escape any `overflow: hidden` on chat scroll, collision avoidance. Matches the existing shadcn-style pattern in `ui/dropdown-menu.tsx`. |

### Existing (no change)

| Library | Version (installed) | Use in v1.1 |
|---|---|---|
| `@assistant-ui/react` | `0.14.5` | **Not used** for v1.1 (see "What NOT to use" below) |
| `zustand` | `5.0.13` | New `slashCommandStore` (command registry, popup open state) |
| `zod` | `4.4.3` | Argument schema for plugin commands (shared with `@langchain/mcp-adapters`) |
| `lucide-react` | `1.16.0` | Icons in popup rows (per-source icon: `Goal`, `BookOpen`, `ListTree`, `Plug`, `Wand2`, `FolderOpen`) |
| `react` | `19.2.6` | Standard |
| `tailwindcss` | `4.3.0` | Popup styling (no new design system work) |

### No New Dev Dependencies

- `vitest`/`@testing-library/react` already cover component tests
- `tsc` already strict — no `ts-expect-error` plumbing needed

---

## Architecture Integration Points

### Renderer (`src/renderer/src/`)

**New files:**

```
src/renderer/src/components/SlashCommand/
  SlashCommandPopup.tsx          # cmdk <Command> wrapped in Radix <Popover>
  SlashCommandPopup.test.tsx     # filter + ↑↓/Enter/Esc behavior
  commandRegistry.ts             # static system commands + dynamic plugin loaders
  useSlashCommands.ts            # hook: returns merged registry + open state
  types.ts                       # SlashCommand, SlashCommandSource discriminated union
src/renderer/src/components/ui/
  popover.tsx                    # shadcn-style Radix wrapper (mirror dropdown-menu.tsx)
src/renderer/src/stores/
  slashCommandStore.ts           # zustand: open flag, query, selected index
```

**Modified files:**

- `src/renderer/src/components/ChatArea/ChatArea.tsx`
  - Wrap the `<form>` in `<PopoverAnchor>` so the popup floats above the textarea
  - Pass `inputVal` (via store) to `<SlashCommandPopup>`
  - Extend `handleKeyDown` (line 658) to early-return on ⏎ / ↑ / ↓ when `slashOpen === true`
  - On ⏎-via-popup: call `command.execute(args, ctx)` instead of `handleSend()`

**Pattern for key interception (keeps the existing custom textarea intact):**

```tsx
const slashOpen = useSlashCommandStore(s => s.open);

const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (isComposingKeyEvent(e)) return;
  if (slashOpen) {
    // cmdk handles Enter/↑↓/Esc via its own listeners on Command.Input.
    // The textarea Enter must be swallowed so handleSend() does not fire.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); return; }
    return; // ↑↓ handled by cmdk, do not let textarea see them
  }
  // existing code path...
  if (e.key === 'Enter' && !e.shiftKey) { ... handleSend() }
};
```

`/` detection lives in the `onChange` handler — set `slashOpen = true` and `query = inputVal.slice(1)` only when `inputVal.startsWith('/')` AND cursor at index 1. The constraint "command only recognized at message start" is enforced here, not in cmdk.

### Main process (`src/main/`)

**New IPC channels (extend `src/main/ipc-handlers.ts` and `src/preload/index.ts`):**

| Channel | Direction | Purpose | Notes |
|---|---|---|---|
| `slash:listMcpTools` | renderer→main | List `[{serverId, name, description}]` for command registry | Reuses `loadMcpTools(agentId, projectId)` at `src/main/deepagent/mcp-connector.ts:129` |
| `slash:listSkills` | renderer→main | List skill commands | Reuses `listSkills()` already in `skill-manager.ts` |
| `slash:listWorkflows` | renderer→main | List workflow commands for the project | New: SELECT id, name, description FROM workflows |
| `slash:readProjectCommands` | renderer→main | Read `.claude/commands/*.md` for the project | New: readdir + parse frontmatter (uses `fast-xml-parser` style for YAML, or hand-roll since format is trivial) |
| `slash:invokePlugin` | renderer→main | Execute a non-LLM plugin command | Body: `{source, id, args}`; returns `{ok, result, executionId?}` |

**Critical: do NOT route plugin commands through `llm:chat` / `streamEvents`.**

The v1.1 architecture has **two execution paths from the input box**:

1. **Natural language** → existing `llm:chat` IPC → `runLLMChat()` → `runtime.agent.streamEvents` (M3 thinking, checkpoint, full deepagents loop). This path is **unchanged**.
2. **`/` command** → `slash:invokePlugin` IPC (or renderer-direct for `/goal`/`/context`) → calls the underlying tool/skill/workflow directly, **rendered in the chat as a tool-call UI** (existing `ToolMessageCard.tsx`) and **not fed back into `streamEvents`**.

This split is what preserves M3 thinking: `streamEvents v3` and the 6-hunk patch-package on `@langchain/anthropic@1.4.0` (per `STATE.md`) are untouched. The plugin command result is appended to the chat as an assistant message via a new `plugin_result` event type on the existing `sender.send(channel, ...)` bus, which the renderer's existing `run_started`/`message_chunk` listener (`useChatScroll`, `MessageItem`) already handles — it just needs one new case in the message type union.

**Note on `/plan`:** the spec says "Master Agent 切只规划不执行". This is a **system command**, handled in the renderer (set a `planOnly` flag on the chat store), then the next `llm:chat` invocation passes `payload.overrides = { planOnly: true }`. The existing `runtime.ts` already accepts `overrides` (line 324 of `llm.ts`). `planOnly` becomes a new optional boolean on the overrides type in `shared/types.ts` — no change to `streamEvents` itself.

---

## TypeScript Types to Add

Add to `src/shared/types.ts` (or new `src/shared/slashCommands.ts`):

```ts
// Discriminated union by source — exhaustive switch in commandRegistry.ts.
export type SlashCommandSource = 'system' | 'mcp' | 'skill' | 'workflow' | 'project';

export interface SlashCommand {
  /** Unique across all sources. For 'mcp' this is `${serverId}:${toolName}` to avoid cross-server collisions. */
  readonly id: string;
  readonly source: SlashCommandSource;
  /** What shows in the popup row. e.g. "goal" (without leading /). */
  readonly label: string;
  /** Subtitle in the popup row. */
  readonly description: string;
  /** lucide-react icon name. e.g. "Goal", "Plug", "Wand2". */
  readonly iconName: string;
  /** Placeholder shown in the textarea after the command is inserted. e.g. "[condition]". */
  readonly argsHint?: string;
  /** Per-command argument schema (zod). Optional — system commands may not need it. */
  readonly argsSchema?: import('zod').ZodTypeAny;
  /**
   * Dispatch path:
   *  - 'system' → execute in renderer (state mutation)
   *  - 'mcp' | 'skill' | 'workflow' → IPC to main, tool/skill/workflow runs, result rendered as tool card
   *  - 'project' → IPC to main, .claude/commands/<id>.md read, body injected as a user message into llm:chat
   */
  readonly execute: (args: string, ctx: CommandContext) => Promise<CommandResult>;
}

export interface CommandContext {
  projectId: string;
  sessionId: string;
  agentId?: string;
  sender: CommandResultSender; // helper to stream 'plugin_result' events on the existing IPC bus
}

export type CommandResult =
  | { kind: 'silent' }                                      // /goal, /context
  | { kind: 'plan_only'; args: string }                     // /plan — sets planOnly flag, next send uses plan path
  | { kind: 'tool_call'; toolName: string; result: unknown; durationMs: number }  // mcp/skill
  | { kind: 'workflow_started'; executionId: string }       // workflow
  | { kind: 'message'; text: string };                      // project command — body becomes the user message

/** Mirror the events emitted on the existing 'llm:chat' sender bus. */
export interface CommandResultSender {
  send(event: { type: 'plugin_result'; payload: CommandResult }): void;
}
```

No `as const` runtime values needed beyond the source strings. The exhaustive `switch` on `source` in `commandRegistry.ts` is the single source of truth for which source maps to which IPC channel — TypeScript will flag any source added without an IPC handler at compile time.

---

## Patterns to Follow

### Pattern 1: Anchor popover to textarea, not to trigger button

The `/` char is the trigger. The textarea is the anchor. cmdk has no `Anchor`-of-input pattern; use Radix `PopoverAnchor` to wrap the `<textarea>` (or its parent form) and let the popup float above it. This is the same pattern Slack/Linear use for mention/macro popups.

```tsx
<Popover open={slashOpen} onOpenChange={setSlashOpen}>
  <PopoverAnchor asChild>
    <form> ... <textarea ... /> </form>
  </PopoverAnchor>
  <PopoverPortal>
    <PopoverContent
      side="top"
      align="start"
      sideOffset={8}
      collisionPadding={12}
      className="w-[480px] p-0"
      onOpenAutoFocus={(e) => e.preventDefault()}  // don't steal focus from textarea
    >
      <SlashCommandPopup query={query} onSelect={handleSelect} />
    </PopoverContent>
  </PopoverPortal>
</Popover>
```

`onOpenAutoFocus={e => e.preventDefault()}` is **critical** — without it, cmdk's internal `<input>` steals focus from the textarea, and typing further characters (e.g. to refine the filter) routes to the wrong element. This is the single most common cmdk + Radix foot-gun.

### Pattern 2: cmdk with manual filtering for plugin source labels

cmdk's built-in fuzzy filter ranks by default. With 4 sources and 20+ commands, you want group-aware ordering: system first, then skill/workflow, then mcp, then project. Use `shouldFilter={false}` and filter manually:

```tsx
<Command shouldFilter={false} label="Slash commands">
  <Command.Input value={query} onValueChange={setQuery} className="hidden" />
  <Command.List className="max-h-[320px]">
    <Command.Empty>未匹配到命令</Command.Empty>
    {groupedCommands.map(group => (
      <Command.Group key={group.source} heading={SOURCE_LABELS[group.source]}>
        {group.items.map(cmd => (
          <Command.Item
            key={cmd.id}
            value={cmd.id}
            keywords={[cmd.label, cmd.description, cmd.id]}
            onSelect={() => onSelect(cmd)}
          >
            <Icon name={cmd.iconName} className="size-4" />
            <div>
              <div className="font-medium">/{cmd.label}</div>
              <div className="text-xs text-muted-foreground">{cmd.description}</div>
            </div>
            <SourceBadge source={cmd.source} />  {/* SLASH-12 namespace tag */}
          </Command.Item>
        ))}
      </Command.Group>
    ))}
  </Command.List>
</Command>
```

`Command.Input` is rendered with `className="hidden"` (and ref-suppressed) so cmdk's keyboard nav still works, but the actual typing happens in the textarea. The `value`/`onValueChange` are wired to the `query` state from the slash store, which is updated by the textarea `onChange`.

### Pattern 3: Plugin command registration — lazy + reactive

Don't preload all 4 sources on app start. Use a `useSlashCommands()` hook with `useEffect`-driven loaders:

```ts
export function useSlashCommands(): { commands: SlashCommand[]; loading: boolean } {
  const [mcp, setMcp] = useState<SlashCommand[]>([]);
  const [skills, setSkills] = useState<SlashCommand[]>([]);
  const [workflows, setWorkflows] = useState<SlashCommand[]>([]);
  const [project, setProject] = useState<SlashCommand[]>([]);

  useEffect(() => {
    void window.cdf.slash.listMcpTools(currentProjectId).then(setMcp);
    void window.cdf.slash.listSkills(currentProjectId).then(setSkills);
    void window.cdf.slash.listWorkflows(currentProjectId).then(setWorkflows);
    void window.cdf.slash.readProjectCommands(currentProjectId).then(setProject);
  }, [currentProjectId]);

  // System commands are static — defined in commandRegistry.ts, no IPC.
  const system = useMemo(() => SYSTEM_COMMANDS, []);

  return { commands: [...system, ...skills, ...workflows, ...mcp, ...project], loading: ... };
}
```

MCP dynamic re-registration (SLASH-13): subscribe to MCP server health events already emitted from `checkMcpServerHealth` in `mcp-connector.ts`. Reuse the existing IPC pattern: when a server goes from unhealthy→healthy, push an event the renderer listens for and re-fetches that server's tools.

### Pattern 4: Conflict resolution (SLASH-12)

If two sources both register `verify` (e.g. a skill called `verify` and a project command also called `verify`), the registry keeps **both** with different `id` (`skill:verify` vs `project:verify`) but **same `label`**. The popup row shows the `<SourceBadge>` next to the label so the user can disambiguate. No silent winner — both are always invocable as `/verify`. The badge uses the existing `badge.tsx` shadcn component (already in `ui/`).

---

## Alternatives Considered

| Recommended | Alternative | Why not |
|---|---|---|
| `cmdk@1.1.1` + Radix Popover | **assistant-ui `unstable_useSlashCommandAdapter` + `ComposerPrimitive.Unstable_TriggerPopover`** (built into 0.14.5) | Marked `unstable_` — API may shift in any 0.x release. Requires adopting `<AssistantRuntimeProvider>` + custom `ChatModelAdapter` + replacement of the entire current `ChatArea` chat pipeline (which is custom-built around `runtime.agent.streamEvents v3` with the M3 thinking patch-package). That refactor is the entire current v1.1 milestone's worth of work, on top of adding commands. |
| `cmdk@1.1.1` + Radix Popover | **Roll-your-own popover + filter** (no dep) | cmdk is 8 kB gzipped, has full a11y (roving focus, aria-activedescendant, ⏎/Esc/↑↓/Home/End), tested by Linear/Raycast. Building this from scratch is ~400 LOC of well-tested a11y code. Reject. |
| `cmdk@1.1.1` + Radix Popover | **Radix Dialog (modal, centered) instead of Popover** | Slash popup must be **anchored to the textarea cursor** so the user sees which `/command` they're completing. A centered dialog breaks spatial context (Claude Code's popup is anchored, not centered). |
| `cmdk@1.1.1` + Radix Popover | **Mantine Spotlight, kbar, etc.** | kbar@3.x targets global ⌘K palette, not anchored popup. Mantine Spotlight adds a 100+ kB dep just for a feature cmdk gives in 8 kB. |
| Manual filter (via `shouldFilter={false}`) | **`fuse.js@7.4.1` for fuzzy search** | cmdk's built-in fuzzy (when `shouldFilter={true}`) is sufficient for ≤100 commands. With ~20 commands in v1.1, fuse is overkill. Revisit only if command count grows past 200. |

---

## What NOT to Use

| Avoid | Why | Use instead |
|---|---|---|
| `@assistant-ui/react`'s `unstable_useSlashCommandAdapter` | Marked `unstable_`, requires ComposerPrimitive adoption, breaks v3 streamEvents pipeline | cmdk + Radix Popover (this stack) |
| `cmdk`'s `Command.Dialog` (modal variant) | Breaks textarea-anchor UX; user loses spatial context | Radix `Popover` + `PopoverAnchor` wrapping the `<form>` |
| `fuse.js` for fuzzy matching | Overkill at 20 commands; cmdk's built-in is fine | `shouldFilter={true}` (cmdk default) or `shouldFilter={false}` with manual sort if group ordering needed |
| `framer-motion` for popup open/close animation | Tailwind v4 + Radix `data-[state=open]` transitions cover this with zero deps | `data-[state=open]:animate-in` etc. (shadcn pattern, no animation lib) |
| `react-aria` / `react-aria-components` | Doubles up with Radix which the project already standardized on | Radix Popover (already in node_modules) |
| `vaul` (drawer, already in deps) | Drawer is for full-height side panels, not anchored popups | Radix Popover |
| **Routing plugin commands through `llm:chat` IPC** | Breaks M3 thinking — plugin result would be parsed by LLM as part of next user message; M3 chain replays and overwrites reasoning | Direct IPC `slash:invokePlugin` + `plugin_result` event on existing bus (see Architecture) |
| **Modifying `runtime.agent.streamEvents v3` options to add a "planOnly" mode** | The v3 protocol is patched via 6-hunk `patch-package` (per `STATE.md`); changing invocation shape risks M3 thinking roundtrip breakage | Set a flag in the existing `payload.overrides` object (already accepted at `llm.ts:324`) and check it in the deepagent runtime |

---

## Stack Patterns by Variant

**If the command set grows past 200 entries:**
- Switch cmdk to `shouldFilter={false}` + `fuse.js@7.4.1` with weighted fields (`{label: 0.5, description: 0.3, keywords: 0.2}`)
- Add virtualization via `@tanstack/react-virtual` (not yet installed)
- Because cmdk's default fuzzy renders all matches in DOM and re-renders on every keystroke

**If the user wants ⌘K to focus the input (Slack-style):**
- Add a global `useEffect` listening for `(⌘/Ctrl)+K` on `window`
- Focus the `<textarea>` ref and set `inputVal = '/'` programmatically
- No new dep needed

**If MCP tools are slow to load (1+ s):**
- Show a "Loading MCP tools..." `<Command.Loading>` slot in the popup
- cmdk has no built-in loading state, but the empty state can be reused
- The command registry's `loading: boolean` already covers this (see Pattern 3)

---

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| `cmdk@1.1.1` | `react@^19.2.6` | Peer dep `react ^18 \|\| ^19` verified via `npm view cmdk peerDependencies` |
| `@radix-ui/react-popover@1.1.15` | `react@^19.2.6` | Peer dep `react ^16.8 \|\| ^17 \|\| ^18 \|\| ^19` verified |
| `cmdk@1.1.1` | `@radix-ui/react-popover@1.1.15` | No direct coupling — cmdk is positioning-agnostic (no portal logic); compose in userland |
| `@assistant-ui/react@0.14.5` | `react@^19.2.6` | Already installed and compatible; **not used** by v1.1 but not removed (used in package.json transitively elsewhere?) |
| `lucide-react@1.16.0` | `cmdk@1.1.1` | No version constraint; `import { Goal, Plug, ... } from 'lucide-react'` works in any combo |
| `zod@4.4.3` | `@langchain/mcp-adapters@1.1.3` | Zod 4 syntax; MCP tool schemas are zod 4 — match in `argsSchema` |

---

## Installation

```bash
# Add cmdk (not currently a dep) and @radix-ui/react-popover (currently transitive only)
cd /Users/suntc/project/CDF
pnpm add cmdk@^1.1.1 @radix-ui/react-popover@^1.1.15
# (or npm install — adjust to the project's package manager)
```

After install, verify `package.json` shows both as direct deps (not just transitive) and run `pnpm install` (or `npm install`) once to regenerate the lockfile.

---

## Sources

- **Context7 `/dip/cmdk`** (HIGH) — cmdk 1.1.1 component primitives, custom filter, shouldFilter, keyboard nav behavior
- **Context7 `/assistant-ui/assistant-ui`** (HIGH) — `unstable_useSlashCommandAdapter` and `ComposerPrimitive.Unstable_TriggerPopover` API surface; confirmed they exist in 0.14.5 but are marked `unstable_` and require ComposerPrimitive
- **Context7 `/langchain-ai/langchainjs`** (HIGH) — tool/agent invocation shape; confirmed `@langchain/mcp-adapters` `client.getTools()` returns `StructuredTool[]` with `invoke()` method
- **npm registry** (HIGH) — `npm view cmdk peerDependencies/version`, `npm view @radix-ui/react-popover peerDependencies/version`, `npm view fuse.js version`
- **Local inspection of `/Users/suntc/project/CDF/src/renderer/src/components/ChatArea/ChatArea.tsx`** (HIGH) — confirmed custom textarea, no assistant-ui primitives; `handleKeyDown` at line 658 is the integration point
- **Local inspection of `/Users/suntc/project/CDF/src/main/llm.ts:338`** (HIGH) — confirmed `runtime.agent.streamEvents v3` call shape and `payload.overrides` extension point for `/plan` mode
- **Local inspection of `/Users/suntc/project/CDF/src/main/workflow/workflow-runtime.ts:474`** (HIGH) — `workflow:run` IPC channel is the existing dispatch path for workflow invocations
- **Local inspection of `/Users/suntc/project/CDF/src/main/deepagent/mcp-connector.ts:53`** (HIGH) — `createMcpClient` + `getOrCreateServerClient` for plugin tool invocation; `loadMcpTools` at line 129

---

*Stack research for: v1.1 SLASH-01 through SLASH-13 (slash command popup + plugin dispatch)*
*Researched: 2026-06-04*
