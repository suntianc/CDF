# Codebase Concerns

**Analysis Date:** 2026-05-26

## Tech Debt

**Database Migration Fragility:** (低优先级)
- Issue: Database schema migrations use `ALTER TABLE` with try/catch to handle duplicate column names. Other errors are logged but do not block startup.
- Files: `src/main/database.ts`
- Impact: Very low for local desktop app — users typically run one version at a time; migration errors would appear in logs.
- Fix approach: Optional — add migration tracking table if stricter safety needed.

**Console.log Debug Statements in Production:**
- Issue: Debug `console.log` statements left in production code path for search tool configuration loading.
- Files: `src/main/deepagent/runtime.ts:341`, `src/main/deepagent/runtime.ts:347`
- Impact: Pollutes logs and may leak configuration details in production.
- Fix approach: Replace with proper structured logging (electron-log) or remove.

**Hardcoded Chrome Version in Fetch Tool:**
- Issue: `getDefaultUserAgent()` uses hardcoded Chrome version `124.0.0.0`.
- Files: `src/main/deepagent/fetch-tool.ts:13`
- Impact: User-Agent string becomes outdated over time, potentially causing compatibility issues.
- Fix approach: Dynamically detect or update periodically.

**WeakMap Memory Leak Potential:**
- Issue: `modelCapture` and `rawReasoningQueue` in `llm-adapter.ts` are WeakMaps that depend on model objects being garbage collected, but models may be retained long-term.
- Files: `src/main/deepagent/llm-adapter.ts:19-21`
- Impact: Accumulated reasoning/text capture data if models aren't properly released.
- Fix approach: Add explicit cleanup functions and monitor memory usage.

**MCP Client Caching Without TTL:**
- Issue: MCP clients are cached but there's no TTL or health check on cached connections.
- Files: `src/main/deepagent/mcp-connector.ts:56`
- Impact: Stale connections may be reused, causing operation failures.
- Fix approach: Add connection health tracking and automatic reconnection.

## Known Bugs

**BrowserWindow Leak in Fetch Tool:** ✅ 已修复
- Issue: `executeJavaScript` had no timeout, causing windows and Promises to hang indefinitely.
- Files: `src/main/deepagent/fetch-tool.ts`
- Fix: Added `Promise.race` timeout (5s) for `executeJavaScript`, unified `finalize()` for all exit paths.
- Status: 2026-05-26 fixed

**Search Tools Config Silently Fails:** (低优先级)
- Issue: Search provider config loading errors are caught and logged but do not prevent agent creation.
- Files: `src/main/deepagent/runtime.ts:351-353`
- Impact: Low — user only affected if they actually try to use search; logs show warning.
- Fix approach: Optional — show "search unavailable" indicator in agent capabilities.

## Security Considerations

**Path Traversal Protection:**
- Files: `src/main/deepagent/file-tools.ts:29`, `src/main/deepagent/file-tools.ts:46`
- Current mitigation: `validatePath()` function checks for path traversal attempts (`..`).
- Notes: Good protection exists, but symlink following is blocked (`file-tools.ts:62`) which may limit legitimate use cases.

**Bash Tool Execution:**
- Risk: `bash_tool.ts` executes arbitrary shell commands with the application's permissions.
- Files: `src/main/deepagent/bash-tool.ts`
- Current mitigation: Output truncation (maxOutputBytes), timeout enforcement.
- Recommendations: Consider adding command allowlisting or sandboxing for production use.

**Fetch Tool Opens BrowserWindow:**
- Risk: `fetch-tool.ts` creates hidden BrowserWindow instances to render pages.
- Files: `src/main/deepagent/fetch-tool.ts:61-69`
- Current mitigation: Uses session partition `'agent_fetch_mem'` for isolation.
- Recommendations: Ensure this cannot be exploited for SSRF or local resource access.

## Performance Bottlenecks

**Large ChatArea Component:** ✅ 已拆解
- Problem: `ChatArea.tsx` was 1322 lines, monolithic component.
- Files: `src/renderer/src/components/ChatArea/ChatArea.tsx`
- Fix: Extracted sub-components (message renderers, tool displays, input handling).
- Status: 2026-05-26 fixed

**Synchronous Database Operations:** (低优先级)
- Problem: `better-sqlite3` operations are synchronous, blocking the main process.
- Files: `src/main/database.ts`, `src/main/ipc-handlers.ts`
- Impact: Low for typical usage — desktop app data volume rarely accumulates to problematic levels.
- Improvement path: Optional — move to worker thread or async patterns if profiling shows actual issues.

**Session Message History Loading:**
- Problem: `getSessionMessages()` loads all messages for a session without pagination.
- Files: `src/main/deepagent/runtime.ts:242-244`
- Impact: Long conversations will have increasing memory usage and slower load times.
- Improvement path: Implement cursor-based pagination for message history.

