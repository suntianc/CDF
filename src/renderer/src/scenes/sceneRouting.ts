import type { ProjectScene } from '@shared/types';

export const DEFAULT_PROJECT_SCENE: ProjectScene = 'general';

const projectScenes = new Set<ProjectScene>(['general', 'research']);

export function normalizeProjectScene(scene: unknown): ProjectScene {
  return typeof scene === 'string' && projectScenes.has(scene as ProjectScene)
    ? scene as ProjectScene
    : DEFAULT_PROJECT_SCENE;
}
