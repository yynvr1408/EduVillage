import React from 'react'
import { WifiOff, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useNetworkStatus } from '../../context/NetworkContext'
import { useSync } from '../../context/SyncContext'

export const OfflineIndicator: React.FC = () => {
  const { isOnline, checkReachability, quality } = useNetworkStatus()
  const { pendingCount, isSyncing, syncNow } = useSync()

  if (isOnline && pendingCount === 0 && quality !== 'poor') {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-[#111111] text-[#FFFFFF] text-xs px-4 py-2 border-b border-[#333333] flex items-center justify-between transition-all"
    >
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="w-4 h-4 text-[#F5F5F5] shrink-0" />
            <span>
              <strong className="font-semibold">Offline Mode Active.</strong> Changes are saved locally on this device.
            </span>
          </>
        ) : quality === 'poor' ? (
          <>
            <AlertTriangle className="w-4 h-4 text-[#854D0E] shrink-0" />
            <span>
              <strong className="font-semibold">Degraded Network.</strong> Adaptive low-bandwidth protocol enabled.
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4 text-[#166534] shrink-0" />
            <span>
              Online. <strong className="font-semibold">{pendingCount}</strong> item{pendingCount > 1 ? 's' : ''} waiting to sync.
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 ml-4">
        {!isOnline ? (
          <button
            type="button"
            onClick={() => checkReachability()}
            className="underline hover:text-[#CCCCCC] text-[11px] flex items-center gap-1 cursor-pointer font-medium"
          >
            <RefreshCw className="w-3 h-3" />
            Check Connection
          </button>
        ) : pendingCount > 0 ? (
          <button
            type="button"
            disabled={isSyncing}
            onClick={() => syncNow()}
            className="underline hover:text-[#CCCCCC] text-[11px] flex items-center gap-1 cursor-pointer font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
