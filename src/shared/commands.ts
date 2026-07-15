import type { SkillCommandSourceKind, SkillModelDiscovery } from './skills';

/** D-06 priority order. Declaration order is informational only — actual
 *  priority numbers live in renderer useCommandRegistry.ts. */
export type CommandSource =
  | 'system'
  | 'mcp'
  | 'skill:project'
  | 'skill:global'
  | 'cmd:project'
  | 'cmd:system';

export interface SlashCommand {
  /** Command name without the leading `/` */
  name: string;
  /** One-line description. MCP tools collect but do not render (D-09). */
  description: string;
  /** Where this command was registered from. */
  source: CommandSource;
  /** Dispatch target: system enum key / MCP tool name / skill id / workflow id / command file path. */
  target: string;
  /** Display label for source discrimination. */
  sourceLabel: string;
  /** Source badge text rendered in popup, e.g. `[system]`, `[mcp:arxiv_search]`. */
  badge: string;
  /** Skill short name. Present for Skill commands. */
  skillName?: string;
  /** Skill invocation name without the leading `/`; may include a qualified prefix. */
  qualifiedName?: string;
  /** Resolved Skill source kind. Present for Skill commands. */
  skillSourceKind?: SkillCommandSourceKind;
  /** Directory that contributed the Skill. Present for Skill commands. */
  sourcePath?: string;
  /** Absolute path to the Skill's SKILL.md. Present for Skill commands. */
  skillPath?: string;
  /** Skill-authored model-discovery exposure. Present for Skill commands. */
  modelDiscovery?: SkillModelDiscovery;
  /** Whether this Skill can be explicitly invoked by the user. Present for Skill commands. */
  userInvocable?: boolean;
  /** Optional arg hint for custom commands (D-20). */
  argumentHint?: string;
  /** D-05: absolute path to the .md file. Set for cmd:project / cmd:system;
   *  absent for system-hardcoded / mcp / skill / workflow entries. */
  bodyPath?: string;
  /** D-07: parsed frontmatter object; absent for system-hardcoded commands. */
  frontmatter?: ParsedFrontmatter;
  /** 08.2 polish: when true, the command is omitted from the `/` popup
   *  rendering — typically because a persistent UI affordance (e.g. the
   *  ContextButton 📊) already exposes the same action. Slash input
   *  (`/cmd …`) still dispatches via the dispatcher. Default: false. */
  hideFromPopup?: boolean;
}

/** D-07 / D-10: typed frontmatter fields supported in custom command `.md` files.
 *  Field names are camelCase (consumer side); they map 1:1 to the kebab-case
 *  keys used in the frontmatter YAML (e.g. `disable-model-invocation`).
 *  Defaults are applied at parse time per D-10. */
export interface ParsedFrontmatter {
  /** Default: false (D-10) */
  disableModelInvocation?: boolean;
  /** Default: true (D-10) */
  userInvocable?: boolean;
  /** Default: [] — empty means all tools available (D-10) */
  allowedTools?: string[];
  /** Default: "" — empty means no soft hint (D-10) */
  whenToUse?: string;
  /** D-02: declaration of $name placeholders used in body. Default: [] */
  arguments?: string[];
}

/** D-01 four dispatch kinds. args is always a passthrough string (D-02).
 *  08.2 extensions: GoalLoop kind (C1-05). */
export type CommandDispatchAction =
  | { kind: 'SystemSilent'; command: SlashCommand; args: string }
  | { kind: 'SystemLocal'; command: SlashCommand; args: string }
  | { kind: 'PluginRewrite'; command: SlashCommand; args: string; prompt: string }
  | { kind: 'GoalLoop'; command: SlashCommand; args: string; goal: string };

/** D-07 lock: build phase RETURNS errors (does NOT throw). Renderer consumes
 *  the array to fire sonner toasts; both rows are preserved (D-05). */
export class CommandConflictError extends Error {
  constructor(
    public readonly commandName: string,
    public readonly conflicts: ReadonlyArray<{ source: CommandSource; badge: string }>
  ) {
    super(`Command conflict: ${commandName} registered from ${conflicts.length} sources`);
    this.name = 'CommandConflictError';
  }
}
