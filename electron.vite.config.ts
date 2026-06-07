import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Phase 08.3 build-fix: jsdom / @mozilla/readability / turndown
    // are used by fetch-tool.ts at runtime. externalizeDepsPlugin's
    // default `include` set externalizes ALL production deps — but
    // electron-builder does NOT copy `node_modules` into the app
    // bundle, so the runtime `require('jsdom')` fails at app startup
    // with "Cannot find module 'jsdom'". Excluding these three from
    // the externalizer makes Vite bundle them directly into the
    // main chunk, eliminating the runtime require path.
    plugins: [externalizeDepsPlugin({ exclude: ['jsdom', '@mozilla/readability', 'turndown'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        external: ['canvas', '@napi-rs/canvas']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        // Phase 08.3: shared types module is importable from renderer
        // (e.g. `MAX_AT_MENTION_CANDIDATES`). Keeps the import path
        // stable across nested directories and works with both
        // Vite (build) and Vitest (test) resolution.
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
