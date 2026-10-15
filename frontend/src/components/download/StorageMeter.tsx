import React, { useState, useEffect } from 'react'
import { HardDrive, RefreshCw } from 'lucide-react'
import { downloadManager, type StorageEstimateInfo } from '../../services/downloadManager'

export const StorageMeter: React.FC = () => {
  const [storage, setStorage] = useState<StorageEstimateInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const loadEstimate = async () => {
    setLoading(true)
    const est = await downloadManager.getStorageEstimate()
    setStorage(est)
    setLoading(false)
  }

  useEffect(() => {
    loadEstimate()
  }, [])

  if (!storage) return null
  if (!storage.supported) {
    return (
      <div className="p-4 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg text-xs text-[#666666]">
        This browser can't report device storage, so free space is unknown.
      </div>
    )
  }

  const usedMB = Math.round(storage.usageBytes / (1024 * 1024))

  return (
    <div className="p-4 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg flex flex-col gap-2.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 font-semibold text-[#111111]">
          <HardDrive className="w-4 h-4" />
          <span>Local Device Storage Allocation</span>
        </div>
        <button
          type="button"
          onClick={loadEstimate}
          className="text-[#666666] hover:text-[#111111] p-1"
          title="Refresh storage calculation"
          aria-label="Refresh storage calculation"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="w-full bg-[#E5E5E5] h-2 rounded-full overflow-hidden">
        <div
          className="bg-[#111111] h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.min(storage.percentageUsed || 2, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-[#666666]">
        <span>Used by EduVillage: {usedMB} MB</span>
        <span>Available on Device: ~{storage.availableMB} MB</span>
      </div>
    </div>
  )
}
