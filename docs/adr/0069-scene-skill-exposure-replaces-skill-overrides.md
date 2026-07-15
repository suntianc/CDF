# Scene Skill Exposure replaces Skill Overrides

CDF exposes Global Skills per Project Scene through one boolean Scene Skill Exposure value for each registered Scene. Built-in Skills supply curated Scene defaults; user-global Skills default to every Scene. Project Skills, including primary, nested, and configured additional directories, remain available only within their Project and have no product-level exposure control.

This supersedes the user-, Project-, and Agent-level four-state Skill Override portion of ADR-0012. The `on`, `name-only`, `user-invocable-only`, and `off` configuration model, its persistence, IPC, UI, and runtime precedence are removed rather than migrated. A disabled Global Skill is filtered before catalog merging, so it cannot shadow a same-named Project Skill.

Skill-authored `disable-model-invocation` and `user-invocable` frontmatter remain the intrinsic invocation contract. Agent Skill Preload remains an emphasis mechanism for Skills already available to the Project; it cannot bypass Scene Skill Exposure. Conversation Skill Snapshots retain source attribution and invocation metadata so existing Conversations stay stable when Scene exposure later changes.
