/**
 * The single place the frontend talks to the backend.
 *
 * - `apiRequest` is the transport: cookie-session auth (no tokens in JS), `/api/v1` prefix,
 *   and the backend's `{ error: { code, message } }` error shape.
 * - `api` adapts the backend's resource-oriented v1 contract to the view models the pages use
 *   (see ../types), so every service and page goes through one mapping layer.
 */

import type {
  Assignment,
  ClassRoom,
  ClassStatus,
  Course,
  JoinTokenResponse,
  Lesson,
  Material,
  MaterialType,
  Recording,
  RecordingStatus,
  Section,
  Submission,
  Summary,
  SummaryStatus,
  SyncOperation,
  User,
} from '../types'

export class ApiError extends Error {
  status: number
  isNetworkError: boolean
  code?: string

  constructor(message: string, status: number = 0, isNetworkError: boolean = false, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.isNetworkError = isNetworkError
    this.code = code
  }
}

export const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')
export const API_PREFIX = '/api/v1'

export function apiUrl(path: string): string {
  return `${BASE_URL}${path.startsWith('/api/') ? path : `${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`}`
}

/** FastAPI validation errors arrive as a list; flatten to one readable sentence. */
function messageFrom(body: any, fallback: string): string {
  if (!body) return fallback
  if (typeof body.error?.message === 'string') {
    const errors = body.error?.details?.errors
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0]
      const where = Array.isArray(first.loc) ? first.loc.filter((p: unknown) => p !== 'body').join('.') : ''
      return where ? `${where}: ${first.msg}` : first.msg
    }
    return body.error.message
  }
  if (typeof body.detail === 'string') return body.detail
  if (typeof body.message === 'string') return body.message
  return fallback
}

export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(apiUrl(endpoint), { ...options, headers, credentials: 'include' })
  } catch {
    // Network failure (server down, offline, DNS failure, etc.)
    throw new ApiError('Unable to connect to EduVillage server. Operating in offline mode.', 0, true)
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (response.status === 401 && body?.error?.code !== 'INVALID_CREDENTIALS') {
      // The server no longer recognizes this session (expired, revoked, signed out elsewhere).
      sessionStorage.removeItem('eduvillage_user')
      localStorage.removeItem('eduvillage_user')
      window.dispatchEvent(new CustomEvent('eduvillage:auth:expired'))
    }
    throw new ApiError(
      messageFrom(body, response.status === 401 ? 'Session expired. Please log in again.' : `HTTP Error ${response.status}`),
      response.status,
      false,
      body?.error?.code
    )
  }

  if (response.status === 204) return {} as T
  return (await response.json()) as T
}

// =============================================================================
// BACKEND (v1) -> VIEW MODEL MAPPERS
// =============================================================================

type Raw = Record<string, any>

export function courseCode(c: Raw): string {
  const base = (c.subject || c.title || 'EDU').replace(/[^A-Za-z0-9 ]/g, '').trim()
  return base.includes(' ') ? base.toUpperCase() : base.slice(0, 8).toUpperCase() || 'EDU'
}

function mapUser(u: Raw): User {
  return { id: u.id, email: u.email, full_name: u.full_name, role: u.role, status: u.status, created_at: u.created_at }
}

function mapCourse(c: Raw, lessons?: Lesson[]): Course {
  return {
    id: c.id,
    title: c.title,
    code: courseCode(c),
    description: c.description ?? undefined,
    teacher_id: c.teacher_id,
    teacher_name: c.teacher_name ?? undefined,
    created_at: c.created_at,
    lessons_count: lessons?.length,
    lessons,
  }
}

function mapLesson(l: Raw): Lesson {
  return {
    id: l.id,
    course_id: l.course_id,
    title: l.title,
    content: l.content ?? undefined,
    order_index: l.position ?? 0,
    offline_ready: true,
    created_at: l.created_at ?? '',
  }
}

