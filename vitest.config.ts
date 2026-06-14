import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// React 19 的 React.act 仅在 NODE_ENV !== 'production' 时导出。
// testing-library 16 的 act-compat 在模块加载时检查 typeof React.act，
// 若为 undefined 则后续 render() 报 "React.act is not a function"。
// 必须在任何模块加载前设置，因此放在 config 顶层而非 setupFiles。
process.env.NODE_ENV = 'test';

// 测试环境按运行区域分离：
// - main 进程测试（src/main/**）用 node 环境：它们 import `node:` 内置模块、
//   better-sqlite3 等原生依赖，jsdom 无法加载。
// - renderer 测试（src/renderer/**）用 jsdom 环境：组件测试需要 DOM。
//   通过 setupFiles 设置 IS_REACT_ACT_ENVIRONMENT 适配 React 19 + testing-library 16，
//   并用 @vitejs/plugin-react 提供 jsx automatic runtime。
const sharedResolve = {
  alias: {
    '@': path.resolve(__dirname, './src/renderer/src'),
    // Phase 08.3: mirror the Vite renderer alias so vitest can resolve
    // `@shared/types` from nested renderer files.
    '@shared': path.resolve(__dirname, './src/shared'),
  },
};

export default defineConfig({
  resolve: sharedResolve,
  test: {
    globals: true,
    projects: [
      {
        resolve: sharedResolve,
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: sharedResolve,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['./vitest.setup.ts'],
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
      },
    ],
  },
});
