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
    inviteCode?: string
  ): Promise<AuthResponse> {
    const data = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        full_name: fullName,
        password,
        role,
        invite_code: role === 'teacher' ? inviteCode || undefined : undefined,
      }),
    })
    this.cacheUser(data.user)
    return data
  },

  async getMe(timeoutMs = 8000): Promise<User> {
    return api.getCurrentUser(timeoutMs) // short: offline startup must not hang on a dead connection
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
