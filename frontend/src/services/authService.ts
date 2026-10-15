import { apiRequest } from './apiClient'
import type { TokenResponse, User } from '../types'

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

  async login(email: string, password: string): Promise<TokenResponse> {
    const data = await apiRequest<TokenResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    const storage = this.getStorage()
    storage.setItem('eduvillage_token', data.access_token)
    storage.setItem('eduvillage_user', JSON.stringify(data.user))
    return data
  },

  async register(
    email: string,
    fullName: string,
    password: string,
    role: 'student' | 'teacher'
  ): Promise<TokenResponse> {
    const data = await apiRequest<TokenResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        full_name: fullName,
        password,
        role,
      }),
    })
    const storage = this.getStorage()
    storage.setItem('eduvillage_token', data.access_token)
    storage.setItem('eduvillage_user', JSON.stringify(data.user))
    return data
  },

  async getMe(): Promise<User> {
    return apiRequest<User>('/api/auth/me')
  },

  async refresh(): Promise<TokenResponse> {
    const data = await apiRequest<TokenResponse>('/api/auth/refresh', {
      method: 'POST',
    })
    const storage = this.getStorage()
    storage.setItem('eduvillage_token', data.access_token)
    storage.setItem('eduvillage_user', JSON.stringify(data.user))
    return data
  },

  logout(): void {
    sessionStorage.removeItem('eduvillage_token')
    sessionStorage.removeItem('eduvillage_user')
    localStorage.removeItem('eduvillage_token')
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

  getToken(): string | null {
    return sessionStorage.getItem('eduvillage_token') || localStorage.getItem('eduvillage_token')
  },
}

