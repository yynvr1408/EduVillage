import type { CollegeSelection } from '../services/registrationApi'
import React, { createContext, useContext, useState, useEffect } from 'react'
import type { User, Role } from '../types'
import { authService, isOtpChallenge, type LoginOtpChallenge } from '../services/authService'
import { db } from '../db/db'
import { ApiError } from '../services/apiClient'

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isTeacher: boolean
  isStudent: boolean
  isLoading: boolean
  isSharedDevice: boolean
  setSharedDevice: (enabled: boolean) => void
  login: (email: string, password: string) => Promise<User | LoginOtpChallenge>
  verifyLoginOtp: (email: string, otp: string) => Promise<User>
  register: (email: string, fullName: string, password: string, role: Role, inviteCode?: string, college?: CollegeSelection) => Promise<User>
  logout: () => Promise<void>
  switchUser: () => Promise<void>
  checkUnsavedWork: () => Promise<{ hasUnsaved: boolean; count: number; draftTitles: string[] }>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(authService.getStoredUser())
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isSharedDevice, setIsSharedDeviceState] = useState<boolean>(authService.isSharedDevice())

  const setSharedDevice = (enabled: boolean) => {
    authService.setSharedDevice(enabled)
    setIsSharedDeviceState(enabled)
  }

  // The server cookie is the source of truth: ask it who we are. A cached user is only trusted when offline.
  useEffect(() => {
    let isMounted = true

    async function initAuth() {
      try {
        const freshUser = await authService.getMe()
        if (isMounted) {
          setUser(freshUser)
          authService.cacheUser(freshUser)
        }
      } catch (err) {
        if (isMounted && err instanceof ApiError && !err.isNetworkError) {
          // Session expired or revoked: the cached profile must not keep the UI "signed in".
          authService.clearLocalSession()
          setUser(null)
        }
        // Network error: keep showing the cached user so the app stays usable offline.
      }
      if (isMounted) {
        setIsLoading(false)
      }
    }

    initAuth()

    const handleExpired = () => {
      setUser(null)
    }

    window.addEventListener('eduvillage:auth:expired', handleExpired)
    return () => {
      isMounted = false
      window.removeEventListener('eduvillage:auth:expired', handleExpired)
    }
  }, [])

  const login = async (email: string, password: string): Promise<User | LoginOtpChallenge> => {
    const res = await authService.login(email, password)
    if (isOtpChallenge(res)) return res
    setUser(res.user)
    return res.user
  }

  const verifyLoginOtp = async (email: string, otp: string): Promise<User> => {
    const res = await authService.verifyLoginOtp(email, otp)
    setUser(res.user)
    return res.user
  }

  const register = async (
    email: string,
    fullName: string,
    password: string,
    role: Role,
    inviteCode?: string,
    college?: CollegeSelection
  ): Promise<User> => {
    const res = await authService.register(email, fullName, password, role, inviteCode, college)
    setUser(res.user)
    return res.user
  }

  const checkUnsavedWork = async (): Promise<{ hasUnsaved: boolean; count: number; draftTitles: string[] }> => {
    try {
      const drafts = await db.assignmentDrafts
        .filter(d => d.syncStatus === 'pending_sync' || d.syncStatus === 'local_only')
        .toArray()
      return {
        hasUnsaved: drafts.length > 0,
        count: drafts.length,
        draftTitles: drafts.map(d => d.assignmentTitle || 'Assignment Draft'),
      }
    } catch {
      return { hasUnsaved: false, count: 0, draftTitles: [] }
    }
  }

  const logout = async (): Promise<void> => {
    // Revoke the server session first: a cookie left behind on a shared machine must be dead.
    await authService.logout()
    setUser(null)
    // Clear private draft and queue data; on a shared device also the downloads and caches.
    await db.clearPrivateUserData({ includeDownloads: isSharedDevice }).catch(() => {})
  }

  const switchUser = async (): Promise<void> => {
    await logout()
    window.location.href = '/login'
  }

  const refreshUser = async (): Promise<void> => {
    try {
      const freshUser = await authService.getMe()
      setUser(freshUser)
      authService.cacheUser(freshUser)
    } catch {
      // Keep cached user
    }
  }

  const isTeacher = user?.role === 'teacher'
  const isStudent = user?.role === 'student'
  const isAuthenticated = Boolean(user)

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isTeacher,
        isStudent,
        isLoading,
        isSharedDevice,
        setSharedDevice,
        login,
        verifyLoginOtp,
        register,
        logout,
        switchUser,
        checkUnsavedWork,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
