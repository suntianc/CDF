import Store from 'electron-store';
import type { ApprovalMode } from '../shared/types';
import type { PersistedAISubscriptionState } from '../shared/ai-subscriptions';
import type { SkillOverrideState } from '../shared/skill-overrides';

type SceneSkillExposureStore = Record<string, Record<string, boolean>>;

interface StoreSchema {
  theme: 'light' | 'dark' | 'system';
  currentProjectId: string | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  windowBounds: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
  language: 'zh-CN' | 'en-US';
  // Phase 14: 全局审批模式默认值
  approvalMode: ApprovalMode;
  autoSave: boolean;
  skillOverrides: Record<string, SkillOverrideState>;
  sceneSkillExposures: SceneSkillExposureStore;
  aiSubscriptions: PersistedAISubscriptionState;
}

const store = new Store<StoreSchema>({
  defaults: {
    theme: 'system',
    currentProjectId: null,
    sidebarWidth: 280,
    sidebarCollapsed: false,
    windowBounds: { width: 1200, height: 800 },
    language: 'zh-CN',
    approvalMode: 'strict',
    autoSave: false,
    skillOverrides: {},
    sceneSkillExposures: {},
    aiSubscriptions: {},
  },
  schema: {
    theme: { type: 'string', enum: ['light', 'dark', 'system'] },
    currentProjectId: { type: ['string', 'null'] },
    sidebarWidth: { type: 'number', minimum: 200, maximum: 500 },
    sidebarCollapsed: { type: 'boolean' },
    windowBounds: {
      type: 'object',
      properties: {
        width: { type: 'number' },
        height: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['width', 'height'],
    },
    language: { type: 'string', enum: ['zh-CN', 'en-US'] },
    approvalMode: { type: 'string', enum: ['strict', 'agent_decides', 'bypass'] },
    autoSave: { type: 'boolean' },
    skillOverrides: {
      type: 'object',
      additionalProperties: {
        type: 'string',
        enum: ['on', 'name-only', 'user-invocable-only', 'off'],
      },
    },
    sceneSkillExposures: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: { type: 'boolean' },
      },
    },
    aiSubscriptions: {
      type: 'object',
      additionalProperties: true,
    },
  },
  clearInvalidConfig: true,
});

export default store;
