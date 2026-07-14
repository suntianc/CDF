export interface SceneDefinition {
  id: string;
  label: string;
}

/**
 * Product-owned Scene registry. New Scenes are registered here rather than
 * introducing per-Scene storage columns or component-specific fields.
 */
export const SCENE_REGISTRY = [
  { id: 'general', label: 'General' },
  { id: 'research', label: 'Research' },
] as const satisfies readonly SceneDefinition[];

export type SceneId = (typeof SCENE_REGISTRY)[number]['id'];

export function isRegisteredSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && SCENE_REGISTRY.some((scene) => scene.id === value);
}
