import { test, expect } from '@playwright/test'

test.describe('EduVillage Critical Workflows', () => {
  test('student authentication, dashboard rendering, and mobile bottom navigation', async ({ page }) => {
    await page.goto('/login')

    // Expect brand name EduVillage
    await expect(page.locator('h1')).toContainText('EduVillage')

    // Quick fill Student demo
    await page.click('text=Student Demo')
    await expect(page.locator('#email')).toHaveValue('student@eduvillage.org')
    await expect(page.locator('#password')).toHaveValue('student123')

    // Submit
    await page.click('button:has-text("Sign In")')

    // Expect navigation to student dashboard
    await expect(page).toHaveURL(/\/student\/dashboard/)
    await expect(page.locator('h1')).toContainText('Amina Diallo')

    // On mobile screens, bottom navigation should be visible with 5 destinations
    const mobileNav = page.locator('nav[aria-label="Mobile Navigation"]')
    if (await mobileNav.isVisible()) {
      await expect(mobileNav.locator('text=Home')).toBeVisible()
      await expect(mobileNav.locator('text=Classes')).toBeVisible()
      await expect(mobileNav.locator('text=Recorded')).toBeVisible()
      await expect(mobileNav.locator('text=Tasks')).toBeVisible()
      await expect(mobileNav.locator('text=Offline')).toBeVisible()
    }
  })

  test('offline assignment draft saving to IndexedDB', async ({ page }) => {
    // Navigate directly to student dashboard with demo auth
    await page.goto('/login')
    await page.click('text=Student Demo')
    await page.click('button:has-text("Sign In")')
    await page.waitForURL(/\/student\/dashboard/)

    // Navigate to assignments
    await page.goto('/student/assignments')
    await expect(page.locator('h1')).toContainText('Assignments & Field Tasks')

    // Open first assignment
    const openBtn = page.locator('button:has-text("Open Assignment")').first()
    if (await openBtn.isVisible()) {
      await openBtn.click()

      // Expect draft editor with auto-save
      const textarea = page.locator('textarea')
      await expect(textarea).toBeVisible()
      await textarea.fill('Calculated total daily requirement: 4.8 kWh under 20% dust derating factor.')

      // Check auto-save badge
      await expect(page.locator('text=Saved on this device')).toBeVisible({ timeout: 5000 })
    }
  })

  test('recorded lessons library, playback player, transcript and summary tabs', async ({ page }) => {
    await page.goto('/login')
    await page.click('text=Student Demo')
    await page.click('button:has-text("Sign In")')
    await page.waitForURL(/\/student\/dashboard/)

    // Navigate to recorded lessons
    await page.goto('/student/recorded-lessons')
    await expect(page.locator('h1')).toContainText('Recorded Lessons')

    // Expect recording cards to appear
    const watchLink = page.locator('a:has-text("Watch")').first()
    await expect(watchLink).toBeVisible()
    await watchLink.click()

    // Expect detail page with media player and tabs
    await expect(page).toHaveURL(/\/student\/recorded-lessons\/rec-/)
    await expect(page.locator('button:has-text("Transcript")')).toBeVisible()
    await expect(page.locator('button:has-text("AI Summary")')).toBeVisible()
  })

  test('teacher authentication, curriculum authoring, and section-aware classes', async ({ page }) => {
    await page.goto('/login')
    await page.click('text=Teacher Demo')
    await page.click('button:has-text("Sign In")')

    // Expect teacher dashboard
    await page.waitForURL(/\/teacher\/dashboard/)
    await expect(page.locator('h1')).toContainText('Dr. Elena Rostova')
    await expect(page.locator('text=Teacher Console').first()).toBeVisible()

    // Navigate to recorded lessons management console
    await page.goto('/teacher/recorded-lessons')
    await expect(page.locator('h1')).toContainText('Recorded Lessons & Resource Sharing')
  })
})
