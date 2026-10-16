import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Real LiveKit Cloud, real backend, real browsers (fake camera/microphone): the floating teacher video, the
 * whiteboard shared over the data channel (including a student who joins late), screen sharing and background blur.
 * Frames of media are synthetic, so what this proves is that the features run and that the data/tracks arrive; it is
 * not a judgement of picture quality.
 */

const API = 'http://localhost:8011'
const api = (path: string) => `${API}${path}`
const tag = Math.random().toString(36).slice(2, 7)

async function register(request: APIRequestContext, role: 'teacher' | 'student', prefix: string) {
  const res = await request.post(api('/api/v1/auth/register'), {
    data: { full_name: `${prefix} ${tag}`, email: `${prefix}-${tag}@example.com`, password: 'password123', role },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()).user as { id: string }
}

/** Number of non-white pixels on the board canvas, as that person sees it. */
const inkOn = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="whiteboard"] canvas') as HTMLCanvasElement | null
    if (!c) return -1
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++
    return n
  })

test('floating video, shared whiteboard (late joiner too), screen sharing and blur in a real class', async ({ browser }) => {
  test.setTimeout(150_000)
  const teacherCtx = await browser.newContext()
  const teacher = await teacherCtx.newPage()
  await register(teacherCtx.request, 'teacher', 'tools-teacher')
  const course = await (await teacherCtx.request.post(api('/api/v1/courses'), { data: { title: `Tools ${tag}`, status: 'published' } })).json()
  const section = await (await teacherCtx.request.post(api(`/api/v1/courses/${course.id}/sections`), { data: { name: 'S', code: 'S1' } })).json()

  const join = async () => {
    const ctx = await browser.newContext()
    const user = await register(ctx.request, 'student', `tools-student${Math.random().toString(36).slice(2, 5)}`)
    expect((await ctx.request.post(api(`/api/v1/courses/${course.id}/enrollments`), { data: {} })).ok()).toBeTruthy()
    expect((await teacherCtx.request.post(api(`/api/v1/sections/${section.id}/members`), { data: { student_id: user.id } })).ok()).toBeTruthy()
    return ctx
  }
  const studentCtx = await join()
  const cls = await (
    await teacherCtx.request.post(api(`/api/v1/classes?course_id=${course.id}`), {
      data: { title: 'Tools session', scheduled_start: '2026-11-01T10:00:00Z', section_ids: [section.id] },
    })
  ).json()
  expect((await teacherCtx.request.post(api(`/api/v1/classes/${cls.id}/start`))).ok()).toBeTruthy()

  await teacher.goto(`/classroom/${cls.id}`)
  await expect(teacher.getByTestId('participant-count')).toBeVisible({ timeout: 30_000 })
  const student = await studentCtx.newPage()
  await student.goto(`/classroom/${cls.id}`)
  await expect(student.getByTestId('participant-count')).toHaveText('2', { timeout: 45_000 })

  // 1. The teacher's video is a small floating window with buttons, for the teacher and for the student.
  for (const page of [teacher, student]) {
    const win = page.getByTestId('floating-video')
    await expect(win).toBeVisible()
    await expect(page.getByRole('button', { name: /Enlarge video window|Make video window smaller/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hide video window' })).toBeVisible()
  }
  await expect(teacher.getByTestId('floating-video')).toHaveAttribute('data-size', 'large') // nothing shared yet
  await teacher.getByRole('button', { name: 'Hide video window' }).click()
  await expect(teacher.getByRole('button', { name: /^Show / })).toBeVisible()
  await teacher.getByRole('button', { name: /^Show / }).click()

  // 2. Background blur: on by default for the teacher (status is reported by the window)
  // (the segmentation model is downloaded the first time, so allow a little while)
  await expect(teacher.getByTestId('floating-video')).toHaveAttribute('data-status', 'blur-on', { timeout: 60_000 })
  await expect(teacher.getByRole('alert')).toHaveCount(0)
  await teacher.getByRole('button', { name: 'Blur background' }).first().click() // switch it off again
  await expect(teacher.getByTestId('floating-video')).toHaveAttribute('data-status', 'blur-off', { timeout: 20_000 })
  await teacher.getByRole('button', { name: 'Blur background' }).first().click() // and back on
  await expect(teacher.getByTestId('floating-video')).toHaveAttribute('data-status', 'blur-on', { timeout: 30_000 })

  // 3. Whiteboard: the teacher opens it and writes; the student sees it live
  await teacher.getByRole('button', { name: 'Whiteboard' }).click()
  await expect(teacher.getByTestId('whiteboard')).toBeVisible()
  await expect(student.getByTestId('whiteboard')).toBeVisible({ timeout: 20_000 })
  await expect(teacher.getByTestId('floating-video')).toHaveAttribute('data-size', 'small') // content is shared, video shrinks
  const canvas = teacher.getByRole('img', { name: /draw or type/i })
  const box = (await canvas.boundingBox())!
  await teacher.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3)
  await teacher.mouse.down()
  await teacher.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 12 })
  await teacher.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3, { steps: 12 })
  await teacher.mouse.up()
  await teacher.getByRole('button', { name: 'Text' }).click()
  await canvas.click({ position: { x: box.width * 0.1, y: box.height * 0.8 } })
  await teacher.getByLabel('Type text for the board').fill('Newton: F = ma')
  await teacher.getByLabel('Type text for the board').press('Enter')
  await expect.poll(() => inkOn(teacher), { timeout: 10_000 }).toBeGreaterThan(500)
  await expect.poll(() => inkOn(student), { timeout: 20_000 }).toBeGreaterThan(500)
  expect(await student.getByRole('toolbar').count()).toBe(0) // students cannot draw

  // 4. A student who joins late receives the whole board
  const lateCtx = await join()
  const late = await lateCtx.newPage()
  await late.goto(`/classroom/${cls.id}`)
  await expect(late.getByTestId('whiteboard')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => inkOn(late), { timeout: 20_000 }).toBeGreaterThan(500)

  // 5. Screen sharing: one share, then a second one at the same time (needs a display-capture source)
  await teacher.getByRole('button', { name: 'Share screen' }).click()
  await expect(teacher.getByTestId('screen-share')).toHaveCount(1, { timeout: 20_000 })
  await expect(student.getByRole('tab', { name: /Screen 1/ })).toBeVisible({ timeout: 20_000 })
  await expect(student.getByTestId('screen-share')).toHaveCount(1, { timeout: 20_000 })
  await teacher.getByRole('button', { name: 'Share another screen' }).click()
  await expect(student.getByRole('tab', { name: 'All screens' })).toBeVisible({ timeout: 20_000 })
  await student.getByRole('tab', { name: 'All screens' }).click()
  await expect(student.getByTestId('screen-share')).toHaveCount(2)
  await teacher.getByRole('button', { name: 'Stop sharing' }).first().click({ trial: false }).catch(() => undefined)

  await teacherCtx.request.post(api(`/api/v1/classes/${cls.id}/end`))
  await Promise.all([teacherCtx.close(), studentCtx.close(), lateCtx.close()])
})
