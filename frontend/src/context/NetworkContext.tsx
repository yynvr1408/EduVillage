import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { NetworkQuality } from '../types'
import { syncManager } from '../services/syncManager'

interface NetworkContextType {
  isOnline: boolean
  isServerReachable: boolean
  quality: NetworkQuality
  latencyMs: number
  checkReachability: () => Promise<boolean>
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined)

const HEALTH_URL = `${(import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')}/health`

export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [isServerReachable, setIsServerReachable] = useState<boolean>(true)
  const [latencyMs, setLatencyMs] = useState<number>(50)
  const wasOfflineRef = useRef<boolean>(false)

  const checkReachability = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsServerReachable(false)
      return false
    }

    const start = performance.now()
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 4000)

      const response = await fetch(HEALTH_URL, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const duration = Math.round(performance.now() - start)
      setLatencyMs(duration)

      if (response.ok) {
        setIsServerReachable(true)
        // If we were previously offline, trigger auto-sync!
        if (wasOfflineRef.current) {
          wasOfflineRef.current = false
          syncManager.processQueue().catch(() => {})
        }
        return true
      } else {
        setIsServerReachable(false)
        wasOfflineRef.current = true
        return false
      }
    } catch {
      setIsServerReachable(false)
      wasOfflineRef.current = true
      return false
    }
  }, [])

  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOnline(true)
      checkReachability()
    }

    const handleOffline = () => {
      setIsBrowserOnline(false)
      setIsServerReachable(false)
      wasOfflineRef.current = true
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Initial check
    checkReachability()

    // Regular heartbeat interval (every 15 seconds)
    const intervalId = setInterval(checkReachability, 15000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(intervalId)
    }
  }, [checkReachability])

  const effectiveOnline = isBrowserOnline && isServerReachable

  // Determine network quality tier
  let quality: NetworkQuality = 'offline'
  if (effectiveOnline) {
    if (latencyMs < 120) quality = 'excellent'
    else if (latencyMs < 450) quality = 'good'
    else quality = 'poor'
  }

  return (
    <NetworkContext.Provider
      value={{
        isOnline: effectiveOnline,
        isServerReachable,
        quality,
        latencyMs,
        checkReachability,
      }}
    >
      {children}
    </NetworkContext.Provider>
  )
}

export function useNetworkStatus(): NetworkContextType {
  const context = useContext(NetworkContext)
  if (!context) {
    throw new Error('useNetworkStatus must be used within a NetworkProvider')
  }
  return context
}
