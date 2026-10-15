import { apiRequest } from './apiClient'

export interface RegistrationCollege {
  id: string
  name: string
  location: string | null
}

export interface RegistrationBranch {
  id: string
  name: string
  short_code: string | null
}

export interface RegistrationSection {
  id: string
  college_id: string
  branch_id: string
  name: string
}

export interface CollegeSelection {
  collegeId: string
  branchId: string
  /** Exactly one of sectionId / allSections. "All sections" is a branch-wide teacher assignment, never a section. */
  sectionId?: string
  allSections?: boolean
  /** Required for teachers; students never need it. */
  collegeCode?: string
}

/** Public, read live from the administrator-managed records: nothing here is hardcoded. */
export const registrationApi = {
  listColleges: () => apiRequest<RegistrationCollege[]>('/registration/colleges', { cache: 'no-store' }),
  listBranches: (collegeId: string) =>
    apiRequest<RegistrationBranch[]>(`/registration/colleges/${encodeURIComponent(collegeId)}/branches`, { cache: 'no-store' }),
  listSections: (branchId: string) =>
    apiRequest<RegistrationSection[]>(`/registration/branches/${encodeURIComponent(branchId)}/sections`, { cache: 'no-store' }),
}
