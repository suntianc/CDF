import Store from 'electron-store';

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
}

const store = new Store<StoreSchema>({
  defaults: {
    theme: 'system',
    currentProjectId: null,
    sidebarWidth: 280,
    sidebarCollapsed: false,
    windowBounds: { width: 1200, height: 800 },
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
  },
  clearInvalidConfig: true,
});

export default store;
