import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Phase 08.3 build-fix: jsdom / @mozilla/readability / turndown
    // are runtime deps of fetch-tool.ts. Vite externalizes them so
    // electron-builder picks them up from node_modules/ and copies
    // their full package contents (incl. sub-resources like jsdom's
    // ./xhr-sync-worker.js) into app.asar/node_modules. The previous
    // `exclude` approach inlined jsdom's main entry but missed the
    // sibling sub-resource files, causing a runtime
    // "Cannot find module './xhr-sync-worker.js'" at startup.
    plugins: [externalizeDepsPlugin()],
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
