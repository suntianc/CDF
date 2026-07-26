import type Database from 'better-sqlite3';
import { createGlobalSkillSceneExposureFilter } from './global-skill-scene-exposure';
import { captureConversationSkillSnapshot } from './deepagent/skill-catalog';
import type { ProjectScene } from '../shared/types';
import type { ConversationSkillSnapshotEntry } from '../shared/skills';

export interface ConversationSystemContextSnapshot {
  promptSnapshot: string;
  skillSnapshot: ConversationSkillSnapshotEntry[];
}

export function captureConversationSystemContextSnapshot(input: {
  projectPath: string;
  sceneId: ProjectScene;
  promptSnapshot: string;
}): ConversationSystemContextSnapshot {
  return {
    promptSnapshot: input.promptSnapshot,
    skillSnapshot: captureConversationSkillSnapshot({
      projectPath: input.projectPath,
      isGlobalSkillExposed: createGlobalSkillSceneExposureFilter(input.sceneId),
    }),
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
