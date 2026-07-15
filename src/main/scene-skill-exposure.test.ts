import { describe, expect, it } from 'vitest';
import {
  SCENE_REGISTRY,
  type SceneDefinition,
} from '../shared/scenes';
import {
  createSceneSkillExposureService,
  type SceneSkillExposureStorage,
} from './scene-skill-exposure';
import { classifySkillSourceKind } from '../shared/skills';

function createMemoryStorage(initial: Record<string, unknown> = {}): SceneSkillExposureStorage {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

describe('Scene Skill Exposure product API', () => {
  it('publishes the current Scene registry with stable display metadata and Master defaults', () => {
    expect(SCENE_REGISTRY).toMatchObject([
      { id: 'general', label: 'General', defaultMasterPrompt: expect.any(String) },
      { id: 'research', label: 'Research', defaultMasterPrompt: expect.any(String) },
    ]);
    expect(SCENE_REGISTRY.every((scene) => scene.defaultMasterPrompt.length > 0)).toBe(true);
  });

  it('resolves Built-in defaults, persists user changes, and reads them back', () => {
    const storage = createMemoryStorage();
    const service = createSceneSkillExposureService({ storage });
    const skill = {
      sourceKind: 'built-in' as const,
      name: 'paper-search',
      defaultSceneIds: ['research'],
    };

    expect(service.get(skill)).toEqual({
      skill: { sourceKind: 'built-in', name: 'paper-search' },
      exposures: { general: false, research: true },
    });

    expect(service.set(skill, 'general', true)).toEqual({
      skill: { sourceKind: 'built-in', name: 'paper-search' },
      exposures: { general: true, research: true },
    });

    expect(createSceneSkillExposureService({ storage }).get(skill)).toEqual({
      skill: { sourceKind: 'built-in', name: 'paper-search' },
      exposures: { general: true, research: true },
    });
  });

  it('defaults user-global Skills to every current and newly registered Scene', () => {
    const registry: readonly SceneDefinition[] = [
      ...SCENE_REGISTRY,
      { id: 'future', label: 'Future' },
    ];
    const service = createSceneSkillExposureService({
      storage: createMemoryStorage(),
      registry,
    });

    expect(service.get({ sourceKind: 'user', name: 'personal-review' })).toEqual({
      skill: { sourceKind: 'user', name: 'personal-review' },
      exposures: { general: true, research: true, future: true },
    });
  });

  it('defaults undeclared Built-in Skills off for a newly registered Scene', () => {
    const registry: readonly SceneDefinition[] = [
      ...SCENE_REGISTRY,
      { id: 'future', label: 'Future' },
    ];
    const service = createSceneSkillExposureService({
      storage: createMemoryStorage(),
      registry,
    });

    expect(service.get({
      sourceKind: 'built-in',
      name: 'paper-search',
      defaultSceneIds: ['research'],
    })).toEqual({
      skill: { sourceKind: 'built-in', name: 'paper-search' },
      exposures: { general: false, research: true, future: false },
    });
  });

  it('classifies only Built-in and user-global sources as Global Skills', () => {
    expect(classifySkillSourceKind('built-in')).toBe('global');
    expect(classifySkillSourceKind('user')).toBe('global');
    expect(classifySkillSourceKind('project')).toBe('project');
    expect(classifySkillSourceKind('project-nested')).toBe('project');
    expect(classifySkillSourceKind('project-additional')).toBe('project');
    expect(classifySkillSourceKind('enterprise')).toBe('unmanaged');
  });
});
