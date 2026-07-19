import { SCENE_REGISTRY, type SceneDefinition } from '../shared/scenes';
import type {
  GlobalSkillReference,
  SceneSkillExposure,
  SceneSkillExposureInput,
} from '../shared/skills';

const SCENE_SKILL_EXPOSURES_STORE_KEY = 'sceneSkillExposures';

type StoredSceneSkillExposures = Record<string, Record<string, boolean>>;

export interface SceneSkillExposureStorage {
  get(key: string): unknown;
  set(key: string, value: StoredSceneSkillExposures): void;
}

export interface SceneSkillExposureServiceOptions {
  storage: SceneSkillExposureStorage;
  registry?: readonly SceneDefinition[];
}

export interface SceneSkillExposureService {
  get(skill: SceneSkillExposureInput): SceneSkillExposure;
  set(
    skill: SceneSkillExposureInput,
    sceneId: string,
    exposed: boolean,
  ): SceneSkillExposure;
}

function getStorageKey(skill: GlobalSkillReference): string {
  return `${skill.sourceKind}:${skill.name}`;
}

function toReference(skill: SceneSkillExposureInput): GlobalSkillReference {
  return { sourceKind: skill.sourceKind, name: skill.name };
}

function readStoredExposures(value: unknown): StoredSceneSkillExposures {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: StoredSceneSkillExposures = {};
  for (const [skillKey, rawExposures] of Object.entries(value)) {
    if (!rawExposures || typeof rawExposures !== 'object' || Array.isArray(rawExposures)) continue;
    const exposures: Record<string, boolean> = {};
    for (const [sceneId, exposed] of Object.entries(rawExposures)) {
      if (typeof exposed === 'boolean') exposures[sceneId] = exposed;
    }
    result[skillKey] = exposures;
  }
  return result;
}

function resolveDefaultExposure(skill: SceneSkillExposureInput, sceneId: string): boolean {
  return skill.sourceKind === 'user' || skill.defaultSceneIds?.includes(sceneId) === true;
}

function resolveExposure(
  skill: SceneSkillExposureInput,
  stored: StoredSceneSkillExposures,
  registry: readonly SceneDefinition[],
): SceneSkillExposure {
  const reference = toReference(skill);
  const persisted = stored[getStorageKey(reference)] ?? {};
  const exposures = Object.fromEntries(registry.map((scene) => [
    scene.id,
    persisted[scene.id] ?? resolveDefaultExposure(skill, scene.id),
  ]));

  return { skill: reference, exposures };
}

export function createSceneSkillExposureService(
  options: SceneSkillExposureServiceOptions,
): SceneSkillExposureService {
  const registry = options.registry ?? SCENE_REGISTRY;

  return {
    get(skill) {
      return resolveExposure(
        skill,
        readStoredExposures(options.storage.get(SCENE_SKILL_EXPOSURES_STORE_KEY)),
        registry,
      );
    },
    set(skill, sceneId, exposed) {
      if (!registry.some((scene) => scene.id === sceneId)) {
        throw new Error(`Unknown Scene: ${sceneId}`);
      }
      if (typeof exposed !== 'boolean') {
        throw new Error('Scene Skill Exposure must be a boolean');
      }

      const stored = readStoredExposures(options.storage.get(SCENE_SKILL_EXPOSURES_STORE_KEY));
      const reference = toReference(skill);
      const skillKey = getStorageKey(reference);
      stored[skillKey] = { ...stored[skillKey], [sceneId]: exposed };
      options.storage.set(SCENE_SKILL_EXPOSURES_STORE_KEY, stored);

      return resolveExposure(skill, stored, registry);
    },
  };
}
