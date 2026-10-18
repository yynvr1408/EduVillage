/**
 * Self-serve institution management for a teacher delegated as a college administrator.
 * Distinct from adminApi: that's the platform admin's own, separate-session transport. This one
 * rides the ordinary teacher session (apiRequest, same as every other student/teacher call) —
 * the backend checks the delegation as an extra permission on top of it, not a separate login.
 * Deliberately the same shape as the subset of adminApi that CollegeStructureDialog needs, so
 * that component works unmodified for either the platform admin or a delegated teacher.
 */

import { apiRequest } from './apiClient'
import type { College, CollegeBranch, CollegeSection, CollegeStatus } from './adminApi'

const qs = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => v && q.set(k, v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const institutionAdminApi = {
  myColleges: () => apiRequest<College[]>('/institution-admin/colleges'),
  getCollege: (id: string) => apiRequest<College>(`/institution-admin/colleges/${id}`),
  updateCollege: (id: string, input: { name?: string; location?: string | null; contact_email?: string | null; contact_phone?: string | null }) =>
    apiRequest<College>(`/institution-admin/colleges/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  regenerateCode: (id: string) => apiRequest<College>(`/institution-admin/colleges/${id}/regenerate-code`, { method: 'POST' }),
  listBranches: (collegeId: string, search?: string) =>
    apiRequest<CollegeBranch[]>(`/institution-admin/colleges/${collegeId}/branches${qs({ search: search?.trim() })}`),
  createBranch: (collegeId: string, name: string, shortCode?: string) =>
    apiRequest<CollegeBranch>(`/institution-admin/colleges/${collegeId}/branches`, {
      method: 'POST',
      body: JSON.stringify({ name, short_code: shortCode || null }),
    }),
  updateBranch: (id: string, input: { name?: string; short_code?: string | null }) =>
    apiRequest<CollegeBranch>(`/institution-admin/branches/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  setBranchStatus: (id: string, status: CollegeStatus) =>
    apiRequest<CollegeBranch>(`/institution-admin/branches/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  listSections: (branchId: string, search?: string) =>
    apiRequest<CollegeSection[]>(`/institution-admin/branches/${branchId}/sections${qs({ search: search?.trim() })}`),
  createSection: (branchId: string, name: string) =>
    apiRequest<CollegeSection>(`/institution-admin/branches/${branchId}/sections`, { method: 'POST', body: JSON.stringify({ name }) }),
  updateSection: (id: string, name: string) =>
    apiRequest<CollegeSection>(`/institution-admin/sections/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  setSectionStatus: (id: string, status: CollegeStatus) =>
    apiRequest<CollegeSection>(`/institution-admin/sections/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
}