function mapResource(r: Raw): Material {
  return {
    id: r.id,
    course_id: r.course_id,
    lesson_id: r.lesson_id ?? undefined,
    title: r.title || r.filename,
    description: r.description ?? undefined,
    resource_type: r.resource_type ?? undefined,
    processing_status: r.processing_status,
    processing_error: r.processing_error ?? undefined,
    version: r.version ?? 1,
    checksum_sha256: r.checksum_sha256 ?? undefined,
    file_url: `${API_PREFIX}/resources/${r.id}/download`,
    file_type: r.mime_type,
    file_size: r.size_bytes,
    is_published: Boolean(r.is_published) && r.status === 'available',
    created_at: r.created_at ?? '',
  }
}

const CLASS_STATUS: Record<string, ClassStatus> = {
  scheduled: 'SCHEDULED',
  live: 'LIVE',
  ended: 'ENDED',
  cancelled: 'CANCELLED',
}

const RECORDING_STATUS: Record<string, RecordingStatus> = {
  recording: 'PROCESSING',
  processing: 'PROCESSING',
  available: 'READY',
  failed: 'FAILED',
  archived: 'ARCHIVED',
}

const SUMMARY_STATUS: Record<string, SummaryStatus> = {
  queued: 'QUEUED',
  processing: 'PROCESSING',
  needs_review: 'NEEDS_REVIEW',
  completed: 'COMPLETED',
  failed: 'FAILED',
}

type CourseIndex = Map<string, Course>

async function courseIndex(): Promise<CourseIndex> {
  const courses = await apiRequest<Raw[]>('/courses?limit=200').catch(() => [] as Raw[])
  return new Map(courses.map((c) => [c.id, mapCourse(c)]))
}

function mapClass(c: Raw, courses: CourseIndex): ClassRoom {
  const course = courses.get(c.course_id)
  return {
    id: c.id,
    course_id: c.course_id,
    section_id: c.section_ids?.[0],
    course_title: course?.title,
    course_code: course?.code,
    teacher_id: c.teacher_id,
    teacher_name: course?.teacher_name,
    title: c.title,
    status: CLASS_STATUS[c.status] ?? 'SCHEDULED',
    scheduled_at: c.scheduled_start,
    livekit_room_name: c.livekit_room_name ?? '',
  }
}

function mapRecording(r: Raw, courses: CourseIndex): Recording {
  const course = courses.get(r.course_id)
  return {
    id: r.id,
    course_id: r.course_id,
    course_title: r.course_title ?? course?.title,
    course_code: course?.code,
    class_id: r.class_id,
    teacher_id: course?.teacher_id ?? '',
    teacher_name: course?.teacher_name,
    title: r.title ?? 'Recorded lecture',
    duration_seconds: r.duration_seconds ?? 0,
    file_size_bytes: r.size_bytes ?? 0,
    status: RECORDING_STATUS[r.status] ?? 'PROCESSING',
    has_transcript: Boolean(r.has_transcript),
    has_summary: Boolean(r.summary_id),
    summary_id: r.summary_id ?? undefined,
    section_ids: r.section_ids ?? [],
    is_published: Boolean(r.is_published),
    created_at: r.started_at,
    user_progress_seconds: r.progress_seconds ?? 0,
    user_completed: Boolean(r.completed),
    transcript: r.transcript ?? undefined,
    error_message: r.error_message ?? undefined,
  }
}

function mapSummary(s: Raw, courseId = ''): Summary {
  const c = s.content_json || {}
  // The backend stores definitions as plain strings ("Term: meaning"); the viewer wants term/definition pairs.
  const definitions = (c.definitions || []).map((d: string) => {
    const i = String(d).indexOf(':')
    return i > 0 ? { term: d.slice(0, i).trim(), definition: d.slice(i + 1).trim() } : { term: String(d), definition: '' }
  })
  return {
    id: s.id,
    class_id: s.class_id,
    course_id: courseId,
    status: SUMMARY_STATUS[s.status] ?? 'QUEUED',
    review_status: s.status === 'completed' ? 'APPROVED' : s.status === 'queued' && s.reviewed_by ? 'REVISION_REQUESTED' : 'PENDING',
    overview: c.overview,
    key_concepts: c.key_concepts,
    definitions,
    examples: c.examples,
    revision_questions: c.revision_questions,
    generator: s.generator ?? c.source ?? undefined,
    teacher_edited: Boolean(c.teacher_edited),
    created_at: s.created_at ?? '',
  }
}

