import type Database from 'better-sqlite3';
import {
  getBuiltInSkillDirs,
  getScopePath,
} from './deepagent/skill-manager';
import { createGlobalSkillSceneExposureFilter } from './global-skill-scene-exposure';
import {
  resolveSkillCatalog,
  resolveSkillSourcePlan,
  type ResolvedSkillCatalogEntry,
} from './deepagent/skills-runtime/skill-sources';
import type { ProjectScene } from '../shared/types';
import type {
  ConversationSkillSnapshotEntry,
  GlobalSkillSourceKind,
  SkillSourceKind,
} from '../shared/skills';

export interface ConversationSystemContextSnapshot {
  promptSnapshot: string;
  skillSnapshot: ConversationSkillSnapshotEntry[];
}

function isGlobalSkillSourceKind(sourceKind: SkillSourceKind): sourceKind is GlobalSkillSourceKind {
  return sourceKind === 'built-in' || sourceKind === 'user';
}


function snapshotSkill(skill: ResolvedSkillCatalogEntry): ConversationSkillSnapshotEntry {
  return {
    name: skill.name,
    qualifiedName: skill.qualifiedName,
    qualifier: skill.qualifier,
    description: skill.description,
    argumentHint: skill.argumentHint,
    allowedTools: skill.allowedTools,
    whenToUse: skill.whenToUse,
    arguments: skill.arguments,
    sourceKind: skill.sourceKind,
    sourcePath: skill.sourcePath,
    skillPath: skill.skillPath,
    modelDiscovery: skill.modelDiscovery,
    userInvocable: skill.userInvocable,
  };
}

export function captureConversationSystemContextSnapshot(input: {
  projectPath: string;
  sceneId: ProjectScene;
  promptSnapshot: string;
}): ConversationSystemContextSnapshot {
  const plan = resolveSkillSourcePlan(input.projectPath, {
    builtInSkillDirs: getBuiltInSkillDirs(),
    userSkillsDir: getScopePath(input.projectPath, 'global'),
    includeNestedProjectSkills: true,
  });
  const isGlobalSkillExposed = createGlobalSkillSceneExposureFilter(input.sceneId);
  const catalog = resolveSkillCatalog(plan, {
    includeSkill: (source, name) => !isGlobalSkillSourceKind(source.kind)
      || isGlobalSkillExposed({ sourceKind: source.kind, name }),
    includeNestedProjectSkills: true,
  });

  return {
    promptSnapshot: input.promptSnapshot,
    skillSnapshot: catalog.skills.map(snapshotSkill),
  };
}

export function getConversationSkillSnapshot(
  db: Database.Database,
  sessionId: string,
): ConversationSkillSnapshotEntry[] | null {
  const session = db.prepare('SELECT skill_snapshot FROM sessions WHERE id = ?').get(sessionId) as
    | { skill_snapshot?: string | null }
    | undefined;
  if (session?.skill_snapshot == null) return null;

  try {
    const parsed = JSON.parse(session.skill_snapshot) as unknown;
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as ConversationSkillSnapshotEntry[];
  } catch {
    throw new Error(`Conversation Skill Snapshot is invalid: ${sessionId}`);
  }
}

/**
 * Reads a Conversation's durable system context, capturing missing legacy
 * snapshots exactly once. Every caller therefore observes the same frozen
 * prompt and Skill catalog after the first authoritative access.
 */
export function getOrCaptureConversationSystemContextSnapshot(
  db: Database.Database,
  input: {
    sessionId: string;
    projectPath: string;
    sceneId: ProjectScene;
    promptSnapshot: string;
  },
): ConversationSystemContextSnapshot {
  const session = db.prepare(
    'SELECT prompt_snapshot, skill_snapshot FROM sessions WHERE id = ?',
  ).get(input.sessionId) as
    | { prompt_snapshot?: string | null; skill_snapshot?: string | null }
    | undefined;
  const existingSkills = getConversationSkillSnapshot(db, input.sessionId);
  const existingPrompt = session?.prompt_snapshot;
  if (existingPrompt != null && existingSkills !== null) {
    return { promptSnapshot: existingPrompt, skillSnapshot: existingSkills };
  }

  const captured = captureConversationSystemContextSnapshot(input);
  const promptSnapshot = existingPrompt ?? captured.promptSnapshot;
  const skillSnapshot = existingSkills ?? captured.skillSnapshot;
  if (session) {
    db.prepare(
      'UPDATE sessions SET prompt_snapshot = COALESCE(prompt_snapshot, ?), skill_snapshot = COALESCE(skill_snapshot, ?) WHERE id = ?',
    ).run(promptSnapshot, JSON.stringify(skillSnapshot), input.sessionId);
  }
  return { promptSnapshot, skillSnapshot };
}
