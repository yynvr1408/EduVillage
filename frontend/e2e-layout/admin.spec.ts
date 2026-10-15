import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const API = 'http://localhost:8000'
const ORIGIN = 'http://localhost:4174'
const SHOTS = process.env.LAYOUT_SHOTS_DIR || 'test-results/layout'
mkdirSync(SHOTS, { recursive: true })

/** Stateful stand-in for the admin API (network layer). "Signed in" = a flag the mock keeps, like the cookie would. */
async function mockAdminApi(page: Page, opts: { signedIn?: boolean } = {}) {
  let signedIn = opts.signedIn ?? false
  const colleges: any[] = []
  const make = (i: number, name: string) => ({
    id: `c${i}`, name, location: 'Pune', contact_email: 'office@example.com', contact_phone: null,
    code: `EV-ABC${i}-2345`, code_generated_at: '2026-01-01T00:00:00Z', status: 'active',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  })
  ;[1, 2, 3].forEach((i) => colleges.push(make(i, `Rural Science and Technology College Number ${i}`)))

  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    const cors = {
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type, x-eduvillage-admin',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    }
    const send = (status: number, body?: unknown) =>
      route.fulfill({ status, contentType: 'application/json', headers: cors, body: body === undefined ? '' : JSON.stringify(body) })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const p = new URL(req.url()).pathname
    if (!p.includes('/admin/')) return send(401, { error: { message: 'no' } })
    if (p.endsWith('/auth/login')) {
      signedIn = true
      return send(200, { username: 'admin', display_name: 'Administrator' })
    }
    if (!signedIn) return send(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } })
    if (p.endsWith('/auth/me')) return send(200, { username: 'admin', display_name: 'Administrator' })
    if (p.endsWith('/auth/logout')) {
      signedIn = false
      return send(204)
    }
    if (p.endsWith('/overview')) {
      return send(200, { total_colleges: colleges.length, active_colleges: colleges.length, inactive_colleges: 0, total_codes_generated: colleges.length })
    }
    if (p.endsWith('/colleges') && req.method() === 'POST') {
      const body = req.postDataJSON()
      const c = make(colleges.length + 1, body.name)
      colleges.unshift(c)
      return send(201, c)
    }
    if (p.endsWith('/colleges')) return send(200, { items: colleges, total: colleges.length, limit: 10, offset: 0 })
    return send(404, { error: { message: 'not found' } })
  })
}

test('/admin loads directly, shows sign-in, and survives a refresh once signed in', async ({ page }) => {
  await mockAdminApi(page)
  const response = await page.goto('/admin')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Admin Sign In' })).toBeVisible()

  await page.fill('#admin-username', 'admin')
  await page.fill('#admin-password', 'placeholder-for-mock')
  await page.click('button:has-text("Sign In")')
  await expect(page.getByRole('heading', { name: 'Colleges' })).toBeVisible()

  await page.reload() // direct navigation / refresh must keep working on the SPA host
  await expect(page.getByRole('heading', { name: 'Colleges' })).toBeVisible()
  await expect(page.getByTestId('college-row')).toHaveCount(3)

  await page.click('button:has-text("Sign out")')
  await expect(page.getByRole('heading', { name: 'Admin Sign In' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Admin Sign In' })).toBeVisible()
})

test('there is no admin link anywhere in the public or student/teacher navigation', async ({ page }) => {
  await mockAdminApi(page)
  for (const path of ['/login', '/login/student', '/login/teacher', '/register']) {
    await page.goto(path)
    await expect(page.locator('a[href*="admin" i]')).toHaveCount(0)
    await expect(page.getByText(/admin/i)).toHaveCount(0)
  }
})

test('create a college and see its code', async ({ page }) => {
  await mockAdminApi(page, { signedIn: true })
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Create college' }).first().click()
  await page.fill('#college-name', 'Hill Valley Polytechnic')
  await page.getByRole('dialog').getByRole('button', { name: 'Create college' }).click()
  await expect(page.getByRole('heading', { name: 'College code' })).toBeVisible()
  await expect(page.getByRole('dialog').getByText(/^EV-/)).toBeVisible()
})

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 640 },
]

for (const vp of VIEWPORTS) {
  test(`admin pages have no horizontal overflow at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await mockAdminApi(page)
    await page.goto('/admin')
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await overflow()).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `${SHOTS}/admin-login-${vp.name}.png` })

    await page.fill('#admin-username', 'admin')
    await page.fill('#admin-password', 'placeholder-for-mock')
    await page.click('button:has-text("Sign In")')
    await expect(page.getByTestId('college-row')).toHaveCount(3)
    expect(await overflow()).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `${SHOTS}/admin-dashboard-${vp.name}.png`, fullPage: true })

    await page.getByRole('button', { name: 'Create college' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await overflow()).toBeLessThanOrEqual(0)
  })
}
