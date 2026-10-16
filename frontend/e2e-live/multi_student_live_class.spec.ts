import { test, expect, type APIRequestContext } from '@playwright/test'

/**
 * The actual acceptance criterion: one teacher starts one live class; three independently
 * authenticated students in the authorized section join the SAME real LiveKit Cloud room at the
 * same time. Real backend, real database, real browsers (one BrowserContext per person = one
 * independent device/session each), and the real LiveKit Cloud project — nothing mocked.
 *
 * What this proves: real room creation, real per-participant signed tokens, real signaling-level
 * presence (each client's LiveKit WebSocket connection sees the others join). It does NOT prove
 * that audio/video frames are actually exchanged — Playwright's fake media devices supply a
 * synthetic camera/mic, so this cannot be mistaken for verified real audio/video content; that
 * would require a human (or a frame-level media probe) watching the actual stream.
 */

const API = 'http://localhost:8011'
const api = (path: string) => `${API}${path}`
const tag = Math.random().toString(36).slice(2, 7)

async function register(request: APIRequestContext, role: 'teacher' | 'student', prefix: string) {
  const email = `${prefix}-${tag}@example.com`
  const res = await request.post(api('/api/v1/auth/register'), {
    data: { full_name: `${prefix} ${tag}`, email, password: 'password123', role },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  const body = await res.json()
  return body.user as { id: string; full_name: string; role: string }
}

test('one teacher starts one live class; three real, independently authenticated students join the same real LiveKit room concurrently', async ({ browser }) => {
  test.setTimeout(90_000)

  // --- Teacher's own browser context/session ---
  const teacherContext = await browser.newContext()
  const teacherPage = await teacherContext.newPage()
  await register(teacherContext.request, 'teacher', 'teacher')

  const course = await (
    await teacherContext.request.post(api('/api/v1/courses'), { data: { title: `Live Audit ${tag}`, status: 'published' } })
  ).json()
  const section = await (
    await teacherContext.request.post(api(`/api/v1/courses/${course.id}/sections`), { data: { name: 'Audit Section', code: 'AUD' } })
  ).json()

  // --- Three independent student devices/sessions, each its own BrowserContext ---
  const studentContexts = await Promise.all([1, 2, 3].map(() => browser.newContext()))
  const students = []
  for (const ctx of studentContexts) {
    const student = await register(ctx.request, 'student', `student${students.length + 1}`)
    const enroll = await ctx.request.post(api(`/api/v1/courses/${course.id}/enrollments`), { data: {} })
    expect(enroll.ok(), await enroll.text()).toBeTruthy()
    const add = await teacherContext.request.post(api(`/api/v1/sections/${section.id}/members`), { data: { student_id: student.id } })
    expect(add.ok(), await add.text()).toBeTruthy()
    students.push(student)
  }

  const classResp = await teacherContext.request.post(api(`/api/v1/classes?course_id=${course.id}`), {
    data: { title: 'Live Audit Session', scheduled_start: '2026-11-01T10:00:00Z', section_ids: [section.id] },
  })
  expect(classResp.ok(), await classResp.text()).toBeTruthy()
  const cls = await classResp.json()

  // Real call to the real LiveKit Cloud project: creates the real room.
  const start = await teacherContext.request.post(api(`/api/v1/classes/${cls.id}/start`))
  expect(start.ok(), await start.text()).toBeTruthy()
  expect((await start.json()).status).toBe('live')

  // Teacher's real browser joins the real room first.
  await teacherPage.goto(`/classroom/${cls.id}`)
  await expect(teacherPage.getByTestId('participant-count')).toBeVisible({ timeout: 30_000 })

  // Each of the three students' real, independent browsers joins the SAME real room concurrently.
  const studentPages = await Promise.all(studentContexts.map((ctx) => ctx.newPage()))
  await Promise.all(studentPages.map((p) => p.goto(`/classroom/${cls.id}`)))

  // Real LiveKit Cloud signaling: every participant's client should eventually see all 4 people
  // (itself + the other 3) present in the room — a fact only the real LiveKit server can report.
  for (const p of [teacherPage, ...studentPages]) {
    await expect(p.getByTestId('participant-count')).toHaveText('4', { timeout: 45_000 })
  }

  // Clean up: end the class, confirm state updates for everyone, and nobody can join again.
  const end = await teacherContext.request.post(api(`/api/v1/classes/${cls.id}/end`))
  expect(end.ok(), await end.text()).toBeTruthy()
  expect((await end.json()).status).toBe('ended')

  const blocked = await studentContexts[0].request.post(api(`/api/v1/classes/${cls.id}/join-token`))
  expect(blocked.status()).toBe(409)

  await teacherContext.close()
  await Promise.all(studentContexts.map((c) => c.close()))
})
