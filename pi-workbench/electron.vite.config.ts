import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      exclude: ['electron-store', 'conf', 'atomically', 'debounce-fn', 'dot-prop', 'env-paths']
    })]
  },
  preload: {
    plugins: [externalizeDepsPlugin({
      exclude: ['electron-store', 'conf', 'atomically', 'debounce-fn', 'dot-prop', 'env-paths']
    })]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})