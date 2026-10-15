import { defineConfig, devices } from '@playwright/test'

/**
 * Offline-shell tests need the real service worker, which only exists in a production build, so
 * they run against `vite preview` (not the dev server) with the backend mocked at the network layer.
 *   npx playwright test -c playwright.offline.config.ts
 */
export default defineConfig({
  testDir: './e2e-offline',
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  projects: [{ name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
})
