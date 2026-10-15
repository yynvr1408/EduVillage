import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { SyncOperation } from '../types'
import { syncManager, type SyncResult } from '../services/syncManager'
import { useNetworkStatus } from './NetworkContext'

interface SyncContextType {
  pendingCount: number
  isSyncing: boolean
  lastSyncTime: Date | null
  lastResult: SyncResult | null
  operations: SyncOperation[]
  syncNow: () => Promise<SyncResult>
  refreshQueue: () => Promise<void>
}

const SyncContext = createContext<SyncContextType | undefined>(undefined)

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isOnline } = useNetworkStatus()
  const [pendingCount, setPendingCount] = useState<number>(0)
  const [isSyncing, setIsSyncing] = useState<boolean>(false)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)
  const [operations, setOperations] = useState<SyncOperation[]>([])

  const refreshQueue = useCallback(async () => {
    try {
      const count = await syncManager.getPendingCount()
      setPendingCount(count)
      const allOps = await syncManager.getAllOperations()
      setOperations(allOps)
    } catch {
      // Ignore
    }
  }, [])

  useEffect(() => {
    refreshQueue()
    const interval = setInterval(refreshQueue, 5000)
    return () => clearInterval(interval)
  }, [refreshQueue])

  const syncNow = async (): Promise<SyncResult> => {
    if (isSyncing) {
      return { successful: 0, failed: 0, remaining: pendingCount }
    }

    setIsSyncing(true)
    try {
      const result = await syncManager.processQueue()
      setLastResult(result)
      setLastSyncTime(new Date())
      await refreshQueue()
      return result
    } finally {
      setIsSyncing(false)
    }
  }

  // Attempt sync when connectivity returns and we have items
  useEffect(() => {
    if (isOnline && pendingCount > 0 && !isSyncing) {
      syncNow()
    }
  }, [isOnline, pendingCount])

  return (
    <SyncContext.Provider
      value={{
        pendingCount,
        isSyncing,
        lastSyncTime,
        lastResult,
        operations,
        syncNow,
        refreshQueue,
      }}
    >
      {children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncContextType {
  const context = useContext(SyncContext)
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider')
  }
  return context
}
