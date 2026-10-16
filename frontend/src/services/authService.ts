import type { CollegeSelection } from './registrationApi'
import { api, apiRequest } from './apiClient'
import type { AuthResponse, User } from '../types'

/**
 * Authentication is a server-managed httpOnly session cookie. JavaScript never sees a token;
 * the user object kept here is only a display cache so the UI can render while offline.
 * On a shared device the cache lives in sessionStorage and disappears with the tab.
 */
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

  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    this.cacheUser(data.user)
    return data
  },

  async register(
    email: string,
    fullName: string,
    password: string,
    role: 'student' | 'teacher',
    inviteCode?: string,
    college?: CollegeSelection
  ): Promise<AuthResponse> {
    const data = await apiRequest<AuthResponse>('/auth/register', {
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
      }),
    })
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
