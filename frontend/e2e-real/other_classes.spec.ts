import { test, expect, type Page } from '@playwright/test'

/**
 * Real backend + database + browser: an "All Sections" teacher schedules ONE class and every enrolled student of the
 * branch sees it under "Other Classes", whatever their section; a student of another branch does not.
 */

const username = process.env.E2E_ADMIN_USERNAME!
const password = process.env.E2E_ADMIN_PASSWORD!
const tag = Math.random().toString(36).slice(2, 7)
const COLLEGE = `Gamma College ${tag}`
const CLASS_TITLE = `Branch lecture ${tag}`
const COURSE_TITLE = `Algorithms ${tag}`
const label = (page: Page, text: RegExp) => page.getByLabel(text)
let code = ''

async function adminCreate(page: Page) {
  await page.goto('/platform-console')
  await page.fill('#admin-username', username)
  await page.fill('#admin-password', password)
  await page.click('button:has-text("Sign In")')
  await page.getByRole('button', { name: 'Create college' }).first().click()
  await page.fill('#college-name', COLLEGE)
  await page.getByRole('dialog').getByRole('button', { name: 'Create college' }).click()
  const dialog = page.getByRole('dialog')
  code = (await dialog.getByText(/^EV-/).innerText()).trim()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await page.getByTestId('college-row').filter({ hasText: COLLEGE }).getByRole('button', { name: 'Branches' }).click()
  for (const [branch, sections] of Object.entries({ 'Computer Science': ['Section A', 'Section B'], Electronics: ['Section A'] })) {
    await page.fill('#new-branch', branch)
    await page.getByRole('button', { name: 'Add Branch' }).click()
    const row = page.getByTestId('branch-row').filter({ hasText: branch })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Sections' }).click()
    for (const s of sections) {
      await page.fill('#new-section', s)
      await page.getByRole('button', { name: 'Add Section' }).click()
      await expect(page.getByTestId('section-row').filter({ hasText: s })).toBeVisible()
    }
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Branches' }).click()
  }
}

async function register(page: Page, role: 'teacher' | 'student', email: string, branch: string, section: string) {
  await page.context().clearCookies()
  await page.goto(`/register/${role}`)
  await page.fill('#fullName', `${role} ${email.split('@')[0]}`)
  await page.fill('#email', email)
  await page.fill('#password', 'password123')
  await page.fill('#confirmPassword', 'password123')
  await label(page, /^College\s*\*?$/).selectOption({ label: COLLEGE })
  await label(page, /^Branch\s*\*?$/).selectOption({ label: branch })
  await label(page, /^Section\s*\*?$/).selectOption({ label: section })
  await page.fill('#collegeCode', code)
  await page.click('button:has-text("Register")')
  await page.waitForURL(new RegExp(`/${role}/dashboard`))
}

test.describe.serial('branch-wide classes appear under Other Classes', () => {
  // Only one administrator session may be active at a time: end it after every test so the next one can sign in.
  test.afterEach(async ({ page }) => {
    await page.request
      .post('http://localhost:8010/api/v1/admin/auth/logout', { headers: { 'X-EduVillage-Admin': '1' } })
      .catch(() => undefined)
  })

  test('admin builds the college; the All Sections teacher registers and schedules one branch-wide class', async ({ page }) => {
    await adminCreate(page)
    await register(page, 'teacher', `wide-${tag}@example.com`, 'Computer Science', 'All Sections')

    await page.goto('/teacher/courses/new')
    await page.fill('#title', COURSE_TITLE)
    await page.fill('#code', `ALG-${tag}`.toUpperCase())
    await page.click('button:has-text("Create")')
    await page.waitForURL(/\/teacher\/courses\/.+\/manage/)

    await page.goto('/teacher/classes/new')
    await page.fill('#title', CLASS_TITLE)
    const audience = page.locator('#section')
    await expect(audience.locator('option', { hasText: 'All sections in Computer Science' })).toHaveCount(1)
    await audience.selectOption({ label: 'All sections in Computer Science' })
    await page.click('button:has-text("Schedule Class")')
    await page.waitForURL(/\/teacher\/classes$/)
    await expect(page.getByText(CLASS_TITLE)).toHaveCount(1)
  })

  for (const [name, branch, section, visible] of [
    ['section A student', 'Computer Science', 'Section A', true],
    ['section B student', 'Computer Science', 'Section B', true],
    ['student of another branch', 'Electronics', 'Section A', false],
  ] as const) {
    test(`${name} ${visible ? 'sees the class once under Other Classes' : 'does not see it'}`, async ({ page }) => {
      await register(page, 'student', `${name.replace(/\W+/g, '-')}-${tag}@example.com`, branch, section)
      // enroll through the catalog (the new Enroll button), then open the class list
      await page.goto('/student/courses')
      await page.getByRole('button', { name: 'Enroll' }).first().click()
      await expect(page.getByRole('button', { name: /View Course/ }).first()).toBeVisible()
      await page.goto('/student/classes')
      const other = page.getByTestId('other-classes')
      await expect(other).toBeVisible()
      if (visible) {
        await expect(other.getByText(CLASS_TITLE)).toHaveCount(1)
        await expect(page.getByText(CLASS_TITLE)).toHaveCount(1) // only in Other Classes, never duplicated above
        await expect(other.getByText('Branch: Computer Science')).toBeVisible()
      } else {
        await expect(page.getByText(CLASS_TITLE)).toHaveCount(0)
        await expect(other.getByText('No other classes right now.')).toBeVisible()
      }
    })
  }

  test('Other Classes has no horizontal overflow on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await register(page, 'student', `phone-${tag}@example.com`, 'Computer Science', 'Section B')
    await page.goto('/student/courses')
    await page.getByRole('button', { name: 'Enroll' }).first().click()
    await expect(page.getByRole('button', { name: /View Course/ }).first()).toBeVisible()
    await page.goto('/student/classes')
    await expect(page.getByTestId('other-classes').getByText(CLASS_TITLE)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: 'test-results/layout/other-classes-mobile-390.png', fullPage: true })
  })
})
