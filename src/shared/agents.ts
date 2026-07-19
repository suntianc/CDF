import type { SceneId } from './scenes';

export function generateAgentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export const AGENT_BUILT_IN_TOOL_NAMES = [
  'write_todos',
  'read_file',
  'write_file',
  'edit_file',
  'ls',
  'glob',
  'grep',
  'delete_file',
  'bash',
  'fetch',
  'obscura_browse',
  'knowledge_search',
  'knowledge_create',
  'manage_flow_diagram',
  'generate_image',
  'generate_video',
  'manage_background_jobs',
  'synthesize_speech',
  'generate_music',
  'tavily_search',
  'anysearch',
  'arxiv_search',
  'arxiv_get_papers',
] as const;

export interface AgentToolScopeConfig {
  mode: 'inherit' | 'narrow';
  builtInTools?: string[];
  mcpServerIds?: string[];
}

export type AgentRole = 'master' | 'general-purpose' | 'custom';

/** Global Agent Library transport. Project ownership and legacy protection flags
 * are intentionally absent: identity is expressed solely through `role`. */
export interface Agent {
  id: string;
  role: AgentRole;
  name: string;
  slug?: string;
  description?: string;
  provider_id?: string;
  system_prompt?: string;
  config?: Record<string, unknown>;
  mcpServerExclusionIds?: string[];
  /** Global Skill reference ids only (`built-in:*` or `global:*`). */
  skillNames?: string[];
  created_at: number;
  updated_at: number;
}

export interface AgentCapabilityInput {
  description?: string | null;
  provider_id?: string | null;
  system_prompt?: string | null;
  config?: Record<string, unknown> | null;
  mcpServerExclusionIds?: string[];
  skillNames?: string[];
}

export interface CreateCustomAgentInput extends AgentCapabilityInput {
  id: string;
  name: string;
}

export interface UpdateCustomAgentInput extends AgentCapabilityInput {
  name?: string;
}

/** The reserved General-purpose identity can only change its capabilities. */
export type UpdateGeneralPurposeAgentInput = AgentCapabilityInput;

export interface MasterScenePrompt {
  scene: SceneId;
  systemPrompt: string;
  defaultSystemPrompt: string;
}

export interface SaveMasterScenePromptsInput {
  scene: SceneId;
  systemPrompt: string;
}
