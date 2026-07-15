# Delegated approval waits are process-lifetime

## Status

Accepted

The first delegated approval routing implementation resumes a paused Delegated Agent Run only while the hosting CDF process remains alive. Closing or crashing the app interrupts that execution and its unresolved approvals; on startup, non-terminal parent and delegated runs become `interrupted`, and unresolved approvals become invalidated read-only history. Persisted Conversation and Agent context may support a later new execution, but does not revive the original run. We chose `MemorySaver` and process-lifetime resume for #139 because ordinary Claude Code permission prompts do not document durable cross-restart continuation and CDF's existing main-Agent approval resolver is also in-memory; durable approval recovery must be designed once for all Agent Runs rather than added only to parallel workers.
