export interface ApiErrorPayload {
  message: string
  status: number
  isNetworkError: boolean
}

export class ApiError extends Error {
  status: number
  isNetworkError: boolean

  constructor(message: string, status: number = 0, isNetworkError: boolean = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.isNetworkError = isNetworkError
  }
}

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
  
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const token = sessionStorage.getItem('eduvillage_token') || localStorage.getItem('eduvillage_token')
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (response.status === 401) {
      // Clear token on 401 Unauthorized
      sessionStorage.removeItem('eduvillage_token')
      sessionStorage.removeItem('eduvillage_user')
      localStorage.removeItem('eduvillage_token')
      localStorage.removeItem('eduvillage_user')
      window.dispatchEvent(new CustomEvent('eduvillage:auth:expired'))
      
      const errorData = await response.json().catch(() => ({}))
      throw new ApiError(errorData.detail || 'Session expired. Please log in again.', 401)
    }

    if (!response.ok) {
      let errorMessage = `HTTP Error ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData.detail || errorData.message || errorMessage
      } catch {
        // Fallback to response text
        const text = await response.text().catch(() => '')
        if (text) errorMessage = text
      }
      throw new ApiError(errorMessage, response.status)
    }

    if (response.status === 204) {
      return {} as T
    }

    return await response.json()
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err
    }
    // Network failure (server down, offline, DNS failure, etc.)
    throw new ApiError(
      'Unable to connect to EduVillage server. Operating in offline mode.',
      0,
      true
    )
  }
}

// =============================================================================
// TYPED API SERVICE MODULES
// =============================================================================

import type {
  User,
  Course,
  Lesson,
  ClassRoom,
  JoinTokenResponse,
  Assignment,
  Submission,
  Summary,
  Material,
  Section,
  Recording,
  SyncOperation,
} from '../types'

export const api = {
  // --- Auth ---
  getCurrentUser: () => apiRequest<User>('/api/auth/me'),

  // --- Courses & Lessons ---
  getCourses: () => apiRequest<Course[]>('/api/courses'),
  getCourse: (id: string) => apiRequest<Course>(`/api/courses/${id}`),
  createCourse: (data: { title: string; code: string; description?: string }) =>
    apiRequest<Course>('/api/courses', { method: 'POST', body: JSON.stringify(data) }),
  createLesson: (courseId: string, data: Partial<Lesson>) =>
    apiRequest<Lesson>(`/api/courses/${courseId}/lessons`, { method: 'POST', body: JSON.stringify(data) }),
  getLesson: (id: string) => apiRequest<Lesson>(`/api/lessons/${id}`),

  // --- Sections (Multi-Section / Cohorts) ---
  getSections: (courseId?: string) =>
    apiRequest<Section[]>(`/api/sections${courseId ? `?course_id=${encodeURIComponent(courseId)}` : ''}`),
  createSection: (data: { course_id: string; name: string; code: string; student_count?: number }) =>
    apiRequest<Section>('/api/sections', { method: 'POST', body: JSON.stringify(data) }),

  // --- Classes & Real-Time Classroom ---
  getClasses: () => apiRequest<ClassRoom[]>('/api/classes'),
  getClass: (id: string) => apiRequest<ClassRoom>(`/api/classes/${id}`),
  scheduleClass: (data: { course_id: string; section_id?: string; title: string; scheduled_at: string }) =>
    apiRequest<ClassRoom>('/api/classes', { method: 'POST', body: JSON.stringify(data) }),
  startClass: (id: string) =>
    apiRequest<ClassRoom>(`/api/classes/${id}/start`, { method: 'POST' }),
  endClass: (id: string) =>
    apiRequest<ClassRoom>(`/api/classes/${id}/end`, { method: 'POST' }),
  getJoinToken: (classId: string) =>
    apiRequest<JoinTokenResponse>(`/api/classes/${classId}/join-token`, { method: 'POST' }),

  // --- Recorded Lessons ---
  getRecordings: (params?: { course_id?: string; section_id?: string; status?: string }) => {
    const query = new URLSearchParams()
    if (params?.course_id) query.set('course_id', params.course_id)
    if (params?.section_id) query.set('section_id', params.section_id)
    if (params?.status) query.set('status', params.status)
    const qs = query.toString()
    return apiRequest<Recording[]>(`/api/recordings${qs ? `?${qs}` : ''}`)
  },
  getRecording: (id: string) => apiRequest<Recording>(`/api/recordings/${id}`),
  createRecording: (data: Partial<Recording>) =>
    apiRequest<Recording>('/api/recordings', { method: 'POST', body: JSON.stringify(data) }),
  reuseRecording: (recordingId: string, targetSectionIds: string[]) =>
    apiRequest<Recording>(`/api/recordings/${recordingId}/reuse`, {
      method: 'POST',
      body: JSON.stringify({ target_section_ids: targetSectionIds }),
    }),
  saveRecordingProgress: (recordingId: string, positionSeconds: number, completed: boolean = false) =>
    apiRequest<{ status: string; position_seconds: number; completed: boolean }>(
      `/api/recordings/${recordingId}/progress`,
      {
        method: 'POST',
        body: JSON.stringify({ position_seconds: positionSeconds, completed }),
      }
    ),
  togglePublishRecording: (recordingId: string) =>
    apiRequest<Recording>(`/api/recordings/${recordingId}/publish`, { method: 'POST' }),

  // --- Summaries ---
  getClassSummary: (classId: string) => apiRequest<Summary>(`/api/classes/${classId}/summary`),
  createSummaryJob: (classId: string) =>
    apiRequest<{ job_id: string; status: string }>(`/api/classes/${classId}/summary-jobs`, { method: 'POST' }),
  getSummaries: () => apiRequest<Summary[]>('/api/summaries'),
  reviewSummary: (summaryId: string, action: 'APPROVE' | 'REVISE', teacherNotes?: string) =>
    apiRequest<Summary>(`/api/summaries/${summaryId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, teacher_notes: teacherNotes }),
    }),

  // --- Materials ---
  getMaterials: (courseId?: string) =>
    apiRequest<Material[]>(`/api/materials${courseId ? `?course_id=${encodeURIComponent(courseId)}` : ''}`),
  createMaterial: (data: { course_id: string; lesson_id?: string; title: string; file_url: string; file_type?: string; file_size?: number }) =>
    apiRequest<Material>('/api/materials', { method: 'POST', body: JSON.stringify(data) }),

  // --- Assignments & Submissions ---
  getAssignments: () => apiRequest<Assignment[]>('/api/assignments'),
  getAssignment: (id: string) => apiRequest<Assignment>(`/api/assignments/${id}`),
  createAssignment: (data: { course_id: string; title: string; instructions: string; due_date: string; max_score?: number }) =>
    apiRequest<Assignment>('/api/assignments', { method: 'POST', body: JSON.stringify(data) }),
  submitAssignment: (assignmentId: string, content: string, idempotencyKey: string) =>
    apiRequest<Submission>(`/api/assignments/${assignmentId}/submissions`, {
      method: 'POST',
      body: JSON.stringify({ content, idempotency_key: idempotencyKey }),
    }),
  getSubmissions: (assignmentId: string) => apiRequest<Submission[]>(`/api/assignments/${assignmentId}/submissions`),

  // --- Idempotent Sync Operations ---
  syncOperations: (operations: SyncOperation[]) =>
    apiRequest<{ processed_count: number; results: any[] }>('/api/sync/operations', {
      method: 'POST',
      body: JSON.stringify({
        operations: operations.map(op => ({
          operation_id: op.id,
          idempotency_key: op.idempotencyKey,
          operation_type: op.operationType,
          entity_id: op.entityId,
          payload: op.payload,
          timestamp: op.createdAt,
        })),
      }),
    }),
}