**BrowserWindow-based Fetch Tool:**
- Problem: Using a full BrowserWindow to fetch and parse web pages is resource-intensive.
- Files: `src/main/deepagent/fetch-tool.ts`
- Cause: Each fetch creates a new hidden BrowserWindow.
- Improvement path: Use native HTTP fetch + JSDOM instead of BrowserWindow when possible.

## Fragile Areas

**Provider Normalization Logic:**
- Files: `src/main/deepagent/provider-normalization.ts`
- Why fragile: Complex switch/case logic for different provider types with inconsistent behavior.
- Safe modification: Add integration tests for each provider type before changes.

**Runtime Initialization Ordering:**
- Files: `src/main/deepagent/runtime.ts:294-376`
- Why fragile: Many interdependent steps - database, provider, model, skills, MCP servers, search tools. Failure at any step may leave partial state.
- Safe modification: Use a dependency injection pattern with explicit initialization order.

**Database Connection Singleton:**
- Files: `src/main/database.ts`
- Why fragile: Module-level `db` singleton. If initialization fails partially, the module may be in an unusable state.
- Safe modification: Add explicit initialization check and error propagation.

**MCP Server Health Check:** ✅ 已修复
- Issue: Health check created new MCP client each time, not reusing cached connections. Error path could leak connections.
- Files: `src/main/deepagent/mcp-connector.ts`, `src/main/ipc-handlers.ts`
- Fix: Added `serverClients` Map with TTL, `checkMcpServerHealth()` reuses connections. Cleanup on failure.
- Status: 2026-05-26 fixed

## Scaling Limits

**SQLite Database:**
- Current capacity: Single SQLite file, suitable for single-user desktop app.
- Limit: No built-in replication, backup requires file copy.
- Scaling path: For multi-user or larger scale, migrate to PostgreSQL or use cloud sync.

**Session Store Memory:**
- Current capacity: Session history stored in memory via Zustand stores.
- Limit: Long conversations with many messages may consume significant memory.
- Scaling path: Implement message pagination and virtual scrolling.

**Agent Instances Map:**
- Current capacity: In-memory Map in IPC handler.
- Limit: Lost on application restart; no persistence.
- Scaling path: Persist agent state to database if needed across restarts.

## Dependencies at Risk

**@anthropic-ai/sdk:**
- Risk: Official Anthropic SDK - low risk but depends on Anthropic's release schedule.
- Impact: Breaking changes would require adapter updates.
- Migration plan: The adapter layer (`llm-adapter.ts`) provides abstraction, but changes would be needed.

**deepagents:**
- Risk: Internal package, may have limited documentation.
- Impact: Runtime relies heavily on this package for core functionality.
- Migration plan: High effort to replace - consider if this is the right long-term choice.

**better-sqlite3:**
- Risk: Native module that requires rebuilds for different Node/Electron versions.
- Impact: Electron updates may require rebuilds; potential compatibility issues with M-series Macs.
- Migration plan: Could migrate to `sql.js` (WASM) for better cross-platform support if native module issues persist.

## Missing Critical Features


**No Retry Logic for LLM Calls:**
- Problem: Failed LLM API calls are not retried.
- Files: `src/main/deepagent/llm-adapter.ts`
- Blocks: Reliability in unstable network conditions.

**No Message Pagination:**
- Problem: All messages for a session are loaded at once.
- Files: `src/main/deepagent/runtime.ts`, `src/renderer/src/stores/sessionStore.ts`
- Blocks: Performance with long conversations.

**No Agent Run Persistence Beyond Memory:**
- Problem: `agentInstances` Map in `ipc-handlers.ts` is in-memory only.
- Files: `src/main/ipc-handlers.ts:625`
- Blocks: Agent state recovery after app restart.

## Test Coverage Gaps

**No Integration Tests for IPC Handlers:**
- What's not tested: Database operations through IPC handlers.
- Files: `src/main/ipc-handlers.ts`
- Risk: Schema changes or business logic errors may not be caught.
- Priority: High

**No Tests for Fetch Tool:**
- What's not tested: `fetch-tool.ts` has no test file.
- Files: `src/main/deepagent/fetch-tool.ts`
- Risk: Changes could break web page fetching functionality.
- Priority: Medium

**No Tests for Provider Normalization:**
- What's not tested: `provider-normalization.ts` has no dedicated test file.
- Files: `src/main/deepagent/provider-normalization.ts`
- Risk: Edge cases for different provider APIs may break.
- Priority: Medium

**Runtime Tests Mock Heavy:**
- What's not tested: `runtime.test.ts` uses extensive mocking.
- Files: `src/main/deepagent/runtime.test.ts`
- Risk: May not catch real integration issues.
- Priority: Medium

**No E2E Tests:**
- What's not tested: Full user workflows (create project, chat, use tools).
- Risk: User-facing features may break without detection.
- Priority: High

---

*Concerns audit: 2026-05-26*
