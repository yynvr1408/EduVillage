import React, { createContext, useContext, useState, useEffect } from 'react'
import type { User, Role } from '../types'
import { authService } from '../services/authService'
import { db } from '../db/db'

interface AuthContextType {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isTeacher: boolean
  isStudent: boolean
  isLoading: boolean
  isSharedDevice: boolean
  setSharedDevice: (enabled: boolean) => void
  login: (email: string, password: string) => Promise<User>
  register: (email: string, fullName: string, password: string, role: Role) => Promise<User>
  logout: () => Promise<void>
  switchUser: () => Promise<void>
  checkUnsavedWork: () => Promise<{ hasUnsaved: boolean; count: number; draftTitles: string[] }>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(authService.getStoredUser())
  const [token, setToken] = useState<string | null>(authService.getToken())
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isSharedDevice, setIsSharedDeviceState] = useState<boolean>(authService.isSharedDevice())

  const setSharedDevice = (enabled: boolean) => {
    authService.setSharedDevice(enabled)
    setIsSharedDeviceState(enabled)
  }

  // Verify stored session on mount
  useEffect(() => {
    let isMounted = true

    async function initAuth() {
      const storedToken = authService.getToken()
      if (storedToken) {
        try {
          const freshUser = await authService.getMe()
          if (isMounted) {
            setUser(freshUser)
            setToken(storedToken)
            const storage = authService.getStorage()
            storage.setItem('eduvillage_user', JSON.stringify(freshUser))
          }
        } catch {
          // If offline or failed, fallback to stored user
          const cachedUser = authService.getStoredUser()
          if (isMounted && cachedUser) {
            setUser(cachedUser)
          }
        }
      }
      if (isMounted) {
        setIsLoading(false)
      }
    }

    initAuth()

    const handleExpired = () => {
      setUser(null)
      setToken(null)
    }

    window.addEventListener('eduvillage:auth:expired', handleExpired)
    return () => {
      isMounted = false
      window.removeEventListener('eduvillage:auth:expired', handleExpired)
    }
  }, [])

  const login = async (email: string, password: string): Promise<User> => {
    const res = await authService.login(email, password)
    setUser(res.user)
    setToken(res.access_token)
    return res.user
  }

  const register = async (
    email: string,
    fullName: string,
    password: string,
    role: Role
  ): Promise<User> => {
    const res = await authService.register(email, fullName, password, role)
    setUser(res.user)
    setToken(res.access_token)
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
    authService.logout()
    setUser(null)
    setToken(null)
    // Clear private draft and queue data on shared device
    await db.clearPrivateUserData().catch(() => {})
  }

  const switchUser = async (): Promise<void> => {
    await logout()
    window.location.href = '/login'
  }

  const refreshUser = async (): Promise<void> => {
    try {
      const freshUser = await authService.getMe()
      setUser(freshUser)
      const storage = authService.getStorage()
      storage.setItem('eduvillage_user', JSON.stringify(freshUser))
    } catch {
      // Keep cached user
    }
  }

  const isTeacher = user?.role === 'teacher'
  const isStudent = user?.role === 'student'
  const isAuthenticated = Boolean(user && token)

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated,
        isTeacher,
        isStudent,
        isLoading,
        isSharedDevice,
        setSharedDevice,
        login,
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
