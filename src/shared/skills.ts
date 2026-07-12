import type {
  SkillEffectiveVisibility,
  SkillModelDiscovery,
  SkillVisibilitySource,
} from './skill-overrides';

export type SkillCommandSourceKind =
  | 'built-in'
  | 'project'
  | 'project-nested'
  | 'project-additional'
  | 'user'
  | 'enterprise';

// IPC 保存入参：以 db:saveSkill handler 实际消费的字段为真（写入物理 Skill 文件）。
export interface SkillSaveInput {
  name: string;
  description?: string;
  script_type?: string;
  script_content?: string;
  scope?: 'project' | 'global';
}

export interface Skill {
  id: string;
  name: string;
  qualifiedName?: string;
  description?: string;
  scope: 'project' | 'global';
  sourceKind?: SkillCommandSourceKind;
  sourceLabel?: string;
  sourcePath?: string;
  skillPath?: string;
  skillVisibility?: SkillEffectiveVisibility;
  visibilitySource?: SkillVisibilitySource;
  modelDiscovery?: SkillModelDiscovery;
  userInvocable?: boolean;
  editable?: boolean;
  resourceFiles: string[];
  created_at: number;
  updated_at: number;
  shadowedSkills?: SkillShadowedEntry[];
}

export interface SkillShadowedEntry {
  name: string;
  qualifiedName?: string;
  sourceKind?: SkillCommandSourceKind;
  sourceLabel?: string;
  sourcePath?: string;
  skillPath?: string;
}

export type SkillAttributionPhase =
  | 'model-discovery'
  | 'preload'
  | 'explicit-invocation'
  | 'model-triggered';

export interface SkillAttribution {
  phase: SkillAttributionPhase;
  name: string;
  qualifiedName: string;
  sourceKind: SkillCommandSourceKind;
  sourceLabel: string;
  skillPath: string;
  visibility: SkillEffectiveVisibility;
  modelDiscovery: SkillModelDiscovery;
  userInvocable: boolean;
}
