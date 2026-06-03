# Requirements: v1.1 基本能力完善

**Milestone:** v1.1 — `/` command popup system for Master Agent chat input
**Date:** 2026-06-04
**Status:** planning
**Reference:** `.planning/research/SUMMARY.md` (full synthesis of STACK/FEATURES/ARCHITECTURE/PITFALLS research)

---

## Milestone v1.1 Requirements

### Slash Command Infrastructure (SLASH-01..04, 12, 13)

- [ ] **SLASH-01**: User can type `/` in Master Agent chat input box to open a command popup
- [ ] **SLASH-02**: User can filter commands by substring (case-insensitive, NFKC-normalized for CJK) and navigate with ↑↓ + Enter + Esc + Backspace
- [ ] **SLASH-03**: Command registry maintains a merged list of 5 sources: system (3 hardcoded) + MCP tools + Skills + Workflows + Project custom commands; each entry has source badge
- [ ] **SLASH-04**: Command dispatcher routes each command to one of 4 `CommandDispatchAction` kinds: `local-silent` (/goal), `local-reply` (/context), `plan-mode` (/plan), `llm-chat` (plugins)
- [ ] **SLASH-12**: Naming conflicts between sources are resolved with priority `system > skill > workflow > mcp > project`; both-rows-kept UI; no silent overwrite; `CommandConflictError` toast on registry build
- [ ] **SLASH-13**: Command registry refreshes on session start + chokidar watches `.cdf/commands/*.md` for hot-reload; MCP server health transitions trigger re-fetch

### System Commands (SLASH-05..07)

- [ ] **SLASH-05**: User can run `/goal [condition]` to set a session-level goal stored in `useSessionStore.sessionGoals: Map<sessionId, string>` (in-memory, v1.1; persistent in v1.2+); placeholder bubble `[system] 正在执行 /goal…` appears immediately, no LLM call
- [ ] **SLASH-06**: User can run `/context [all]` to render a static bubble showing current session token usage (from `messages` table), without invoking the LLM
- [ ] **SLASH-07**: User can run `/plan [description]` to enter plan mode; dispatcher sets `payload.overrides = { planOnly: true }` on the existing `llm:chat` call; first `message_chunk` after `/plan` MUST contain `<think>…plan only…</think>`; no `write_file` / `edit_file` / `bash` tool call fires during plan mode

### Plugin Command Auto-Registration (SLASH-08..11)

- [ ] **SLASH-08**: Each connected MCP tool auto-registers as `/${mcp_tool_name}` (no args parsing in v1.1 — see SLASH-12 pitfall P7); reuses `loadMcpTools(agentId, mcpServers)` at `mcp-connector.ts:129` with `mcpCache` (no re-connect)
- [ ] **SLASH-09**: Each installed Skill auto-registers as `/${skill_name}`; reuses `listPhysicalSkills(projectPath)` at `skill-manager.ts:89`; CJK skill names NFKC-normalized for filter matching
- [ ] **SLASH-10**: Each active Workflow auto-registers as `/${workflow_name}`; new lightweight SQL `SELECT id, name, description FROM workflows WHERE status='active'` (do NOT call `db:getWorkflows` which returns heavy `graph_data`); v1.1 ships 1 seed workflow (`/pr-review` 3-node) as e2e contract
- [ ] **SLASH-11**: Project-level custom commands read from `<projectPath>/.cdf/commands/*.md` with YAML frontmatter (`name`, `description`, `argument-hint`); `$ARGUMENTS` placeholder substituted in command body before dispatching as natural-language user message; chokidar hot-reload

### Plugin Command Dispatch (cross-cutting, addressed in SLASH-04)

- [ ] **SLASH-DISPATCH**: All plugin commands (MCP / Skill / Workflow / Project) dispatch through the existing `llm:chat` IPC (rewritten as natural-language prompt `"请调用 ${tool} 工具，参数：${args}"`); **NO** new dispatch IPC channels; plugin outputs render via existing `MarkdownRenderer` + `ToolMessageCard`; **M3 thinking preservation is the load-bearing constraint**

### M3 Thinking Preservation (cross-cutting regression test)

- [ ] **SLASH-REGRESSION**: New it block in `llm-adapter.test.ts` (or `llm.test.ts`) asserts that a `/plan` followed by a user message emits a `message_chunk` whose first `text` content starts with `<think>…` and contains no tool_call events until the user exits plan mode. This is the load-bearing test for the 6-hunk patch-package on `@langchain/anthropic@1.4.0`.

