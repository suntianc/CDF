import store from './store';
import { createSceneSkillExposureService } from './scene-skill-exposure';
import { getBuiltInSkillRegistrations } from './deepagent/skill-manager';
import type { ProjectScene } from '../shared/types';

/** Resolves whether a Global Skill is exposed in a Project Scene. */
export function createGlobalSkillSceneExposureFilter(sceneId: ProjectScene) {
  const exposureService = createSceneSkillExposureService({
    storage: {
      get: (key) => store.get(key as 'sceneSkillExposures'),
      set: (key, value) => store.set(key as 'sceneSkillExposures', value),
    },
  });
  const builtInDefaults = new Map(
    getBuiltInSkillRegistrations().map((registration) => [registration.name, registration.defaultSceneIds]),
  );

  return ({ sourceKind, name }: { sourceKind: 'built-in' | 'user'; name: string }) => {
    const exposure = sourceKind === 'user'
      ? exposureService.get({ sourceKind, name })
      : exposureService.get({
        sourceKind,
        name,
        defaultSceneIds: builtInDefaults.get(name) ?? [],
      });
    return exposure.exposures[sceneId] === true;
  };
}
