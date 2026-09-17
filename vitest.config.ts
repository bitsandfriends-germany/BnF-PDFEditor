import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Main-/Shared-Schicht laeuft in Node (kein DOM). Renderer-Komponententests laufen in jsdom.
// Aliase via fileURLToPath, damit das Workspace-Pfadzeichen '&' und Leerzeichen korrekt gemaessen.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
    setupFiles: ['tests/renderer/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: true
  }
})
