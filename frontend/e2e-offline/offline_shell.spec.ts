import { test, expect, type Page } from '@playwright/test'

const API = 'http://localhost:8000'
const USER = { id: 'u1', email: 'student@eduvillage.org', full_name: 'Amina Diallo', role: 'student', status: 'active' }

/** The backend, mocked at the network layer. Only auth and health exist; everything else is empty. */
const net = { offline: false }

async function mockBackend(page: Page) {
  net.offline = false
  await page.route(`${API}/**`, async (route) => {
    // Playwright answers mocked requests before the network layer, so an "offline" browser must be
    // simulated here too: a real offline device cannot reach the API at all.
    if (net.offline) return route.abort('internetdisconnected')
    const url = route.request().url()
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': 'http://localhost:4173', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) })
    if (route.request().method() === 'OPTIONS') return json({}, 204)
    if (url.endsWith('/health')) return json({ status: 'ok' })
    if (url.endsWith('/auth/login')) return json({ user: USER })
    if (url.endsWith('/users/me')) return json(USER)
    return json([])
  })
}

/** A valid 1-second 8 kHz mono 8-bit WAV: small, but a real file the browser must decode. */
const wavBytes = (): number[] => {
  const samples = 8000
  const buf = new Uint8Array(44 + samples)
  const dv = new DataView(buf.buffer)
  const w = (o: number, s: string) => [...s].forEach((c, i) => (buf[o + i] = c.charCodeAt(0)))
  w(0, 'RIFF'); dv.setUint32(4, 36 + samples, true); w(8, 'WAVE'); w(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true)
  w(36, 'data'); dv.setUint32(40, samples, true)
  buf.fill(128, 44)
  return Array.from(buf)
}

async function seedDownloads(page: Page) {
  await page.evaluate(async (wav) => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('EduVillageDB')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const db = await open()
    const tx = db.transaction('downloadedResources', 'readwrite')
    const store = tx.objectStore('downloadedResources')
    const now = new Date().toISOString()
    store.put({ id: 'aud-1', resourceId: 'aud-1', courseId: 'c1', title: 'Week 1 Audio Lecture', fileType: 'audio', sizeBytes: wav.length, downloadedAt: now, version: 1, blob: new Blob([new Uint8Array(wav)], { type: 'audio/wav' }) })
    store.put({ id: 'notes-1', resourceId: 'notes-1', courseId: 'c1', title: 'Week 1 Notes', fileType: 'notes', sizeBytes: 26, downloadedAt: now, version: 1, blob: new Blob(['Chlorophyll absorbs light.'], { type: 'text/plain' }) })
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  }, wavBytes())
}

test('downloaded lectures open and play with the network completely disconnected', async ({ page, context }) => {
  await mockBackend(page)

  // 1. Online: sign in, let the service worker install, and create the local database.
  await page.goto('/login/student')
  await page.fill('#email', 'student@eduvillage.org')
  await page.fill('#password', 'student123')
  await page.click('button:has-text("Sign In")')
  await page.waitForURL(/\/student\/dashboard/)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.goto('/student/downloads')
  await expect(page.getByText('No resources downloaded yet')).toBeVisible()
  await seedDownloads(page)
  await page.reload()
  await expect(page.getByText('Week 1 Audio Lecture')).toBeVisible()

  // 2. Go offline and make sure nothing can reach the backend.
  const apiResponses: string[] = []
  page.on('response', (r) => { if (r.url().startsWith(API) && r.ok()) apiResponses.push(r.url()) })
  await context.setOffline(true)
  net.offline = true

  // 3. A cold reload still opens the app (shell served by the service worker) and the Downloads list.
  await page.reload()
  await expect(page.getByText('Week 1 Audio Lecture')).toBeVisible()
  await expect(page.getByText('Week 1 Notes')).toBeVisible()

  // 4. The saved audio decodes and is playable from local storage.
  await page.getByText('Week 1 Audio Lecture').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').getByRole('link', { name: /open resource/i }).click()
  const audio = page.getByTestId('offline-media')
  await expect(audio).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.readyState)).toBeGreaterThanOrEqual(1)
  expect(await audio.evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0.5)
  await expect(page.getByText('Playing from this device')).toBeVisible()

  // 5. Notes open too, and the Downloads page is reachable again via the client-side route.
  await page.goto('/student/downloads/notes-1')
  await expect(page.getByTestId('offline-text')).toContainText('Chlorophyll absorbs light.')

  // 6. Offline, the app never claimed a successful server response.
  expect(apiResponses).toEqual([])

  // 7. Back online: nothing was lost.
  await context.setOffline(false)
  net.offline = false
  await page.goto('/student/downloads')
  await expect(page.getByText('Week 1 Audio Lecture')).toBeVisible()
})

test('the Downloads page is reachable from the dashboard while offline (client-side navigation)', async ({ page, context }) => {
  await mockBackend(page)
  await page.goto('/login/student')
  await page.fill('#email', 'student@eduvillage.org')
  await page.fill('#password', 'student123')
  await page.click('button:has-text("Sign In")')
  await page.waitForURL(/\/student\/dashboard/)
  await page.evaluate(() => navigator.serviceWorker.ready)

  await context.setOffline(true)
  net.offline = true
  await page.reload()
  await expect(page).toHaveURL(/\/student\/dashboard/) // cached session; no endless loading
  await page.getByRole('link', { name: /downloads/i }).first().click()
  await expect(page).toHaveURL(/\/student\/downloads/)
  await expect(page.getByText('Offline Learning Downloads')).toBeVisible()
})
