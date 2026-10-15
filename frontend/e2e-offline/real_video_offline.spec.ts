import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Real-media offline test. lecture.webm is a genuine 5-second VP9 video (160x120) that Chromium
 * must actually decode. The download goes through the app's real download logic (the UI button ->
 * downloadManager -> chunked range requests -> verification -> IndexedDB); only the HTTP server is
 * faked, and it speaks real HTTP Range, so the bytes that arrive are the bytes of the file.
 */

const API = 'http://localhost:8000'
const ORIGIN = 'http://localhost:4173'
const VIDEO = readFileSync(path.join(here, 'fixtures', 'lecture.webm'))
const VIDEO_SHA = createHash('sha256').update(VIDEO).digest('hex')

const USER = { id: 'u1', email: 'student@eduvillage.org', full_name: 'Amina Diallo', role: 'student', status: 'active' }
const COURSE = { id: 'c1', title: 'Soil Mechanics', description: 'd', subject: 'SOIL', teacher_id: 't1', teacher_name: 'Prof. Miller', status: 'published', created_at: '2026-01-01T00:00:00' }
const RESOURCE = {
  id: 'vid-1', course_id: 'c1', lesson_id: null, filename: 'lecture.webm', mime_type: 'video/webm', size_bytes: VIDEO.length,
  status: 'available', title: 'Week 1 Lecture Video', description: null, resource_type: 'video', is_published: true,
  processing_status: 'ready', processing_error: null, version: 1, checksum_sha256: VIDEO_SHA,
}

const net = { offline: false, mediaOrApiResponses: [] as string[], truncate: false, downloadRequests: [] as string[] }

async function mockBackend(page: Page) {
  net.offline = false
  net.mediaOrApiResponses = []
  net.downloadRequests = []
  await page.route(`${API}/**`, async (route) => {
    // A real offline device cannot reach the API at all; Playwright answers mocks above the network layer.
    if (net.offline) return route.abort('internetdisconnected')
    const req = route.request()
    const url = new URL(req.url())
    const cors = {
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'range, content-type',
      'access-control-expose-headers': 'content-range, accept-ranges',
    }
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })

    const p = url.pathname
    if (p === '/health') return json({ status: 'ok' })
    if (p.endsWith('/auth/login')) return json({ user: USER })
    if (p.endsWith('/users/me')) return json(USER)
    if (p === '/api/v1/courses') return json([COURSE])
    if (p === '/api/v1/courses/c1') return json(COURSE)
    if (p === '/api/v1/courses/c1/lessons') return json([])
    if (p === '/api/v1/courses/c1/resources') return json([RESOURCE])
    if (p === '/api/v1/resources/vid-1/download-info') {
      return json({
        url: '/api/v1/resources/download-content/vid-1.webm', same_origin: true, version: 1, size_bytes: VIDEO.length,
        checksum_sha256: VIDEO_SHA, mime_type: 'video/webm', expires_in: null,
      })
    }
    if (p === '/api/v1/resources/download-content/vid-1.webm') {
      const range = req.headers()['range']
      net.downloadRequests.push(range ?? 'none')
      const m = range?.match(/bytes=(\d+)-(\d*)/)
      const start = m ? Number(m[1]) : 0
      const end = m && m[2] ? Math.min(Number(m[2]), VIDEO.length - 1) : VIDEO.length - 1
      let body = VIDEO.subarray(start, end + 1)
      // "incomplete download" scenario: the server cuts the connection short but still advertises the full range
      if (net.truncate) body = body.subarray(0, Math.floor(body.length / 2))
      return route.fulfill({
        status: 206, body, contentType: 'video/webm',
        headers: { ...cors, 'content-range': `bytes ${start}-${end}/${VIDEO.length}`, 'accept-ranges': 'bytes' },
      })
    }
    return json([])
  })
  page.on('response', (r) => {
    if (r.url().startsWith(API) && r.ok()) net.mediaOrApiResponses.push(r.url())
  })
}

async function signIn(page: Page) {
  await page.goto('/login/student')
  await page.fill('#email', 'student@eduvillage.org')
  await page.fill('#password', 'student123')
  await page.click('button:has-text("Sign In")')
  await page.waitForURL(/\/student\/dashboard/)
  await page.evaluate(() => navigator.serviceWorker.ready)
}

async function goOffline(context: BrowserContext) {
  await context.setOffline(true)
  net.offline = true
}

