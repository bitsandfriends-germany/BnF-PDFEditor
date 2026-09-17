import { defineConfig } from '@playwright/test'

// Zwei Projekte:
// 1) electron (altes Verhalten): Smoke gegen das GEBAUTE App-Binary, braucht Display +
//    PDF_EDITOR_APP_PATH, ueberspringt sonst sauber.
// 2) browser (PART 3 §3, hier lauffaehig): echter Renderer (Vite) + echtes Python-Backend +
//    headless Chromium; nur die native Bridge ist gestubbted. Aktiv mit E2E_BROWSER=1:
//    npm run test:e2e:browser   (startet Backend via globalSetup + Vite via webServer).

const browserMode = process.env['E2E_BROWSER'] === '1'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalSetup: browserMode ? './tests/e2e/browser/globalSetup.ts' : undefined,
  webServer: browserMode
    ? { command: 'npx vite --config scripts/vite.e2e.config.ts', url: 'http://localhost:5199', reuseExistingServer: true, timeout: 60_000 }
    : undefined,
  use: {
    actionTimeout: 20_000
  },
  projects: [
    // NUR die Top-Level-Specs (native App): '*.spec.ts' ohne Pfadanteil matcht sonst AUCH
    // browser/** und liesse die Browser-Suite ohne Backend gegen die Electron-App laufen (R74-Fund).
    { name: 'electron', testMatch: /tests\/e2e\/[^/]+\.spec\.ts$/ },
    { name: 'browser', testMatch: 'browser/**/*.spec.ts' }
  ]
})
