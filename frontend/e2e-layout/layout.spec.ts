import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const API = 'http://localhost:8000'
const ORIGIN = 'http://localhost:4174'
const SHOTS = process.env.LAYOUT_SHOTS_DIR || 'test-results/layout'
const TAG = process.env.LAYOUT_TAG || 'run'
mkdirSync(SHOTS, { recursive: true })

const USER = { id: 'u1', email: 'student@eduvillage.org', full_name: 'Amina Diallo', role: 'student', status: 'active' }
const course = (i: number, title: string, subject: string) => ({
  id: `c${i}`, title, description: 'Curriculum module covering theory, field practice and revision.', subject,
  teacher_id: 't1', teacher_name: 'Prof. Miller', status: 'published', created_at: '2026-01-01T00:00:00',
})
const COURSES = [course(1, 'Soil Mechanics', 'GEO-201'), course(2, 'Solar Microgrids', 'STEM-301'), course(3, 'Water Systems', 'ENG-110'), course(4, 'Field Electronics', 'ELE-120')]
const klass = (i: number, status: string, title: string, cid: string) => ({
  id: `k${i}`, course_id: cid, teacher_id: 't1', title, scheduled_start: new Date(Date.now() + i * 3600_000).toISOString(),
  scheduled_end: null, status, livekit_room_name: `room-${i}`, section_ids: [],
})
const CLASSES = [
  klass(1, 'live', 'Hydraulic Conductivity Lab', 'c1'), klass(2, 'scheduled', 'Inverter Sizing Workshop', 'c2'),
  klass(3, 'scheduled', 'Pump Maintenance', 'c3'), klass(4, 'ended', 'Circuit Basics Recap', 'c4'),
]
const rec = (i: number, cid: string, title: string) => ({
  id: `r${i}`, class_id: `k${i}`, status: 'available', started_at: '2026-02-01T10:00:00', completed_at: '2026-02-01T11:00:00',
  title, is_published: true, duration_seconds: 3300, size_bytes: 52_000_000, course_id: cid, course_title: 'x',
  section_ids: [], has_transcript: true, summary_id: null, summary_status: null, progress_seconds: 0, completed: false,
})
const RECORDINGS = [rec(1, 'c1', 'Soil Lab Walkthrough'), rec(2, 'c2', 'Battery Banks'), rec(3, 'c3', 'Pump Repair'), rec(4, 'c4', 'Op-Amps')]

async function mock(page: Page, opts: { classes?: unknown[]; courses?: unknown[]; recordings?: unknown[]; assignments?: unknown[] } = {}) {
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url())
    const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'range, content-type' }
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b) })
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const p = url.pathname
    if (p === '/health') return json({ status: 'ok' })
    if (p.endsWith('/auth/login')) return json({ user: USER })
    if (p.endsWith('/users/me')) return json(USER)
    if (p === '/api/v1/courses') return json(opts.courses ?? COURSES)
    if (p === '/api/v1/classes') return json(opts.classes ?? CLASSES)
    if (p === '/api/v1/recordings') return json(opts.recordings ?? RECORDINGS)
    if (p === '/api/v1/assignments') return json(opts.assignments ?? [])
    return json([])
  })
}

async function signIn(page: Page) {
  await page.goto('/login/student')
  await page.fill('#email', 'student@eduvillage.org')
  await page.fill('#password', 'student123')
  await page.click('button:has-text("Sign In")')
  await page.waitForURL(/\/student\/dashboard/)
}

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1680x945', width: 1680, height: 945 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: 'tablet-820x1180', width: 820, height: 1180 },
  { name: 'mobile-390x844', width: 390, height: 844 },
]

