import { test, expect, type Page } from '@playwright/test'

/** Real backend, real database, real browser: admin creates a college + sections, then people register. */

const username = process.env.E2E_ADMIN_USERNAME!
const password = process.env.E2E_ADMIN_PASSWORD!
const tag = Math.random().toString(36).slice(2, 7)
const COLLEGE_A = `Alpha College ${tag}`
const COLLEGE_B = `Beta Institute ${tag}`

const state: { codeA?: string; codeB?: string } = {}

async function adminLogin(page: Page) {
  await page.goto('/platform-console')
  // A still-valid admin session (cookie) goes straight to the dashboard, which is itself what we want to see.
  const form = page.locator('#admin-username')
  const dashboard = page.getByRole('heading', { name: 'Colleges', exact: true })
  await form.or(dashboard).first().waitFor()
  if (await form.isVisible()) {
    await page.fill('#admin-username', username)
    await page.fill('#admin-password', password)
    await page.click('button:has-text("Sign In")')
  }
  await expect(page.getByRole('heading', { name: 'Colleges', exact: true })).toBeVisible()
}

async function createCollege(page: Page, name: string, branches: Record<string, string[]>): Promise<string> {
  await page.getByRole('button', { name: 'Create college' }).first().click()
  await page.fill('#college-name', name)
  await page.getByRole('dialog').getByRole('button', { name: 'Create college' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/^EV-/)).toBeVisible()
  const code = (await dialog.getByText(/^EV-/).innerText()).trim()
  await dialog.getByRole('button', { name: 'Done' }).click()
  const row = page.getByTestId('college-row').filter({ hasText: name })
  await row.getByRole('button', { name: 'Branches' }).click()
  for (const [branch, sections] of Object.entries(branches)) {
    await page.fill('#new-branch', branch)
    await page.getByRole('button', { name: 'Add Branch' }).click()
    const branchRow = page.getByTestId('branch-row').filter({ hasText: branch })
    await expect(branchRow).toBeVisible()
    await branchRow.getByRole('button', { name: 'Sections' }).click()
    for (const sec of sections) {
      await page.fill('#new-section', sec)
      await page.getByRole('button', { name: 'Add Section' }).click()
      await expect(page.getByTestId('section-row').filter({ hasText: sec })).toBeVisible()
    }
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Branches' }).click()
  }
  await page.getByRole('button', { name: 'Close dialog' }).first().click()
  return code
}

const label = (page: Page, text: RegExp) => page.getByLabel(text)

