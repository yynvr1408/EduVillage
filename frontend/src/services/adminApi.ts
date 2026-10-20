/**
 * Admin panel transport. Deliberately separate from apiClient: an expired admin session must never
 * trigger the student/teacher "session expired" flow or clear their offline cache. Authentication is a
 * server-set HttpOnly cookie; nothing secret is ever held or stored in JavaScript.
 */

import { apiUrl } from './apiClient'

export type CollegeStatus = 'active' | 'inactive'

export interface College {
  id: string
  name: string
  location: string | null
  contact_email: string | null
  contact_phone: string | null
  code: string
  code_generated_at: string
  status: CollegeStatus
  created_at: string
  updated_at: string
}

export interface CollegePage {
  items: College[]
  total: number
  limit: number
  offset: number
}

export interface CollegeBranch {
  id: string
  college_id: string
  name: string
  short_code: string | null
  status: CollegeStatus
}

export interface CollegeSection {
  id: string
  college_id: string
  branch_id: string
  name: string
  status: CollegeStatus
}

export interface AdminOverview {
  total_colleges: number
  active_colleges: number
  inactive_colleges: number
  total_codes_generated: number
}

export interface CollegeInput {
  name: string
  location?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  status?: CollegeStatus
}

export interface CollegeRegistrationRequest {
  id: string
  college_name: string
  location: string | null
  contact_email: string | null
  contact_phone: string | null
  admin_full_name: string
  admin_email: string
  status: 'pending' | 'approved' | 'rejected'
  rejected_reason: string | null
  resulting_college_id: string | null
  created_at: string
  decided_at: string | null
}

export interface CollegeDeletionRequest {
  id: string
  college_id: string
  status: 'pending' | 'confirmed' | 'cancelled'
  requested_at: string
  confirmed_at: string | null
}

export interface AuditEvent {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  resource_type: string
  resource_id: string | null
  created_at: string
}

export interface AuditEventPage {
  items: AuditEvent[]
  total: number
  limit: number
  offset: number
}

export class AdminApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(`/admin${path}`), {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'X-EduVillage-Admin': '1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new AdminApiError('Cannot reach the server. Check your connection and try again.', 0, 'NETWORK')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const first = data?.error?.details?.errors?.[0]
    const message = first?.msg ? String(first.msg) : data?.error?.message || 'Something went wrong. Please try again.'
    throw new AdminApiError(message, res.status, data?.error?.code)
  }
  return data as T
}

const qs = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)))
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const adminApi = {
  login: (username: string, password: string) =>
    request<{ username: string; display_name: string }>('POST', '/auth/login', { username, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<{ username: string; display_name: string }>('GET', '/auth/me'),
  overview: () => request<AdminOverview>('GET', '/overview'),
  listColleges: (p: { search?: string; status?: CollegeStatus | ''; limit?: number; offset?: number }) =>
    request<CollegePage>('GET', `/colleges${qs({ search: p.search?.trim(), status: p.status || undefined, limit: p.limit, offset: p.offset })}`),
  createCollege: (input: CollegeInput) => request<College>('POST', '/colleges', input),
  updateCollege: (id: string, input: Partial<CollegeInput>) => request<College>('PATCH', `/colleges/${id}`, input),
  setStatus: (id: string, status: CollegeStatus) => request<College>('POST', `/colleges/${id}/status`, { status }),
  regenerateCode: (id: string) => request<College>('POST', `/colleges/${id}/regenerate-code`),
  listBranches: (collegeId: string, search?: string) =>
    request<CollegeBranch[]>('GET', `/colleges/${collegeId}/branches${qs({ search: search?.trim() })}`),
  createBranch: (collegeId: string, name: string, shortCode?: string) =>
    request<CollegeBranch>('POST', `/colleges/${collegeId}/branches`, { name, short_code: shortCode || null }),
  updateBranch: (id: string, input: { name?: string; short_code?: string | null }) => request<CollegeBranch>('PATCH', `/branches/${id}`, input),
  setBranchStatus: (id: string, status: CollegeStatus) => request<CollegeBranch>('POST', `/branches/${id}/status`, { status }),
  listSections: (branchId: string, search?: string) =>
    request<CollegeSection[]>('GET', `/branches/${branchId}/sections${qs({ search: search?.trim() })}`),
  createSection: (branchId: string, name: string) => request<CollegeSection>('POST', `/branches/${branchId}/sections`, { name }),
  updateSection: (id: string, name: string) => request<CollegeSection>('PATCH', `/sections/${id}`, { name }),
  setSectionStatus: (id: string, status: CollegeStatus) => request<CollegeSection>('POST', `/sections/${id}/status`, { status }),

  // ---- self-service college registration requests ------------------------------------------
  listCollegeRequests: (status?: 'pending' | 'approved' | 'rejected') =>
    request<CollegeRegistrationRequest[]>('GET', `/college-requests${qs({ status })}`),
  approveCollegeRequest: (requestId: string) => request<College>('POST', `/college-requests/${requestId}/approve`),
  rejectCollegeRequest: (requestId: string, reason?: string) =>
    request<CollegeRegistrationRequest>('POST', `/college-requests/${requestId}/reject`, { reason: reason || undefined }),

  // ---- college deletion: the super admin may only REQUEST it -------------------------------
  requestCollegeDeletion: (collegeId: string) => request<CollegeDeletionRequest>('POST', `/colleges/${collegeId}/deletion-requests`),
  getDeletionRequestStatus: (collegeId: string) => request<CollegeDeletionRequest | null>('GET', `/colleges/${collegeId}/deletion-requests`),

  // ---- audit trail ---------------------------------------------------------------------------
  listAuditEvents: (p: { action?: string; resourceType?: string; actorId?: string; limit?: number; offset?: number }) =>
    request<AuditEventPage>(
      'GET',
      `/audit-events${qs({ action: p.action, resource_type: p.resourceType, actor_id: p.actorId, limit: p.limit, offset: p.offset })}`
    ),
}
