import type Database from 'better-sqlite3';
import store from './store';
import { createSceneSkillExposureService } from './scene-skill-exposure';
import {
  getBuiltInSkillDirs,
  getBuiltInSkillRegistrations,
  getScopePath,
} from './deepagent/skill-manager';
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

function createGlobalSkillSceneExposureFilter(sceneId: ProjectScene) {
  const exposureService = createSceneSkillExposureService({
    storage: {
      get: (key) => store.get(key as 'sceneSkillExposures'),
      set: (key, value) => store.set(key as 'sceneSkillExposures', value),
    },
  });
  const builtInDefaults = new Map(
    getBuiltInSkillRegistrations().map((registration) => [registration.name, registration.defaultSceneIds]),
  );

  return (sourceKind: GlobalSkillSourceKind, name: string) => exposureService.get({
    sourceKind,
    name,
    defaultSceneIds: sourceKind === 'built-in' ? builtInDefaults.get(name) ?? [] : undefined,
  }).exposures[sceneId] === true;
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
  });
  const isGlobalSkillExposed = createGlobalSkillSceneExposureFilter(input.sceneId);
  const catalog = resolveSkillCatalog(plan, {
    includeSkill: (source, name) => !isGlobalSkillSourceKind(source.kind)
      || isGlobalSkillExposed(source.kind, name),
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
  if (!session?.skill_snapshot) return null;

  try {
    const parsed = JSON.parse(session.skill_snapshot) as unknown;
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as ConversationSkillSnapshotEntry[];
  } catch {
    throw new Error(`Conversation Skill Snapshot is invalid: ${sessionId}`);
  }
}
