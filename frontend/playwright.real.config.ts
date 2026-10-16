import { defineConfig, devices } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Real end-to-end run: the actual FastAPI backend on a throwaway SQLite database plus the production frontend
 * build. Nothing is mocked. Admin credentials are random per run and exist only in this process' environment.
 * Run: npm run test:e2e:real
 */
const FRONTEND_PORT = 4175
const BACKEND_PORT = 8010
const dir = mkdtempSync(join(tmpdir(), 'eduvillage-real-'))
const db = `sqlite:///${join(dir, 'e2e.db').replace(/\\/g, '/')}`

process.env.E2E_ADMIN_USERNAME ||= `admin-${randomBytes(3).toString('hex')}`
process.env.E2E_ADMIN_PASSWORD ||= randomBytes(18).toString('base64url')

export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${FRONTEND_PORT}` },
  projects: [{ name: 'Chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `python -m alembic upgrade head && python -m uvicorn app.main:app --port ${BACKEND_PORT}`,
      cwd: '../backend',
      url: `http://localhost:${BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: db,
        APP_ENV: 'development',
        FRONTEND_ORIGIN: `http://localhost:${FRONTEND_PORT}`,
        SESSION_COOKIE_SAMESITE: 'lax',
        STORAGE_BACKEND: 'local',
        TEACHER_COLLEGE_REQUIRED: 'true',
        TEACHER_INVITE_CODE: '',
        // never send real email from a test run; the sign-in code is then shown on screen (development mode)
        EMAILJS_SERVICE_ID: '',
        EMAILJS_TEMPLATE_ID: '',
        EMAILJS_PUBLIC_KEY: '',
        EMAILJS_PRIVATE_KEY: '',
        CONCURRENT_LOGIN_OTP: 'true',
        ADMIN_USERNAME: process.env.E2E_ADMIN_USERNAME,
        ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
      },
    },
    {
      command: `npm run build && npx vite preview --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_API_BASE_URL: `http://localhost:${BACKEND_PORT}` },
    },
  ],
})