test.describe.serial('admin-managed colleges drive registration', () => {
  // Only one administrator session may be active at a time: end it after every test so the next one can sign in.
  test.afterEach(async ({ page }) => {
    await page.request
      .post('http://localhost:8010/api/v1/admin/auth/logout', { headers: { 'X-EduVillage-Admin': '1' } })
      .catch(() => undefined)
  })

  test('admin creates two colleges with sections (real backend)', async ({ page }) => {
    await adminLogin(page)
    state.codeA = await createCollege(page, COLLEGE_A, { 'Computer Science': ['Section A', 'Section B'], Electronics: ['Section A'] })
    state.codeB = await createCollege(page, COLLEGE_B, { Mechanical: ['Section M'] })
    expect(state.codeA).not.toBe(state.codeB)
    await page.reload() // persisted, not just in memory
    await expect(page.getByTestId('college-row').filter({ hasText: COLLEGE_A })).toBeVisible()
  })

  test('teacher registers with college, code and section and lands on the teacher dashboard', async ({ page }) => {
    await page.goto('/register/teacher')
    await expect(page.getByLabel(/role/i)).toHaveCount(0)
    const college = label(page, /^College\s*\*?$/)
    await expect(college.locator('option', { hasText: COLLEGE_A })).toHaveCount(1) // admin-created, no redeploy
    await page.fill('#fullName', 'Tess Teacher')
    await page.fill('#email', `teacher-${tag}@example.com`)
    await page.fill('#password', 'password123')
    await page.fill('#confirmPassword', 'password123')

    await college.selectOption({ label: COLLEGE_A })
    const branch = label(page, /^Branch\s*\*?$/)
    const section = label(page, /^Section\s*\*?$/)
    await expect(branch.locator('option', { hasText: 'Computer Science' })).toHaveCount(1)
    await branch.selectOption({ label: 'Computer Science' })
    await expect(section.locator('option')).toHaveText(['Select your section', 'Section A', 'Section B', 'All Sections'])
    await section.selectOption({ label: 'Section B' })
    // Changing the branch clears the section; changing the college clears branch and section.
    await branch.selectOption({ label: 'Electronics' })
    await expect(section).toHaveValue('')
    await expect(section.locator('option')).toHaveText(['Select your section', 'Section A', 'All Sections'])
    await college.selectOption({ label: COLLEGE_B })
    await expect(branch).toHaveValue('')
    await expect(branch.locator('option', { hasText: 'Mechanical' })).toHaveCount(1)
    await expect(branch.locator('option', { hasText: 'Electronics' })).toHaveCount(0)
    await college.selectOption({ label: COLLEGE_A })
    await branch.selectOption({ label: 'Computer Science' })
    await section.selectOption({ label: 'Section A' })

    // Wrong code (another college's code) is rejected by the backend and the form keeps its values.
    await page.fill('#collegeCode', state.codeB!)
    await page.click('button:has-text("Register")')
    await expect(page.getByText('The college code is incorrect for the selected college.')).toBeVisible()
    await expect(page.locator('#fullName')).toHaveValue('Tess Teacher')
    await expect(section).not.toHaveValue('')

    await page.fill('#collegeCode', state.codeA!)
    await page.click('button:has-text("Register")')
    await page.waitForURL(/\/teacher\/dashboard/)
  })

  test('student selects college, code and section, registers, and can sign in again', async ({ page }) => {
    await page.goto('/register/student')
    await expect(page.locator('#collegeCode')).toHaveCount(1) // students need the admin-issued code too, same as teachers
    await page.fill('#fullName', 'Sam Student')
    await page.fill('#email', `student-${tag}@example.com`)
    await page.fill('#password', 'password123')
    await page.fill('#confirmPassword', 'password123')
    await label(page, /^College\s*\*?$/).selectOption({ label: COLLEGE_B })
    await label(page, /^Branch\s*\*?$/).selectOption({ label: 'Mechanical' })
    await label(page, /^Section\s*\*?$/).selectOption({ label: 'Section M' })
    await page.fill('#collegeCode', state.codeB!)
    await page.click('button:has-text("Register")')
    await page.waitForURL(/\/student\/dashboard/)

    await page.request.post('http://localhost:8010/api/v1/auth/logout') // end the session properly: a second sign-in while one is active needs the emailed code
    await page.goto('/login/student')
    await page.fill('#email', `student-${tag}@example.com`)
    await page.fill('#password', 'password123')
    await page.click('button:has-text("Sign In")')
    await page.waitForURL(/\/student\/dashboard/)
  })

  test('duplicate email shows an error next to the field', async ({ page }) => {
    await page.goto('/register/student')
    await page.fill('#fullName', 'Sam Again')
    await page.fill('#email', `student-${tag}@example.com`)
    await page.fill('#password', 'password123')
    await page.fill('#confirmPassword', 'password123')
    await label(page, /^College\s*\*?$/).selectOption({ label: COLLEGE_B })
    await label(page, /^Branch\s*\*?$/).selectOption({ label: 'Mechanical' })
    await label(page, /^Section\s*\*?$/).selectOption({ label: 'Section M' })
    await page.fill('#collegeCode', state.codeB!)
    await page.click('button:has-text("Register")')
    await expect(page.getByText('An account with this email already exists.')).toBeVisible()
  })

  test('deactivating a college removes it from registration immediately; reactivating brings it back', async ({ page }) => {
    await adminLogin(page)
    const row = page.getByTestId('college-row').filter({ hasText: COLLEGE_B })
    await row.getByRole('button', { name: 'Deactivate' }).click()
    await expect(row.getByRole('button', { name: 'Activate' })).toBeVisible()

    await page.goto('/register/student')
    const college = label(page, /^College\s*\*?$/)
    await expect(college.locator('option', { hasText: COLLEGE_A })).toHaveCount(1)
    await expect(college.locator('option', { hasText: COLLEGE_B })).toHaveCount(0)

    await adminLogin(page)
    await page.getByTestId('college-row').filter({ hasText: COLLEGE_B }).getByRole('button', { name: 'Activate' }).click()
    await page.goto('/register/student')
    await expect(label(page, /^College\s*\*?$/).locator('option', { hasText: COLLEGE_B })).toHaveCount(1)
  })

  test('a teacher can register for All Sections and the branch can be deactivated from the admin panel', async ({ page }) => {
    await page.goto('/register/teacher')
    await page.fill('#fullName', 'Wide Teacher')
    await page.fill('#email', `wide-${tag}@example.com`)
    await page.fill('#password', 'password123')
    await page.fill('#confirmPassword', 'password123')
    await label(page, /^College\s*\*?$/).selectOption({ label: COLLEGE_A })
    await label(page, /^Branch\s*\*?$/).selectOption({ label: 'Computer Science' })
    await label(page, /^Section\s*\*?$/).selectOption({ label: 'All Sections' })
    await page.fill('#collegeCode', state.codeA!)
    await page.click('button:has-text("Register")')
    await page.waitForURL(/\/teacher\/dashboard/)
    await page.context().clearCookies()

    await adminLogin(page)
    await page.getByTestId('college-row').filter({ hasText: COLLEGE_A }).getByRole('button', { name: 'Branches' }).click()
    const row = page.getByTestId('branch-row').filter({ hasText: 'Electronics' })
    await row.getByRole('button', { name: 'Deactivate' }).click()
    await page.getByRole('button', { name: 'Deactivate', exact: true }).last().click() // confirmation dialog
    await expect(row.getByRole('button', { name: 'Activate' })).toBeVisible()
    await page.getByRole('button', { name: 'Close dialog' }).first().click()

    await page.goto('/register/teacher')
    await label(page, /^College\s*\*?$/).selectOption({ label: COLLEGE_A })
    const branch = label(page, /^Branch\s*\*?$/)
    await expect(branch.locator('option', { hasText: 'Computer Science' })).toHaveCount(1)
    await expect(branch.locator('option', { hasText: 'Electronics' })).toHaveCount(0)
  })

  test('signing in again while already signed in elsewhere needs the emailed code', async ({ page }) => {
    // the teacher registered earlier still has a live session, so a password-only sign-in must not succeed
    await page.goto('/login/teacher')
    await page.fill('#email', `teacher-${tag}@example.com`)
    await page.fill('#password', 'password123')
    await page.click('button:has-text("Sign In")')
    await expect(page.getByRole('button', { name: 'Verify and Sign In' })).toBeVisible()
    await expect(page).toHaveURL(/\/login\/teacher/)
    // the password alone gave this browser no session
    const other = await page.context().newPage()
    await other.goto('/teacher/dashboard')
    await expect(other).toHaveURL(/\/login/)
    await other.close()

    // email is not configured in this run, so the code is shown on screen; a wrong code is refused first
    const code = (await page.getByText(/Your code is/).locator('strong').innerText()).trim()
    await page.fill('#login-otp', code === '000000' ? '111111' : '000000')
    await page.click('button:has-text("Verify and Sign In")')
    await expect(page.getByText('That code is incorrect or has expired.')).toBeVisible()
    await page.fill('#login-otp', code)
    await page.click('button:has-text("Verify and Sign In")')
    await page.waitForURL(/\/teacher\/dashboard/)
  })
})

for (const vp of [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
]) {
  test(`registration form has no horizontal overflow at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/register/teacher')
    await expect(label(page, /^College\s*\*?$/)).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `test-results/layout/register-teacher-${vp.name}.png`, fullPage: true })
  })
}
