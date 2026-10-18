import { test, expect, type Page } from '@playwright/test'

/**
 * Live class connectivity in a real browser with the REAL livekit-client. There is no LiveKit server in
 * this environment, so the media connection genuinely fails to establish; what is verified here is how the
 * app diagnoses and explains that, using three separate signals (device, LanternEd API, live media).
 * Successful live audio/video, quality adaptation on a real network and reconnection to a real server
 * are NOT covered (they need a LiveKit server and participants).
 */

const API = 'http://localhost:8000'
const ORIGIN = 'http://localhost:4173'
const USER = { id: 'u1', email: 'student@eduvillage.org', full_name: 'Amina Diallo', role: 'student', status: 'active' }
const COURSE = { id: 'c1', title: 'Biology', description: 'd', subject: 'BIO', teacher_id: 't1', teacher_name: 'Prof', status: 'published', created_at: '2026-01-01T00:00:00' }
const CLASS = { id: 'k1', course_id: 'c1', teacher_id: 't1', title: 'Cell Biology Live', scheduled_start: '2026-10-15T10:00:00', scheduled_end: null, status: 'live', livekit_room_name: 'room-1', section_ids: [] }

const net = { apiUp: true }

async function mockBackend(page: Page) {
  net.apiUp = true
  await page.route(`${API}/**`, async (route) => {
    if (!net.apiUp) return route.abort('connectionrefused')
    const req = route.request()
    const p = new URL(req.url()).pathname
    const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type, range' }
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (p === '/health') return json({ status: 'ok' })
    if (p.endsWith('/auth/login')) return json({ user: USER })
    if (p.endsWith('/users/me')) return json(USER)
    if (p === '/api/v1/courses') return json([COURSE])
    if (p === '/api/v1/classes/k1') return json(CLASS)
    if (p === '/api/v1/classes/k1/join-token') {
      // A LiveKit URL nothing listens on: the media connection cannot be established.
      return json({ livekit_url: 'ws://127.0.0.1:9', token: 'not-a-real-token', room_name: 'room-1', can_publish: false, recording_active: false })
    }
    if (p === '/api/v1/classes/k1/summary') return json({ error: { code: 'NOT_FOUND', message: 'none' } }, 404)
    return json([])
  })
}

async function signInAndJoin(page: Page) {
  await page.goto('/login/student')
  await page.fill('#email', 'student@eduvillage.org')
  await page.fill('#password', 'student123')
  await page.click('button:has-text("Sign In")')
  await page.waitForURL(/\/student\/dashboard/)
  await page.goto('/classroom/k1')
}

test('media down while internet and API are fine: the guidance names the live server, not the user\'s connection', async ({ page }) => {
  test.setTimeout(90000)
  await mockBackend(page)
  await signInAndJoin(page)

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible({ timeout: 45000 }) // sustained outage (20 s grace) before recovery is offered
  await expect(dialog).toContainText('The live class connection was lost')
  await expect(dialog).toContainText(/internet and LanternEd are working/i)
  await expect(dialog.getByRole('link', { name: /go to downloads/i })).toHaveAttribute('href', '/student/downloads')
})

test('when the device itself goes offline the guidance changes to say so (separate signals)', async ({ page, context }) => {
  test.setTimeout(90000)
  await mockBackend(page)
  await signInAndJoin(page)
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible({ timeout: 45000 })
  await expect(dialog).toContainText('The live class connection was lost')

  net.apiUp = false
  await context.setOffline(true)
  await expect(dialog).toContainText('Your device is offline')
  await expect(dialog).toContainText(/no internet connection/i)
  await expect(dialog).toContainText(/downloaded/i)

  // Device back online: the headline no longer claims the device is offline.
  net.apiUp = true
  await context.setOffline(false)
  await expect(dialog).not.toContainText('Your device is offline', { timeout: 20000 })
})

test('"Go to Downloads" from the recovery panel works with no network at all', async ({ page, context }) => {
  test.setTimeout(90000)
  await mockBackend(page)
  await signInAndJoin(page)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 45000 })
  net.apiUp = false
  await context.setOffline(true)
  await page.getByRole('link', { name: /go to downloads/i }).click()
  await expect(page).toHaveURL(/\/student\/downloads/)
  await expect(page.getByText('Offline Learning Downloads')).toBeVisible()
})
