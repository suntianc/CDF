# Skills use Claude Code visibility semantics

> **Superseded in part by ADR-0069.** The historical four-state Skill Override decision is retired: visibility now follows Scene Skill Exposure for Global Skills and Project Skill scoping. The source-precedence, Skill frontmatter, qualified-name, nested-skill, and Agent Skill Preload context below remains historical context for the original design.

CDF will follow Claude Code's Skill visibility semantics: visible Project, global, plugin, and additional-directory Skills are discoverable by default through progressive disclosure, while an Agent's Skill selection is a preload or emphasis list rather than an access whitelist. Blocking, hiding, or reducing a Skill's auto-trigger likelihood should be expressed through Skill metadata or a Skill Override, not by treating the absence of an Agent binding as denial.

CDF Skill Overrides use four states: `on` exposes the Skill normally, `name-only` exposes only the Skill name, `user-invocable-only` allows explicit user invocation without automatic model invocation, and `off` hides the Skill completely.

When Skill metadata and Skill Overrides both define visibility, explicit overrides win over metadata defaults. The precedence order is Agent override, then Project override, then User/global override, then `SKILL.md` frontmatter, then the default `on` behavior.

CDF will support all three override layers. User/global overrides represent personal cross-project defaults, Project overrides represent project policy, and Agent overrides represent a specific Agent's local emphasis or restriction. Implementation should be split into issues before code changes so the data model, runtime resolution, UI, and migration work can land in controlled slices.

Project overrides are shared project policy and should live in a project-local, commit-friendly `.cdf` configuration file. User/global overrides are local personal policy and should live outside the Project. Agent overrides are part of the Agent configuration managed by CDF.

The Project Skill configuration file is `.cdf/skills.config.json`. It uses a JSON shape with `version`, an `overrides` object keyed by Skill name, and an `additionalSkillDirectories` array for extra project-relative Skill sources. `SKILL.md` remains the Skill author's metadata and instructions, while `AGENTS.md` remains human/Agent-facing project guidance rather than machine-owned Skill configuration.

Skill sources follow Claude Code-style precedence rather than treating Project Skills as always highest priority. CDF built-in Skills have the lowest priority, then Project `.cdf/skills`, then Project `additionalSkillDirectories` in configured order, then User/global Skills, with Enterprise/managed Skills reserved as the future highest-priority layer. This order maps to DeepAgents by passing sources from lowest to highest priority because later sources override earlier same-name Skills.

CDF should remove the current access-control meaning from Agent Skill binding. The large implementation should still include Agent-level Skill Preload, but it must be modeled and presented as startup emphasis/full-instruction loading rather than permission. The work should be split into issues so the access-control semantic change, preload behavior, runtime wiring, UI copy, and migrations can be implemented separately.

Because CDF has not shipped this Skills model yet, the implementation does not need a backwards-compatibility migration strategy for the old binding semantics. Existing `agent_skills` data can be directly transformed into the new Skill Preload model or otherwise normalized during the feature rollout, as long as no old access-control meaning remains.

The four override states affect model discovery and explicit user invocation separately. `on` is visible to both model auto-discovery and user invocation. `name-only` exposes only the Skill name to model auto-discovery while keeping user invocation available. `user-invocable-only` removes the Skill from model auto-discovery but keeps an explicit user invocation path that injects the full Skill instructions for that request. `off` hides the Skill from both model discovery and user invocation.

CDF should vendor and adapt the DeepAgents SkillsMiddleware subset rather than passing raw Skill sources into `createDeepAgent({ skills })` or fully forking the DeepAgents SDK. The vendored subset gives CDF ownership of Skill resolution, overrides, preload, and user invocation while avoiding maintenance responsibility for unrelated DeepAgents runtime, backend, subagent, and LangGraph integration code.

Explicit Skill invocation uses Claude Code-style qualified names rather than a separate `/skill skill-name` namespace. A unique root Skill is invoked as `/skill-name`; nested, additional-directory, or plugin Skills that should coexist use qualified names such as `/apps/web:deploy` or `/plugin-name:deploy`. Same-name Skills across ordinary precedence layers collapse to the highest-priority Skill, while coexisting qualified Skills remain listed side by side with source and directory/plugin labels in the command UI.

CDF should support nested Project Skills such as `apps/web/.cdf/skills/deploy/SKILL.md`, but nested discovery, path-aware relevance, and qualified nested invocation should be delivered as a separate issue from the first runtime resolution and override work. This keeps the initial implementation focused while preserving Claude Code-compatible behavior as the target.