---

## Future Requirements (deferred to v1.2+)

- [ ] **SLASH-14**: Plugin command args parsing — read `inputSchema` from MCP tool / SKILL.md frontmatter from Skill / workflow input schema; render schema-driven form in popup row to collect args before dispatch (per FEATURES.md D2 args hint)
- [ ] **SLASH-15**: `/goal` SQLite persistence — migrate `useSessionStore.sessionGoals` to `session_goals` table so goals survive app restarts
- [ ] **SLASH-16**: frecency ordering of popup rows (most-recently-used first) per FEATURES.md D5
- [ ] **SLASH-17**: command aliases (`/c` for `/context`, `/g` for `/goal`)
- [ ] **SLASH-18**: `⌘/` global hotkey to open popup from anywhere in app
- [ ] **SLASH-19**: `?` help overlay that lists all commands grouped by source
- [ ] **SLASH-20**: command description preview (right-side panel showing full description of highlighted command)
- [ ] **SLASH-21**: Project custom command authoring UX (in-app editor with frontmatter form)
- [ ] **SLASH-22**: voice input fallback for popup commands

---

## Out of Scope (explicit exclusions)

- **v1.0 partial deliverable cleanup** (draft workflow tests, work history UI polish, MCP connection mgmt) — these were unfinished from v1.0 and are pushed to v1.2. v1.1 is laser-focused on the `/` command system; mixing partials will dilute the milestone.
- **95-command Claude Code parity** — many Claude Code commands (terminal integration, voice input, cloud scheduling, cross-device, Anthropic-platform-specific) are not applicable to a desktop app. v1.1 adopts only what fits CDF's plugin model.
- **assistant-ui adoption** — `@assistant-ui/react@0.14.5` is installed but never rendered. The composer is a custom `<textarea>`. Adopting assistant-ui's slash adapter (`unstable_useSlashCommandAdapter`) would require rewriting the composer, refactoring the `streamEvents v3` pipeline, and breaking the 6-hunk patch-package on `@langchain/anthropic@1.4.0`. **Rejected** per research PITFALLS P1.
- **New dev dependencies beyond `cmdk` + `@radix-ui/react-popover` + `sonner`** — every dep added is a future maintenance burden; existing `react`, `zustand`, `tailwind`, `shadcn/ui` already cover the use cases.
- **Backend changes to `runtime.ts` or `workflow-runtime.ts`** — the M3 thinking preservation invariant forbids this.
- **Cloud / sync / multi-device** — CDF is offline-first; this would be a v2+ topic.
- **Team / RBAC** — v1 is single-developer.

---

## Traceability

| Requirement | Phase | Source |
|------------|-------|--------|
| SLASH-01 | Phase 1 | PROJECT.md + research SUMMARY |
| SLASH-02 | Phase 1 | PROJECT.md + research SUMMARY |
| SLASH-03 | Phase 2 | PROJECT.md + research SUMMARY |
| SLASH-04 | Phase 2 | PROJECT.md + research SUMMARY |
| SLASH-05 | Phase 3 | PROJECT.md + research SUMMARY |
| SLASH-06 | Phase 3 | PROJECT.md + research SUMMARY |
| SLASH-07 | Phase 3 | PROJECT.md + research SUMMARY + PITFALLS P2 |
| SLASH-08 | Phase 2 | PROJECT.md + research SUMMARY |
| SLASH-09 | Phase 2 | PROJECT.md + research SUMMARY |
| SLASH-10 | Phase 2 | PROJECT.md + research SUMMARY + PITFALLS P11 |
| SLASH-11 | Phase 2 | PROJECT.md + research SUMMARY |
| SLASH-12 | Phase 2 | PROJECT.md + research SUMMARY + PITFALLS P3 |
| SLASH-13 | Phase 2 | PROJECT.md + research SUMMARY + PITFALLS P10 |
| SLASH-DISPATCH | Phase 2 | research SUMMARY (cross-cutting) |
| SLASH-REGRESSION | Phase 3 | research SUMMARY + PITFALLS P2 (load-bearing test) |

**Total requirements: 14** (13 SLASH + 1 SLASH-DISPATCH + 1 SLASH-REGRESSION)
**Coverage:** 100% (all 13 SLASH requirements in PROJECT.md + 2 cross-cutting invariants → mapped to 1+ phase)

---

*Generated 2026-06-04 from PROJECT.md Active section + research SUMMARY + user clarifications (3 system + 4 plugin sources + project-level custom).*
