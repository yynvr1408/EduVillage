import { defineConfig, devices } from '@playwright/test'

/** Renders real pages at real viewport sizes against a production build: npm run test:e2e:layout */
export default defineConfig({
  testDir: './e2e-layout',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4174' },
  projects: [{ name: 'Chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
})