function mapSubmission(s: Raw): Submission {
  return {
    id: s.id,
    assignment_id: s.assignment_id,
    student_id: s.student_id,
    content: s.answer?.text ?? '',
    status: 'SUBMITTED',
    submitted_at: s.submitted_at ?? s.updated_at,
    score: undefined,
    feedback: undefined,
  }
}

function mapAssignment(a: Raw, courses: CourseIndex, mine?: Raw | null, submissionsCount?: number): Assignment {
  return {
    id: a.id,
    course_id: a.course_id,
    course_title: courses.get(a.course_id)?.title,
    title: a.title,
    instructions: a.instructions ?? '',
    due_date: a.due_at ?? '',
    max_score: 100,
    created_at: a.created_at ?? '',
    submissions_count: submissionsCount,
    // Only a *submitted* server record counts as submitted; a saved draft is not a submission.
    my_submission: mine && mine.status === 'submitted' ? mapSubmission(mine) : null,
  }
}

const SYNC_OPERATION_TYPE: Record<string, string> = { submit_assignment: 'assignment_submission' }

// =============================================================================
// TYPED API
// =============================================================================

export const api = {
  // --- Auth / profile ---
  getCurrentUser: async () => mapUser(await apiRequest<Raw>('/users/me')),

  // --- Courses & lessons ---
  getCourses: async () => (await apiRequest<Raw[]>('/courses?limit=200')).map((c) => mapCourse(c)),
  getCourseCatalog: async () => (await apiRequest<Raw[]>('/courses/catalog?limit=200')).map((c) => mapCourse(c)),
  enroll: (courseId: string) =>
    apiRequest<Raw>(`/courses/${courseId}/enrollments`, { method: 'POST', body: JSON.stringify({}) }),
  getCourse: async (id: string) => {
    const [course, lessons] = await Promise.all([
      apiRequest<Raw>(`/courses/${id}`),
      apiRequest<Raw[]>(`/courses/${id}/lessons`).catch(() => [] as Raw[]),
    ])
    return mapCourse(course, lessons.map(mapLesson))
  },
  createCourse: async (data: { title: string; code: string; description?: string }) =>
    mapCourse(
      await apiRequest<Raw>('/courses', {
        method: 'POST',
        body: JSON.stringify({ title: data.title, description: data.description, subject: data.code, status: 'published' }),
      })
    ),
  createLesson: async (courseId: string, data: { title: string; content?: string; order_index?: number }) =>
    mapLesson(
      await apiRequest<Raw>(`/courses/${courseId}/lessons`, {
        method: 'POST',
        body: JSON.stringify({ title: data.title, content: data.content, position: data.order_index ?? 0, status: 'published' }),
      })
    ),
  getLesson: async (id: string) => mapLesson(await apiRequest<Raw>(`/lessons/${id}`)),
  getLessonAssets: async (lessonId: string) => {
    const lesson = await apiRequest<Raw>(`/lessons/${lessonId}`)
    const resources = await apiRequest<Raw[]>(`/courses/${lesson.course_id}/resources`)
    return resources.filter((r) => r.lesson_id === lessonId).map(mapResource)
  },

  // --- Sections (multi-section cohorts) ---
  getSections: async (courseId?: string): Promise<Section[]> => {
    const courseIds = courseId ? [courseId] : (await apiRequest<Raw[]>('/courses?limit=200')).map((c) => c.id)
    const lists = await Promise.all(
      courseIds.map((id) => apiRequest<Raw[]>(`/courses/${id}/sections`).catch(() => [] as Raw[]))
    )
    return Promise.all(
      lists.flat().map(async (s) => {
        // Member lists are teacher-only; students just see a 0 count for their own section.
        const members = await apiRequest<Raw[]>(`/sections/${s.id}/members`).catch(() => [] as Raw[])
        return { id: s.id, course_id: s.course_id, name: s.name, code: s.code, student_count: members.length, created_at: '' }
      })
    )
  },
  createSection: async (data: { course_id: string; name: string; code: string }) => {
    const s = await apiRequest<Raw>(`/courses/${data.course_id}/sections`, {
      method: 'POST',
      body: JSON.stringify({ name: data.name, code: data.code }),
    })
    return { id: s.id, course_id: s.course_id, name: s.name, code: s.code, student_count: 0, created_at: '' } as Section
  },

  // --- Classes & real-time classroom ---
  getClasses: async () => {
    const [classes, courses] = await Promise.all([apiRequest<Raw[]>('/classes?limit=200'), courseIndex()])
    return classes.map((c) => mapClass(c, courses))
  },
  getClass: async (id: string) => {
    const [c, courses] = await Promise.all([apiRequest<Raw>(`/classes/${id}`), courseIndex()])
    return mapClass(c, courses)
  },
  scheduleClass: async (data: { course_id: string; title: string; scheduled_at: string; section_id?: string }) => {
    const c = await apiRequest<Raw>(`/classes?course_id=${encodeURIComponent(data.course_id)}`, {
      method: 'POST',
      body: JSON.stringify({
        title: data.title,
        scheduled_start: data.scheduled_at,
        section_ids: data.section_id ? [data.section_id] : [],
      }),
    })
    return mapClass(c, await courseIndex())
  },
  startClass: async (id: string) => mapClass(await apiRequest<Raw>(`/classes/${id}/start`, { method: 'POST' }), await courseIndex()),
  endClass: async (id: string) => mapClass(await apiRequest<Raw>(`/classes/${id}/end`, { method: 'POST' }), await courseIndex()),
  getJoinToken: async (classId: string): Promise<JoinTokenResponse> => {
    const t = await apiRequest<Raw>(`/classes/${classId}/join-token`, { method: 'POST' })
    return {
      token: t.token,
      url: t.livekit_url,
      room_name: t.room_name,
      is_publisher: Boolean(t.can_publish),
      recording_active: Boolean(t.recording_active),
    }
  },
  getClassRecordings: (classId: string) => apiRequest<Raw[]>(`/classes/${classId}/recordings`),
  startRecording: (classId: string) => apiRequest<Raw>(`/classes/${classId}/recordings/start`, { method: 'POST' }),
  stopRecording: (classId: string, recordingId: string) =>
    apiRequest<Raw>(`/classes/${classId}/recordings/${recordingId}/stop`, { method: 'POST' }),

  // --- Recorded lectures ---
  getRecordings: async (params?: { course_id?: string; section_id?: string }) => {
    const query = new URLSearchParams()
    if (params?.course_id) query.set('course_id', params.course_id)
    if (params?.section_id) query.set('section_id', params.section_id)
    const qs = query.toString()
    const [items, courses] = await Promise.all([apiRequest<Raw[]>(`/recordings${qs ? `?${qs}` : ''}`), courseIndex()])
    return items.map((r) => mapRecording(r, courses))
  },
  /** Detail view: metadata + transcript, plus (when playable) a short-lived signed playback URL and the approved summary. */
  getRecording: async (id: string): Promise<Recording> => {
    const [raw, courses] = await Promise.all([apiRequest<Raw>(`/recordings/${id}`), courseIndex()])
    const recording = mapRecording(raw, courses)
    if (raw.status === 'available') {
      const playback = await apiRequest<Raw>(`/recordings/${id}/playback`).catch(() => null)
      if (playback) {
        recording.video_url = playback.url
        recording.download_url = playback.url
      }
    }
    if (raw.summary_id) {
      recording.summary = await apiRequest<Raw>(`/classes/${raw.class_id}/summary`)
        .then((s) => mapSummary(s, raw.course_id))
        .catch(() => undefined)
    }
    return recording
  },
  reuseRecording: async (recordingId: string, targetSectionIds: string[]) => {
    for (const sectionId of targetSectionIds) {
      await apiRequest<Raw>(`/recordings/${recordingId}/sections`, { method: 'POST', body: JSON.stringify({ section_id: sectionId }) })
    }
    return api.getRecording(recordingId)
  },
  saveRecordingProgress: (recordingId: string, positionSeconds: number, completed: boolean = false) =>
    apiRequest<{ position_seconds: number; completed: boolean }>(`/recordings/${recordingId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ position_seconds: positionSeconds, completed }),
    }),
  togglePublishRecording: async (recordingId: string) => {
    const current = await apiRequest<Raw>(`/recordings/${recordingId}`)
    const updated = await apiRequest<Raw>(`/recordings/${recordingId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ published: !current.is_published }),
    })
    return mapRecording(updated, await courseIndex())
  },

  // --- Summaries ---
  getClassSummary: async (classId: string) => {
    const [s, cls] = await Promise.all([apiRequest<Raw>(`/classes/${classId}/summary`), apiRequest<Raw>(`/classes/${classId}`)])
    return mapSummary(s, cls.course_id)
  },
  getSummaries: async () => {
    const [list, classes] = await Promise.all([apiRequest<Raw[]>('/summaries'), apiRequest<Raw[]>('/classes?limit=200')])
    const courseOf = new Map(classes.map((c) => [c.id, c.course_id]))
    return list.map((s) => mapSummary(s, courseOf.get(s.class_id)))
  },
  /** Starts summary generation from real material only: a supplied transcript, or the class's latest ready recording. */
  createSummaryJob: async (classId: string, transcriptText?: string) => {
    if (transcriptText?.trim()) {
      return apiRequest<{ job_id: string; status: string }>(`/classes/${classId}/summary-jobs`, {
        method: 'POST',
        body: JSON.stringify({ transcript_text: transcriptText }),
      })
    }
    const recordings = await apiRequest<Raw[]>(`/classes/${classId}/recordings`)
    const ready = recordings.find((r) => r.status === 'available')
    if (!ready) {
      throw new ApiError('There is no transcript or ready recording for this class yet, so a summary cannot be generated.', 409, false, 'NO_SOURCE')
    }
    return apiRequest<{ job_id: string; status: string }>(`/recordings/${ready.id}/summary-jobs`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },
  reviewSummary: async (
    summaryId: string,
    data: {
      action: 'APPROVE' | 'REVISE'
      overview?: string
      key_concepts?: string[]
      definitions?: string[]
      revision_questions?: string[]
    }
  ) => {
    if (data.action === 'APPROVE') {
      const edits = { overview: data.overview, key_concepts: data.key_concepts, revision_questions: data.revision_questions }
      if (Object.values(edits).some((v) => v !== undefined)) {
        await apiRequest<Raw>(`/summaries/${summaryId}`, { method: 'PATCH', body: JSON.stringify(edits) })
      }
      return mapSummary(await apiRequest<Raw>(`/summaries/${summaryId}/approve`, { method: 'POST' }))
    }
    return mapSummary(await apiRequest<Raw>(`/summaries/${summaryId}/request-changes`, { method: 'POST' }))
  },

  // --- Learning materials (real uploads to object storage) ---
  getMaterials: async (courseId?: string) => {
    const ids = courseId ? [courseId] : (await apiRequest<Raw[]>('/courses?limit=200')).map((c) => c.id)
    const lists = await Promise.all(ids.map((id) => apiRequest<Raw[]>(`/courses/${id}/resources`).catch(() => [] as Raw[])))
    return lists.flat().map(mapResource)
  },
  uploadMaterial: async (
    courseId: string,
    file: File,
    options: { lessonId?: string; title?: string; description?: string; resourceType?: MaterialType } = {}
  ): Promise<Material> => {
    const init = await apiRequest<{ resource_id: string; upload: { method: string; url: string; fields: Record<string, string> } }>(
      '/resources/upload-init',
      {
        method: 'POST',
        body: JSON.stringify({
          course_id: courseId,
          lesson_id: options.lessonId,
          title: options.title || undefined,
          description: options.description || undefined,
          resource_type: options.resourceType || undefined,
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
        }),
      }
    )
    if (init.upload.method === 'POST') {
      // S3 presigned POST: fields first, file last.
      const form = new FormData()
      Object.entries(init.upload.fields).forEach(([k, v]) => form.append(k, v))
      form.append('file', file)
      const res = await fetch(init.upload.url, { method: 'POST', body: form })
      if (!res.ok) throw new ApiError('Upload to storage failed.', res.status)
    } else {
      await apiRequest<void>(init.upload.url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      })
    }
    return mapResource(await apiRequest<Raw>(`/resources/${init.resource_id}/complete`, { method: 'POST' }))
  },

  /** Current server-side facts about a file plus where to fetch it (signed URL or same-origin path). */
  getResourceDownloadInfo: async (resourceId: string) => {
    const d = await apiRequest<Raw>(`/resources/${resourceId}/download-info`)
    return {
      url: d.same_origin ? apiUrl(d.url) : (d.url as string),
      sameOrigin: Boolean(d.same_origin),
      version: (d.version ?? 1) as number,
      sizeBytes: (d.size_bytes ?? 0) as number,
      checksum: (d.checksum_sha256 ?? undefined) as string | undefined,
      mimeType: (d.mime_type ?? undefined) as string | undefined,
    }
  },
  setMaterialPublished: async (resourceId: string, published: boolean) =>
    mapResource(await apiRequest<Raw>(`/resources/${resourceId}`, { method: 'PATCH', body: JSON.stringify({ is_published: published }) })),

  // --- Assignments & submissions ---
  getAssignments: async (courseId?: string) => {
    const [list, courses, me] = await Promise.all([
      apiRequest<Raw[]>(`/assignments${courseId ? `?course_id=${encodeURIComponent(courseId)}` : ''}`),
      courseIndex(),
      api.getCurrentUser().catch(() => null),
    ])
    return Promise.all(
      list.map(async (a) => {
        if (me?.role === 'teacher') {
          const subs = await apiRequest<Raw[]>(`/assignments/${a.id}/submissions`).catch(() => [] as Raw[])
          return mapAssignment(a, courses, null, subs.filter((s) => s.status === 'submitted').length)
        }
        const mine = await apiRequest<Raw>(`/assignments/${a.id}/submissions/me`).catch(() => null)
        return mapAssignment(a, courses, mine)
      })
    )
  },
  getAssignment: async (id: string) => {
    const [a, courses] = await Promise.all([apiRequest<Raw>(`/assignments/${id}`), courseIndex()])
    const mine = await apiRequest<Raw>(`/assignments/${id}/submissions/me`).catch(() => null)
    return mapAssignment(a, courses, mine)
  },
  createAssignment: async (data: { course_id: string; title: string; instructions: string; due_date: string }) =>
    mapAssignment(
      await apiRequest<Raw>(`/assignments?course_id=${encodeURIComponent(data.course_id)}`, {
        method: 'POST',
        body: JSON.stringify({
          title: data.title,
          instructions: data.instructions,
          due_at: data.due_date ? new Date(data.due_date).toISOString() : null,
          status: 'published',
        }),
      }),
      await courseIndex()
    ),
  getSubmissions: async (assignmentId: string) =>
    (await apiRequest<Raw[]>(`/assignments/${assignmentId}/submissions`)).filter((s) => s.status === 'submitted').map(mapSubmission),

  // --- Idempotent sync ---
  toServerOperation: (op: Pick<SyncOperation, 'id' | 'operationType' | 'entityId' | 'payload' | 'createdAt'>) => ({
    operation_id: op.id,
    operation_type: SYNC_OPERATION_TYPE[op.operationType] ?? op.operationType,
    entity_id: op.entityId,
    payload: { answer: { text: op.payload?.content ?? '' } },
    client_updated_at: op.createdAt,
  }),
  syncOperations: (operations: SyncOperation[]) =>
    apiRequest<{ results: Array<{ operation_id: string; status: string; server_entity_id?: string; error_code?: string; message?: string }> }>(
      '/sync/operations',
      { method: 'POST', body: JSON.stringify({ operations: operations.map((op) => api.toServerOperation(op)) }) }
    ),
}
