import React, { useState, useEffect } from 'react'
import {
  FileText,
  Music,
  Download,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import type { Material } from '../../types'
import { downloadManager, type OfflineStatus } from '../../services/downloadManager'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

export interface DownloadItemProps {
  material: Material
  courseTitle?: string
  onDownloadChange?: () => void
}

export const DownloadItem: React.FC<DownloadItemProps> = ({
  material,
  courseTitle,
  onDownloadChange,
}) => {
  const [isDownloaded, setIsDownloaded] = useState<boolean>(false)
  const [isDownloading, setIsDownloading] = useState<boolean>(false)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<OfflineStatus>({ state: 'not_downloaded', percent: 0 })

  useEffect(() => {
    let isMounted = true
    downloadManager.getResourceStatus(material.id, material.version).then((st) => {
      if (!isMounted) return
      setStatus(st)
      setIsDownloaded(st.state === 'available_offline' || st.state === 'update_available')
      if (st.state === 'paused' || st.state === 'failed') setDownloadProgress(st.percent)
      if (st.state === 'failed' && st.error) setError(st.error)
    })
    return () => {
      isMounted = false
    }
  }, [material.id, material.version])

  const handleDownload = async () => {
    setIsDownloading(true)
    setError(null)
    try {
      await downloadManager.downloadResource(material, courseTitle, (p) => setDownloadProgress(p), { force: status.state === 'update_available' })
      setIsDownloaded(true)
      setStatus({ state: 'available_offline', percent: 100 })
      if (onDownloadChange) onDownloadChange()
    } catch (err: any) {
      if (err?.code === 'ABORTED') {
        setStatus({ state: 'paused', percent: downloadProgress })
      } else {
        setError(err.message || 'Download failed')
        setStatus({ state: err?.code === 'UNAVAILABLE' ? 'not_downloaded' : 'failed', percent: downloadProgress })
      }
    } finally {
      setIsDownloading(false)
    }
  }

  const handleDelete = async () => {
    try {
      await downloadManager.deleteDownload(material.id)
      setIsDownloaded(false)
      if (onDownloadChange) onDownloadChange()
    } catch (err: any) {
      setError(err.message || 'Failed to remove file')
    }
  }

  const handleOpenOffline = async () => {
    const url = await downloadManager.getResourceBlobUrl(material.id)
    if (url) {
      window.open(url, '_blank')
    } else {
      setError('Resource not found in local storage')
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  const isAudio = material.file_type === 'audio' || material.file_type === 'mp3'

  return (
    <div className="p-4 bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs">
      <div className="flex items-start sm:items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-[#DDF3EA] border border-[#CBD7D1] flex items-center justify-center shrink-0 text-[#0F5B57]">
          {isAudio ? <Music className="w-4 h-4 text-[#2364AA]" /> : <FileText className="w-4 h-4 text-[#0F5B57]" />}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm text-[#202B2A] truncate">{material.title}</p>
          <div className="flex items-center gap-2 text-[#687775] mt-0.5">
            <span className="uppercase text-xs font-mono font-semibold">{material.file_type}</span>
            <span>•</span>
            <span>{formatBytes(material.file_size)}</span>
            {courseTitle && (
              <>
                <span>•</span>
                <span className="truncate max-w-35">{courseTitle}</span>
              </>
            )}
          </div>
          {error && <p className="text-xs text-[#B42318] mt-1">{error}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        {isDownloading && (
          <Button size="sm" variant="outline" onClick={() => downloadManager.pauseResourceDownload(material.id)}>
            Pause
          </Button>
        )}
        {isDownloaded ? (
          <>
            {status.state === 'update_available' ? (
              <Badge variant="warning" size="sm">
                Update available
              </Badge>
            ) : (
              <Badge variant="success" size="sm">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Available offline
              </Badge>
            )}
            {status.state === 'update_available' && (
              <Button size="sm" variant="secondary" isLoading={isDownloading} onClick={handleDownload}>
                Update
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleOpenOffline}
              icon={<ExternalLink className="w-3.5 h-3.5" />}
            >
              Open Offline
            </Button>
            <button
              type="button"
              onClick={handleDelete}
              className="p-2 text-[#687775] hover:text-[#B42318] hover:bg-[#FDE8E7] rounded-lg transition-colors cursor-pointer"
              title="Delete from local storage"
              aria-label="Delete from local storage"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            isLoading={isDownloading}
            onClick={handleDownload}
            icon={<Download className="w-3.5 h-3.5" />}
          >
            {isDownloading
              ? `${downloadProgress}%`
              : status.state === 'paused'
              ? `Resume ${downloadProgress}%`
              : status.state === 'failed'
              ? 'Retry'
              : 'Download for Offline'}
          </Button>
        )}
      </div>
    </div>
  )
}
