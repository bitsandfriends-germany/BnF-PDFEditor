// Reiner Renderer-Dev-Server für die Browser-E2Es (kein Electron-Binary nötig).
// Spiegelt den renderer-Block aus electron.vite.config.ts; die native Bridge wird im Test
// durch einen Stub ersetzt (tests/e2e/browser/bridge.ts) — HTTP, UI und Stores sind echt.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('../src/renderer', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../src/shared', import.meta.url)),
      '@': fileURLToPath(new URL('../src/renderer', import.meta.url))
    }
  },
  server: { port: 5199, strictPort: true }
})
