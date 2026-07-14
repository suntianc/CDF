import { isRegisteredSceneId } from '@shared/scenes';
import type { ProjectScene } from '@shared/types';

export const DEFAULT_PROJECT_SCENE: ProjectScene = 'general';

export function normalizeProjectScene(scene: unknown): ProjectScene {
  return isRegisteredSceneId(scene) ? scene : DEFAULT_PROJECT_SCENE;
}
