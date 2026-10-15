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

  const bannerStyle = !isOnline || quality === 'poor'
    ? 'bg-[#FFF0CB] text-[#8A5700] border-[#CBD7D1]'
    : 'bg-[#E8F3FC] text-[#2364AA] border-[#CBD7D1]'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`${bannerStyle} text-xs px-4 py-2 border-b flex items-center justify-between transition-all`}
    >
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="w-4 h-4 text-[#8A5700] shrink-0" />
            <span>
              <strong className="font-semibold">Offline Mode Active.</strong> Changes are saved locally on this device.
            </span>
          </>
        ) : quality === 'poor' ? (
          <>
            <AlertTriangle className="w-4 h-4 text-[#8A5700] shrink-0" />
            <span>
              <strong className="font-semibold">Degraded Network.</strong> Adaptive low-bandwidth protocol enabled.
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4 text-[#247A4D] shrink-0" />
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
            className="underline hover:text-[#123B39] text-[11px] flex items-center gap-1 cursor-pointer font-semibold"
          >
            <RefreshCw className="w-3 h-3" />
            Check Connection
          </button>
        ) : pendingCount > 0 ? (
          <button
            type="button"
            disabled={isSyncing}
            onClick={() => syncNow()}
            className="underline hover:text-[#123B39] text-[11px] flex items-center gap-1 cursor-pointer font-semibold disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