/** Reads what the app really stored in IndexedDB (not what the UI claims). */
async function storedState(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('EduVillageDB')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const all = (store: string) =>
      new Promise<any[]>((res, rej) => {
        const r = db.transaction(store).objectStore(store).getAll()
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
    const resources = await all('downloadedResources')
    const jobs = await all('downloadJobs')
    const parts = await all('downloadParts')
    const out = {
      resources: await Promise.all(
        resources.map(async (x) => {
          const bytes = new Uint8Array(await x.blob.arrayBuffer())
          const digest = await crypto.subtle.digest('SHA-256', bytes)
          return {
            id: x.id, size: x.blob.size, type: x.blob.type, version: x.version, checksum: x.checksum, verifiedAt: Boolean(x.verifiedAt),
            sha256: Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join(''),
          }
        })
      ),
      jobs: jobs.length,
      parts: parts.length,
    }
    db.close()
    return out
  })
}

test.describe('real video, offline', () => {
  test('a downloaded lecture video decodes and plays with the network disconnected', async ({ page, context }) => {
    await mockBackend(page)
    await signIn(page)

    // ---- 1. Online: download through the real UI + download logic -------------------------------------------
    await page.goto('/student/courses/c1')
    await expect(page.getByText('Week 1 Lecture Video')).toBeVisible()
    await page.getByRole('button', { name: /download for offline/i }).click()
    await expect(page.getByText('Available offline')).toBeVisible({ timeout: 15000 })

    // The complete, byte-identical file is stored locally and verified — not a placeholder.
    const stored = await storedState(page)
    expect(stored.resources).toHaveLength(1)
    expect(stored.resources[0]).toMatchObject({ id: 'vid-1', size: VIDEO.length, version: 1, verifiedAt: true })
    expect(stored.resources[0].sha256).toBe(VIDEO_SHA)
    expect(stored.resources[0].type).toBe('video/webm')
    expect(stored.jobs).toBe(0) // temporary chunks were cleaned up after verification
    expect(stored.parts).toBe(0)
    expect(net.downloadRequests[0]).toMatch(/^bytes=0-/) // fetched with real range requests

    // The Downloads page lists it.
    await page.goto('/student/downloads')
    await expect(page.getByText('Week 1 Lecture Video')).toBeVisible()

    // ---- 2. Disconnect, reload, and open it ------------------------------------------------------------------
    await goOffline(context)
    net.mediaOrApiResponses = []
    await page.reload()
    await expect(page.getByText('Week 1 Lecture Video')).toBeVisible()
    await page.getByText('Week 1 Lecture Video').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]').getByRole('link', { name: /open resource/i }).click()

    const video = page.getByTestId('offline-media')
    await expect(video).toHaveAttribute('src', /^blob:/) // a local object URL, never a remote media URL

    // ---- 3. Real decoding: metadata, dimensions, duration ---------------------------------------------------
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10000 }).toBeGreaterThanOrEqual(1)
    const meta = await video.evaluate((v: HTMLVideoElement) => ({ duration: v.duration, w: v.videoWidth, h: v.videoHeight, error: v.error?.code ?? null }))
    expect(meta.error).toBeNull()
    expect(meta.w).toBe(160)
    expect(meta.h).toBe(120)
    expect(meta.duration).toBeGreaterThan(4.5)
    expect(meta.duration).toBeLessThan(5.6)

    // ---- 4. Playback actually progresses, frames are decoded, and the picture is not blank -------------------
    await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play() })
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10000 }).toBeGreaterThan(1.2)
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
    const quality = await video.evaluate((v: HTMLVideoElement) => {
      const q = v.getVideoPlaybackQuality()
      return { total: q.totalVideoFrames, dropped: q.droppedVideoFrames }
    })
    expect(quality.total).toBeGreaterThan(8)
    const pixels = await video.evaluate((v: HTMLVideoElement) => {
      const c = document.createElement('canvas')
      c.width = 160; c.height = 120
      const ctx = c.getContext('2d')!
      ctx.drawImage(v, 0, 0)
      const d = ctx.getImageData(0, 0, 160, 120).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
      return sum
    })
    expect(pixels).toBeGreaterThan(1000) // a decoded, coloured picture (the source frames are never black)

    // Seeking works on the local file (it is served from a Blob, which supports random access).
    await video.evaluate((v: HTMLVideoElement) => new Promise<void>((resolve) => { v.addEventListener('seeked', () => resolve(), { once: true }); v.currentTime = 3.5 }))
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(3.3)

    // Let it play on, then pause so the position is saved.
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10000 }).toBeGreaterThan(4)
    await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 2.4; v.pause() }) // the pause handler stores this position
    await expect.poll(async () => (await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('EduVillageDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
      const row: any = await new Promise((res) => { const r = db.transaction('playbackPositions').objectStore('playbackPositions').get('res:vid-1'); r.onsuccess = () => res(r.result) })
      db.close()
      return row?.positionSeconds ?? null
    }))).toBe(2)

    // ---- 5. Nothing remote was needed ---------------------------------------------------------------------
    expect(net.mediaOrApiResponses).toEqual([])

    // ---- 6. Reopen: playback resumes from the saved position, still offline ----------------------------------
    await page.goto('/student/downloads/vid-1')
    const again = page.getByTestId('offline-media')
    await expect.poll(() => again.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10000 }).toBeGreaterThanOrEqual(1)
    await expect.poll(() => again.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 5000 }).toBeGreaterThan(1.9)
    expect(await again.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(3)
    await expect(page.getByText(/Resumed from 0:02/)).toBeVisible()
    expect(net.mediaOrApiResponses).toEqual([])

    // ---- 7. Back online: the app still works and the file is still there ----------------------------------------
    await context.setOffline(false)
    net.offline = false
    await page.goto('/student/downloads')
    await expect(page.getByText('Week 1 Lecture Video')).toBeVisible()
    expect((await storedState(page)).resources[0].size).toBe(VIDEO.length)
  })

  test('the service worker never serves HTML for API paths and never caches private API responses', async ({ page, request }) => {
    await mockBackend(page)
    await signIn(page)
    await page.goto('/student/courses/c1')
    await expect(page.getByText('Week 1 Lecture Video')).toBeVisible()

    // The generated worker excludes API-looking navigations from its index.html fallback.
    const sw = await request.get(`${ORIGIN}/sw.js`)
    const swText = await sw.text()
    expect(swText).toContain('denylist')
    expect(swText).toMatch(/\/\^\\\/api\\\//)
    expect(swText).not.toContain('runtimeCaching')
    expect(swText).not.toMatch(/registerRoute\([^)]*api/i)

    // After real use of the app, no cache holds API responses or media.
    const cached = await page.evaluate(async () => {
      const out: string[] = []
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(req.url)
      return out
    })
    expect(cached.length).toBeGreaterThan(0)
    expect(cached.filter((u) => /\/api\/|localhost:8000|download-content|\.webm($|\?)/.test(u))).toEqual([])
  })

  test('an incomplete download is rejected, never marked available offline, and leaves no half-file', async ({ page }) => {
    await mockBackend(page)
    net.truncate = true
    try {
      await signIn(page)
      await page.goto('/student/courses/c1')
      await page.getByRole('button', { name: /download for offline/i }).click()
      await expect(page.getByText(/incomplete|interrupted|discarded|changed/i)).toBeVisible({ timeout: 15000 })
      await expect(page.getByText('Available offline')).toHaveCount(0)
      const stored = await storedState(page)
      expect(stored.resources).toEqual([]) // nothing was recorded as a finished download
    } finally {
      net.truncate = false
    }
  })

  test('a damaged video file is reported clearly instead of failing silently', async ({ page }) => {
    await mockBackend(page)
    await signIn(page)
    await page.goto('/student/downloads')
    await expect(page.getByText('No resources downloaded yet')).toBeVisible()
    // A file that claims to be WebM but is not (e.g. storage corruption).
    await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('EduVillageDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
      const tx = db.transaction('downloadedResources', 'readwrite')
      tx.objectStore('downloadedResources').put({
        id: 'bad-1', resourceId: 'bad-1', courseId: 'c1', title: 'Broken Lecture', fileType: 'video', sizeBytes: 64,
        downloadedAt: new Date().toISOString(), version: 1, blob: new Blob([new Uint8Array(64).fill(7)], { type: 'video/webm' }),
      })
      await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
      db.close()
    })
    await page.goto('/student/downloads/bad-1')
    await expect(page.getByRole('alert')).toContainText(/damaged|cannot play|could not/i, { timeout: 10000 })
  })
})
