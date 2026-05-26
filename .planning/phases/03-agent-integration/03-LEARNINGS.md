---
phase: "03"
phase_name: "Agent Integration"
project: "Agent 开发工作站"
generated: "2026-05-26"
counts:
  decisions: 10
  lessons: 7
  patterns: 5
  surprises: 5
missing_artifacts: []
---

# Phase 03 Learnings: Agent Integration

## Decisions

### deepagents.js as LLM engine
Used `npm install deepagents` (v1.10.2+) instead of hand-written SSE streaming logic.

**Rationale:** deepagents provides built-in streaming, better abstraction, and is from LangChain ecosystem.
**Source:** 03-CONTEXT.md (D-01, D-02, D-03)

---

### Zustand store pattern for Agent/Skills/MCP
Created three Zustand stores following the `llmStore.ts` pattern: `useAgentStore`, `useSkillStore`, `useMcpServerStore`.

**Rationale:** Consistent pattern across all CRUD stores: loading/error state, IPC-based mutations, auto-refresh after mutations.
**Source:** 03-01-PLAN.md

---

### Merged Skills and MCP into PluginsPanel
Skills and MCP management integrated into single `PluginsPanel.tsx` with tab switching, not separate component directories.

**Rationale:** Fewer files, shared layout, unified user experience. Both are plugin-related features.
**Source:** 03-03-SUMMARY.md, 03-04-SUMMARY.md (Deviations sections)

---

### Textarea + line numbers for code editor
Used textarea with scroll-synced line number gutter instead of Monaco/Codemirror.

**Rationale:** Lightweight, no heavy dependency. Syntax highlighting deferred to post-v1 polish.
**Source:** 03-CONTEXT.md (D-19), 03-03-SUMMARY.md

---

### Auto-versioning on skill save
Every skill save automatically creates a version snapshot in `skill_versions` table.

**Rationale:** No manual versioning needed, automatic history preservation. v1 intentionally read-only (no restore).
**Source:** 03-CONTEXT.md (D-22)

---

### Unified onChangeView prop
Single `onChangeView` handler instead of individual `onOpenAgent`/`onExitAgent` handlers per view.

**Rationale:** Cleaner API, easier to extend with new views.
**Source:** 03-05-SUMMARY.md (Deviations section)

---

### Simple dropdown for binding selectors
Used simple dropdown with search filter instead of Command palette (cmdk) for MCP/Skills binding selection.

**Rationale:** Lighter weight, sufficient functionality, avoids adding cmdk dependency.
**Source:** 03-02-SUMMARY.md (Deviations section)

---

### Newline-separated args for stdio MCP
MCP stdio transport uses newline-separated arguments (each line = one arg) instead of comma-separated.

**Rationale:** More robust for paths with spaces.
**Source:** 03-04-SUMMARY.md (Deviations section)

---

### Two-column dialog layout (40%/60%)
Agent edit dialog uses 40% left column (name/desc/provider) and 60% right column (system prompt/MCP/Skills bindings).

**Rationale:** Information hierarchy - core config vs capabilities. Matches spec.
**Source:** 03-CONTEXT.md (D-11), 03-02-PLAN.md

---

### LLM provider name resolution from store
Agent cards resolve LLM provider name via `useLLMStore` lookup, not stored directly on agent.

**Rationale:** Provider names can change, store reference ensures consistency.
**Source:** 03-02-PLAN.md (Task 2A.1)

---

## Lessons

### Backend returns flat agent rows
`window.electronAPI.db.getAgents()` returns agents WITHOUT resolved `mcpServerIds` and `skillIds` - just flat agent rows with IDs.

**Context:** The plan assumed agents would include resolved binding data but backend returns foreign key IDs only.
**Source:** 03-01-PLAN.md (Key implementation detail)

---

### No separate AgentEditDialog component
Edit dialog embedded inline in `AgentLibrary.tsx` instead of separate `AgentEditDialog.tsx` file.

**Context:** Functionality identical but fewer files to maintain.
**Source:** 03-02-SUMMARY.md (Deviations section)

