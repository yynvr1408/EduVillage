import { test, expect, type Page } from '@playwright/test'

/**
 * Assignment submission states in a real browser (real IndexedDB, real service worker, real offline
 * switching). The backend is faked at the network layer: each scenario decides what the "server" answers,
 * so these tests prove the client NEVER shows server confirmation unless the server confirmed it.
 */

const API = 'http://localhost:8000'
const ORIGIN = 'http://localhost:4173'
const USER = { id: 'u1', email: 'student@eduvillage.org', full_name: 'Amina Diallo', role: 'student', status: 'active' }
const COURSE = { id: 'c1', title: 'Biology', description: 'd', subject: 'BIO', teacher_id: 't1', teacher_name: 'Prof', status: 'published', created_at: '2026-01-01T00:00:00' }
const ASSIGNMENT = { id: 'a1', course_id: 'c1', created_by: 't1', title: 'Cell quiz', instructions: 'Describe organelles.', due_at: '2026-12-31T00:00:00', status: 'published' }

const server = { offline: false, syncMode: 'accept' as 'accept' | 'expired' | 'down', confirmed: false, syncCalls: 0 }

async function mockBackend(page: Page) {
  Object.assign(server, { offline: false, syncMode: 'accept', confirmed: false, syncCalls: 0 })
  await page.route(`${API}/**`, async (route) => {
    if (server.offline) return route.abort('internetdisconnected')
    const req = route.request()
    const p = new URL(req.url()).pathname
    const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type, range' }
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (p === '/health') return json({ status: 'ok' })
    if (p.endsWith('/auth/login')) return json({ user: USER })
    if (p.endsWith('/users/me')) return json(USER)
    if (p === '/api/v1/courses') return json([COURSE])
    if (p === '/api/v1/assignments/a1') return json(ASSIGNMENT)
    if (p === '/api/v1/assignments/a1/submissions/me') {
      return server.confirmed
        ? json({ id: 's1', assignment_id: 'a1', student_id: 'u1', answer: { text: 'my answer' }, status: 'submitted', version: 1, submitted_at: '2026-10-01T00:00:00', updated_at: '2026-10-01T00:00:00' })
        : json({ error: { code: 'NOT_FOUND', message: 'No submission saved yet.' } }, 404)
    }
    if (p === '/api/v1/sync/operations') {
      server.syncCalls++
      const ops = JSON.parse(req.postData() || '{}').operations as Array<{ operation_id: string }>
      if (server.syncMode === 'down') return route.abort('connectionrefused')
      if (server.syncMode === 'expired') {
        return json({ results: ops.map((o) => ({ operation_id: o.operation_id, status: 'conflict', error_code: 'SUBMISSION_EXPIRED', message: 'The deadline for this assignment has passed, so it no longer accepts submissions.' })) })
      }
      server.confirmed = true
      return json({ results: ops.map((o) => ({ operation_id: o.operation_id, status: 'accepted', server_entity_id: 's1', server_version: 1 })) })
    }
    return json([])
  })
}

async function openAssignment(page: Page) {
  await page.goto('/login/student')
  await page.fill('#email', 'student@eduvillage.org')
  await page.fill('#password', 'student123')
  await page.click('button:has-text("Sign In")')
  await page.waitForURL(/\/student\/dashboard/)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.goto('/student/assignments/a1')
  await expect(page.getByRole('textbox')).toBeVisible()
}

test('an expired submission is shown as "Deadline passed" - never as confirmed - and survives a reload', async ({ page }) => {
  await mockBackend(page)
  server.syncMode = 'expired'
  await openAssignment(page)
  await page.getByRole('textbox').fill('my answer')
  await page.getByRole('button', { name: /submit to teacher/i }).click()

  await expect(page.getByText('Deadline passed', { exact: true })).toBeVisible()
  await expect(page.getByText('Server Confirmed', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/deadline for this assignment has passed/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /submit to teacher/i })).toBeDisabled()

  // The student's text is still on this device and the refusal is remembered after a reload.
  await page.reload()
  await expect(page.getByRole('textbox')).toHaveValue('my answer')
  await expect(page.getByText('Server Confirmed', { exact: true })).toHaveCount(0)
})

test('offline submission waits, syncs on reconnection, and is confirmed only once the server has it', async ({ page, context }) => {
  await mockBackend(page)
  await openAssignment(page)
  await page.getByRole('textbox').fill('my answer')

  await context.setOffline(true)
  server.offline = true
  await page.getByRole('button', { name: /queue offline submission|submit to teacher/i }).click()
  await expect(page.getByText('Waiting to sync', { exact: true })).toBeVisible()
  await expect(page.getByText('Server Confirmed', { exact: true })).toHaveCount(0)
  expect(server.syncCalls).toBe(0) // nothing reached the server while offline

  // The connection returns: the queue syncs, the server accepts, and only then does the page say so.
  server.offline = false // the server must be reachable BEFORE the browser reports online, or the first check fails
  await context.setOffline(false)
  await expect.poll(() => server.syncCalls, { timeout: 30000 }).toBeGreaterThan(0)
  await page.reload()
  await expect(page.getByText('Server Confirmed', { exact: true })).toBeVisible()
  await expect(page.getByText('Waiting to sync', { exact: true })).toHaveCount(0)
})

test('while the server is unreachable the draft stays "waiting" and is never reported as received', async ({ page }) => {
  await mockBackend(page)
  server.syncMode = 'down'
  await openAssignment(page)
  await page.getByRole('textbox').fill('my answer')
  await page.getByRole('button', { name: /submit to teacher/i }).click()
  await expect(page.getByText('Waiting to sync', { exact: true })).toBeVisible()
  await expect(page.getByText('Server Confirmed', { exact: true })).toHaveCount(0)
  expect(server.confirmed).toBe(false)
})
