import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Real multi-participant live-class run: real FastAPI backend, throwaway SQLite database, real
 * production frontend build, and the REAL LiveKit Cloud project (credentials read from
 * backend/.env — never hardcoded here, never committed). This is the only suite that actually
 * exercises LiveKit's live servers; everything else fakes ensure_room/generate_access_token.
 * Run: npm run test:e2e:live
 */
const FRONTEND_PORT = 4176
const BACKEND_PORT = 8011
const dir = mkdtempSync(join(tmpdir(), 'eduvillage-live-'))
const db = `sqlite:///${join(dir, 'e2e.db').replace(/\\/g, '/')}`

function readBackendEnv(key: string): string {
  const text = readFileSync(join(__dirname, '../backend/.env'), 'utf-8')
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))
  if (!line) throw new Error(`${key} not found in backend/.env — real LiveKit credentials are required for this suite.`)
  return line.slice(key.length + 1).trim()
}

const LIVEKIT_URL = readBackendEnv('LIVEKIT_URL')
const LIVEKIT_API_KEY = readBackendEnv('LIVEKIT_API_KEY')
const LIVEKIT_API_SECRET = readBackendEnv('LIVEKIT_API_SECRET')

export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        // lets getDisplayMedia pick a screen without a human, so screen sharing can be exercised
        '--auto-select-desktop-capture-source=Entire screen',
        '--enable-usermedia-screen-capturing',
      ],
    },
  },
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
        TEACHER_COLLEGE_REQUIRED: 'false',
        STUDENT_COLLEGE_REQUIRED: 'false',
        TEACHER_INVITE_CODE: '',
        LIVEKIT_URL,
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET,
      },
    },
    {
      command: `npm run build && npx vite preview --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_API_BASE_URL: `http://localhost:${BACKEND_PORT}`, VITE_E2E_TEST_HOOKS: 'true' },
    },
  ],
})
