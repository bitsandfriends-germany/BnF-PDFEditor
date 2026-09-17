import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// electron-vite v4 auf Vite ^5. Drei Builds: main (Node), preload (Node), renderer (Chromium).
// main/preload: electron + Node-Builtins sind laut electron-vite bereits extern; externalizeDepsPlugin
// hält zusätzlich alle package.json-dependencies extern (Node braucht sie zur Laufzeit aus node_modules).
// renderer: klassischer Vite/React-Build. pdfjs-Dist wird erst in Step 8 eingebunden.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
      }
    },
    build: {
      outDir: 'out/main'
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
      }
    },
    build: {
      outDir: 'out/preload'
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '@': fileURLToPath(new URL('./src/renderer', import.meta.url))
      }
    },
    build: {
      outDir: 'out/renderer'
    }
  }
})
