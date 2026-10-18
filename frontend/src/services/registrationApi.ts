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
  /** Required for both teachers and students: the admin-issued code for the selected college. */
  collegeCode?: string
}

export interface CollegeTeacher {
  id: string
  full_name: string
  branch: { id: string; name: string } | null
  section: { id: string; name: string } | null
  all_sections: boolean
  courses: { id: string; title: string }[]
}

export interface CollegeRegistrationRequestInput {
  collegeName: string
  location?: string
  contactEmail?: string
  contactPhone?: string
  adminFullName: string
  adminEmail: string
  adminPassword: string
  /** From the registration email-verification step (authService.verifyRegistrationOtp). */
  verificationToken: string
}

export interface CollegeRegistrationRequestResult {
  id: string
  college_name: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

/** Public, read live from the administrator-managed records: nothing here is hardcoded. */
export const registrationApi = {
  listColleges: () => apiRequest<RegistrationCollege[]>('/registration/colleges', { cache: 'no-store' }),
  listBranches: (collegeId: string) =>
    apiRequest<RegistrationBranch[]>(`/registration/colleges/${encodeURIComponent(collegeId)}/branches`, { cache: 'no-store' }),
  listSections: (branchId: string) =>
    apiRequest<RegistrationSection[]>(`/registration/branches/${encodeURIComponent(branchId)}/sections`, { cache: 'no-store' }),
  /** Authenticated, student-only: teachers in the signed-in student's own college/section (or
   * branch-wide). Discovery only — never implies enrollment or course access. */
  listMyCollegeTeachers: () => apiRequest<CollegeTeacher[]>('/users/me/college-teachers'),
  /** Public: a college registering itself, pending platform-admin approval. */
  requestCollegeRegistration: (input: CollegeRegistrationRequestInput) =>
    apiRequest<CollegeRegistrationRequestResult>('/registration/colleges/request', {
      method: 'POST',
      body: JSON.stringify({
        college_name: input.collegeName,
        location: input.location || undefined,
        contact_email: input.contactEmail || undefined,
        contact_phone: input.contactPhone || undefined,
        admin_full_name: input.adminFullName,
        admin_email: input.adminEmail,
        admin_password: input.adminPassword,
        verification_token: input.verificationToken,
      }),
    }),
}