---

### healthCheckMap not persisted in store state
Health check results returned directly from `checkMcpHealth()` and shown via toast, not stored in `healthCheckMap`.

**Context:** Results are transient, no need to persist. Toast provides sufficient feedback.
**Source:** 03-04-SUMMARY.md (Deviations section)

---

### Transport type label: "sse" not "streamable-http"
Implementation uses `sse` label for HTTP-based MCP transport, not `streamable-http`.

**Context:** Plan referenced Streamable HTTP spec but implementation uses simpler `sse` label. Should align with MCP 2025-03-26 spec later.
**Source:** 03-04-SUMMARY.md (Deviations section)

---

### Version history as right-side panel in edit modal
Version history panel slides in from the right within the edit modal, not as a separate component.

**Context:** Functionally equivalent to plan's separate component approach but more compact.
**Source:** 03-03-SUMMARY.md (Deviations section)

---

### Skill stores do not persist selected skill
`skillVersions` in store is a flat array, not keyed by skillId. Multiple skill versions fetched sequentially share same array.

**Context:** Works fine when only editing one skill at a time, but could cause issues with concurrent edits.
**Source:** 03-03-PLAN.md (SkillVersionHistory implementation)

---

### ActiveSkillVersions naming deviation
`skillStore.ts` uses field name `activeSkillVersions` vs plan's `skillVersions`.

**Context:** Trivial naming difference, functionally identical.
**Source:** 03-01-SUMMARY.md (Deviations section)

---

## Patterns

### Zustand CRUD store pattern
All stores follow identical pattern: `loading/error` state, CRUD via IPC, auto-refresh after mutations.

**When to use:** Any frontend state that needs to sync with Electron backend via IPC.
**Source:** 03-01-PLAN.md

---

### Card list + topbar + toast pattern
Reused `provider-card` CSS classes, `main-topbar` layout, and `showToast` system across all management panels.

**When to use:** Any list-based management UI in the app.
**Source:** 03-02-PLAN.md, 03-03-PLAN.md, 03-04-PLAN.md

---

### Two-column form dialog pattern
Modal dialogs with two-column grid layout for organizing related but distinct information groups.

**When to use:** Forms with clear primary/secondary field groupings (e.g., core config vs capabilities).
**Source:** 03-02-PLAN.md (Task 2A.2)

---

### Inline edit dialog in list component
Edit/create dialog state managed in parent list component, dialog rendered inline rather than separate component.

**When to use:** Simple create/edit flows with moderate field count.
**Source:** 03-02-SUMMARY.md

---

### Tab-based panel switching
Single panel with internal tab state to switch between related sub-views (Skills/MCP in PluginsPanel).

**When to use:** Related but distinct content areas that user frequently switches between.
**Source:** 03-CONTEXT.md (D-08)

---

## Surprises

### File import for skill scripts added
`selectFile` IPC handler for importing scripts from filesystem was added beyond the original plan.

**Impact:** Improved UX significantly - users can import existing scripts instead of copy-pasting.
**Source:** 03-03-SUMMARY.md (Extra Features section)

---

### Connection status badge with pulse animation
Online/offline MCP servers show animated pulse indicator, not just static dot.

**Impact:** Better real-time feedback on connection state.
**Source:** 03-04-SUMMARY.md (Extra Features section)

---

### Last health check timestamp display
UI shows when each MCP server was last health checked, not just the result.

**Impact:** Better diagnostic information for troubleshooting.
**Source:** 03-04-SUMMARY.md (Extra Features section)

---

### Health check spinner during probe
Health check button shows spinner while probe is in progress, with button disabled.

**Impact:** Prevents double-clicks, provides clear feedback during async operation.
**Source:** 03-04-SUMMARY.md (Extra Features section)

---

### Search filter added to all card lists
Search functionality was added to Agent, Skills, and MCP card lists beyond plan specs.

**Impact:** Improved UX for users with many items. Discovered as needed during implementation.
**Source:** 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md (Deviations/Extra Features)
