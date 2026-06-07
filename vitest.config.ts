import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    server: {
      deps: {
        // Phase 8 — App.test.tsx renders the full App tree, which transitively
        // imports @lobehub/icons. lobehub ships ESM with deep peer-dep chains
        // (@lobehub/ui, antd-style) that Vite's pre-bundler chokes on in jsdom.
        // Forcing Vite to transform these via esbuild (inline) bypasses the
        // pre-bundler and lets App render in tests.
        inline: ['@lobehub/icons', '@lobehub/ui', 'antd-style'],
      },
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
      // Phase 08.3: mirror the Vite renderer alias so vitest can resolve
      // `@shared/types` from nested renderer files.
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
