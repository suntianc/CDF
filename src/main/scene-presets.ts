import type { ProjectScene } from '../shared/types';

export interface ScenePresetInitInput {
  projectId: string;
  projectPath: string;
  scene: ProjectScene;
}

export function initializeScenePreset(_input: ScenePresetInitInput): void {
  // Preset registration is intentionally empty until scene-specific defaults land.
}
