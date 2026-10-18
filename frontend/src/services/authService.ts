import type { CollegeSelection } from './registrationApi'
import { api, apiRequest } from './apiClient'
import type { AuthResponse, User } from '../types'

/**
 * Authentication is a server-managed httpOnly session cookie. JavaScript never sees a token;
 * the user object kept here is only a display cache so the UI can render while offline.
 * On a shared device the cache lives in sessionStorage and disappears with the tab.
 */
/** 202 from /auth/login: the account is signed in on another device, so this sign-in needs the emailed code. */
export interface LoginOtpChallenge {
  otp_required: true
  email: string
  message: string
  otp_ttl_minutes: number
  resend_cooldown_seconds: number
  dev_otp?: string
}

export const isOtpChallenge = (r: AuthResponse | User | LoginOtpChallenge): r is LoginOtpChallenge => 'otp_required' in r

/** 202 from /auth/register: a college-scoped registration now waits for that college's
 * administrator to approve it — no session is established yet. */
export interface RegistrationPending {
  status: 'pending_approval'
  message: string
}

export const isRegistrationPending = (r: AuthResponse | User | RegistrationPending): r is RegistrationPending =>
  'status' in r && r.status === 'pending_approval'

export const authService = {
  isSharedDevice(): boolean {
    return localStorage.getItem('eduvillage_shared_device') === 'true'
  },

  setSharedDevice(enabled: boolean): void {
    localStorage.setItem('eduvillage_shared_device', String(enabled))
  },

  getStorage(): Storage {
    return this.isSharedDevice() ? sessionStorage : localStorage
  },

  cacheUser(user: User): void {
    this.getStorage().setItem('eduvillage_user', JSON.stringify(user))
  },

  async login(email: string, password: string): Promise<AuthResponse | LoginOtpChallenge> {
    const data = await apiRequest<AuthResponse | LoginOtpChallenge>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    if (isOtpChallenge(data)) return data // no session yet: nothing to cache
    this.cacheUser(data.user)
    return data
  },

  /** Redeems the emailed approval code; the server then starts the session for THIS device. */
  async verifyLoginOtp(email: string, otp: string): Promise<AuthResponse> {
    const data = await apiRequest<AuthResponse>('/auth/login/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    })
    this.cacheUser(data.user)
    return data
  },

  /** Starts registration email verification. Always resolves the same way whether or not the
   * resend cooldown is still active (no new email is sent inside it). */
  async requestRegistrationOtp(email: string): Promise<{ message: string; otp_ttl_minutes: number; resend_cooldown_seconds: number; dev_otp?: string }> {
    return apiRequest('/auth/register/request-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },

  /** On success, returns a short-lived verification token register() requires — never store it
   * outside this flow's own in-memory state (never localStorage/sessionStorage). */
  async verifyRegistrationOtp(email: string, otp: string): Promise<{ verification_token: string; expires_in_minutes: number }> {
    return apiRequest('/auth/register/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    })
  },

  async register(
    email: string,
    fullName: string,
    password: string,
    role: 'student' | 'teacher',
    inviteCode?: string,
    college?: CollegeSelection,
    verificationToken?: string
  ): Promise<AuthResponse | RegistrationPending> {
    const data = await apiRequest<AuthResponse | RegistrationPending>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        full_name: fullName,
        password,
        role,
        invite_code: role === 'teacher' ? inviteCode || undefined : undefined,
        college_id: college?.collegeId || undefined,
        branch_id: college?.branchId || undefined,
        section_id: college?.allSections ? undefined : college?.sectionId || undefined,
        all_sections: role === 'teacher' && college?.allSections ? true : undefined,
        college_code: college?.collegeCode || undefined,
        verification_token: verificationToken || undefined,
      }),
    })
    if (isRegistrationPending(data)) return data
    this.cacheUser(data.user)
    return data
  },

  async getMe(timeoutMs = 8000): Promise<User> {
    return api.getCurrentUser(timeoutMs) // short: offline startup must not hang on a dead connection
  },

  /** Always resolves with the same generic message, whether or not the account exists. */
  async requestPasswordResetOtp(email: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },

  /** On success, returns a short-lived reset authorization — never store it outside this flow's
   * own in-memory navigation state (never localStorage/sessionStorage). */
  async verifyResetOtp(email: string, otp: string): Promise<{ reset_token: string; expires_in_minutes: number }> {
    return apiRequest<{ reset_token: string; expires_in_minutes: number }>('/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    })
  },

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    await apiRequest<void>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ reset_token: resetToken, new_password: newPassword }),
    })
  },

  /** Revokes the session on the server (so a stale cookie on a shared machine is useless), then forgets the local cache. */
  async logout(): Promise<void> {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' })
    } catch {
      // Offline or already expired: still wipe the local cache below.
    }
    this.clearLocalSession()
  },

  clearLocalSession(): void {
    sessionStorage.removeItem('eduvillage_user')
    localStorage.removeItem('eduvillage_user')
  },

  getStoredUser(): User | null {
    const raw = sessionStorage.getItem('eduvillage_user') || localStorage.getItem('eduvillage_user')
    if (!raw) return null
    try {
      return JSON.parse(raw) as User
    } catch {
      return null
    }
  },
}
