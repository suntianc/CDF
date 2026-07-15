# Delegated runs inherit one Conversation Approval Mode

## Status

Accepted

Every Delegated Agent Run inherits the parent Agent Run's Conversation Approval Mode unchanged. Agents have no independent approval-mode setting: Agent Tool Scope may narrow which tools are visible, but cannot change whether their calls require approval. We chose one mode for the full execution tree over Claude Code's per-subagent permissionMode overrides because CDF needs a simpler user model in which the Conversation control is authoritative and no hidden Agent configuration changes approval behavior. This supersedes ADR-0056's sticky-mode and Agent Approval Override design.
