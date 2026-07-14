import type { SceneId } from './scenes';

export type ProjectScene = SceneId;

export interface Project {
  id: string;
  name: string;
  path: string;
  scene: ProjectScene;
  created_at: number;
  updated_at: number;
  isGit?: boolean;
}