/** Measures layout facts, not pixels: how much of the available width the page content really uses. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const mainEl = document.querySelector('main') as HTMLElement
    const main = mainEl.getBoundingClientRect()
    const content = (mainEl.firstElementChild as HTMLElement).getBoundingClientRect()
    const aside = document.querySelector('aside')
    return {
      viewport: window.innerWidth,
      sidebar: aside && getComputedStyle(aside).display !== 'none' ? Math.round(aside.getBoundingClientRect().width) : 0,
      main: Math.round(main.width),
      content: Math.round(content.width),
      leftGutter: Math.round(content.left - main.left),
      rightGutter: Math.round(main.right - content.right),
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      mainOverflow: mainEl.scrollWidth - mainEl.clientWidth,
    }
  })
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('home dashboard fills the content area without overflow', async ({ page }) => {
      await mock(page)
      await signIn(page)
      await expect(page.getByText('My Enrolled Courses')).toBeVisible()
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}/${TAG}-dashboard-${vp.name}.png`, fullPage: false })
      const m = await measure(page)
      console.log(vp.name, 'dashboard', JSON.stringify(m))
      expect(m.docOverflow).toBeLessThanOrEqual(0)
      expect(m.mainOverflow).toBeLessThanOrEqual(0)
      if (vp.width >= 1024) {
        expect(m.sidebar).toBe(256) // the sidebar keeps its existing width
        // the content may only leave small gutters, not wide empty bands
        expect(m.leftGutter).toBeLessThanOrEqual(40)
        expect(m.rightGutter).toBeLessThanOrEqual(40)
      }
    })

    test('live classroom sessions page shares one container and uses the width', async ({ page }) => {
      await mock(page)
      await signIn(page)
      await page.goto('/student/classes')
      await expect(page.getByText('Live Classroom Sessions')).toBeVisible()
      await expect(page.getByText('Hydraulic Conductivity Lab')).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${SHOTS}/${TAG}-classes-${vp.name}.png` })
      const m = await measure(page)
      console.log(vp.name, 'classes', JSON.stringify(m))
      expect(m.docOverflow).toBeLessThanOrEqual(0)
      if (vp.width >= 1024) {
        expect(m.leftGutter).toBeLessThanOrEqual(40)
        expect(m.rightGutter).toBeLessThanOrEqual(40)
      }
    })

    test('empty state is compact and filters sit close to the content', async ({ page }) => {
      await mock(page, { classes: [] })
      await signIn(page)
      await page.goto('/student/classes')
      await expect(page.getByText('No sessions found')).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${SHOTS}/${TAG}-classes-empty-${vp.name}.png` })
      const geo = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('main button')].find((b) => /all classes/i.test(b.textContent || ''))!.getBoundingClientRect()
        const leaf = [...document.querySelectorAll('main *')].find((e) => /no sessions found/i.test(e.textContent || '') && e.children.length === 0) as HTMLElement
        let box = leaf
        while (box.parentElement && box.parentElement.tagName !== 'MAIN' && box.getBoundingClientRect().width < 200) box = box.parentElement
        const r = box.getBoundingClientRect()
        return { gapFilterToEmpty: Math.round(r.top - tabs.bottom), emptyHeight: Math.round(r.height), emptyWidth: Math.round(r.width) }
      })
      console.log(vp.name, 'empty', JSON.stringify(geo))
      expect(geo.gapFilterToEmpty).toBeLessThanOrEqual(40)
    })
  })
}

test.describe('sparse data (one course, nothing scheduled)', () => {
  for (const vp of VIEWPORTS.filter((v) => v.width >= 1366)) {
    test(`home sections stack one after another at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await mock(page, {
        courses: [COURSES[0]], classes: [], recordings: [],
        assignments: [{ id: 'a1', course_id: 'c1', created_by: 't1', title: 'Cell structure quiz', instructions: 'Describe the organelles.', due_at: null, status: 'published' }],
      })
      await signIn(page)
      await expect(page.getByText('Pending Assignments')).toBeVisible()
      await expect(page.getByText('Cell structure quiz')).toBeVisible()
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}/${TAG}-sparse-${vp.name}.png` })

      // Sections that share a row have the same height and the same top edge, so the page reads as a grid.
      const sections = await page.evaluate(() =>
        [...document.querySelectorAll('main section[class~="@container"]')].map((s) => {
          const r = s.getBoundingClientRect()
          return { top: Math.round(r.top + window.scrollY), height: Math.round(r.height), left: Math.round(r.left), width: Math.round(r.width) }
        })
      )
      // Assignments, classes, courses, recordings and (since teacher discovery was added) the teachers section.
      expect(sections.length).toBe(5)
      // The sections are stacked one after another at every width, in reading order,
      // each as wide as the content area.
      for (let i = 1; i < sections.length; i++) {
        expect(sections[i].top).toBeGreaterThan(sections[i - 1].top + sections[i - 1].height - 1)
        expect(sections[i].left).toBe(sections[0].left)
        expect(sections[i].width).toBe(sections[0].width)
      }
      // A single course card fills its section instead of leaving a gap beside it.
      const card = await page.evaluate(() => {
        const sec = document.querySelectorAll('main section[class~="@container"]')[0]
        const c = sec.querySelector('div.grid > *') as HTMLElement
        return { cardW: Math.round(c.getBoundingClientRect().width), secW: Math.round(sec.getBoundingClientRect().width) }
      })
      expect(card.cardW).toBeGreaterThanOrEqual(card.secW - 4)
      // No broken dates anywhere on the page.
      await expect(page.getByText('Invalid Date')).toHaveCount(0)
      await expect(page.getByText('No due date')).toBeVisible()
    })
  }
})

for (const vp of VIEWPORTS) {
  test.describe(`recorded lessons page at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('has page padding, wraps its filters, and keeps button icons beside their labels', async ({ page }) => {
      await mock(page)
      await signIn(page)
      await page.goto('/student/recorded-lessons')
      await expect(page.getByText('Recorded Lessons Library')).toBeVisible()
      await expect(page.getByText('Soil Lab Walkthrough')).toBeVisible()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${SHOTS}/${TAG}-recorded-${vp.name}.png` })

      const facts = await page.evaluate(() => {
        const main = document.querySelector('main') as HTMLElement
        const mainRect = main.getBoundingClientRect()
        const title = [...main.querySelectorAll('h1')].find((h) => /recorded lessons library/i.test(h.textContent || '')) as HTMLElement
        const t = title.getBoundingClientRect()
        const pills = [...main.querySelectorAll('button')].filter((b) => /all lessons|ready to play|downloaded \(/i.test(b.textContent || ''))
        const pillsInside = pills.every((b) => b.getBoundingClientRect().right <= mainRect.right + 0.5 && b.getBoundingClientRect().left >= mainRect.left - 0.5)
        const actionButtons = [...main.querySelectorAll('button, a button')].filter((b) => /^(download|saving|watch|resume)(?![a-z])/i.test((b.textContent || '').trim()))
        const iconBesideLabel = actionButtons.map((b) => {
          const svg = b.querySelector('svg')!.getBoundingClientRect()
          const label = (b.querySelector('span:last-child') as HTMLElement).getBoundingClientRect()
          return Math.abs(svg.top + svg.height / 2 - (label.top + label.height / 2)) < 8
        })
        return {
          topPad: Math.round(t.top - mainRect.top),
          leftPad: Math.round(t.left - mainRect.left),
          pillsInside,
          iconBesideLabel,
          buttons: actionButtons.length,
          allButtons: [...main.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).slice(0, 12),
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
      console.log(vp.name, 'recorded', JSON.stringify(facts))
      expect(facts.docOverflow).toBeLessThanOrEqual(0)
      expect(facts.leftPad).toBeGreaterThanOrEqual(16) // no longer glued to the sidebar / screen edge
      expect(facts.topPad).toBeGreaterThanOrEqual(16)
      expect(facts.pillsInside).toBe(true) // filter buttons no longer run off the screen
      expect(facts.buttons).toBeGreaterThan(0)
      expect(facts.iconBesideLabel.every(Boolean)).toBe(true) // icon sits beside the text, not above it
    })
  })
}
