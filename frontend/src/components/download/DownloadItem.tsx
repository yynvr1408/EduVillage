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
import { downloadManager } from '../../services/downloadManager'
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

  useEffect(() => {
    let isMounted = true
    downloadManager.isDownloaded(material.id).then((downloaded) => {
      if (isMounted) setIsDownloaded(downloaded)
    })
    return () => {
      isMounted = false
    }
  }, [material.id])

  const handleDownload = async () => {
    setIsDownloading(true)
    setError(null)
    setDownloadProgress(20)
    try {
      await downloadManager.downloadResource(material, courseTitle, (p) => setDownloadProgress(p))
      setIsDownloaded(true)
      if (onDownloadChange) onDownloadChange()
    } catch (err: any) {
      setError(err.message || 'Download failed')
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
    <div className="p-4 bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
      <div className="flex items-start sm:items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-md bg-[#F5F5F5] border border-[#E5E5E5] flex items-center justify-center shrink-0 text-[#111111]">
          {isAudio ? <Music className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm text-[#111111] truncate">{material.title}</p>
          <div className="flex items-center gap-2 text-[#666666] mt-0.5">
            <span className="uppercase text-[10px] font-mono">{material.file_type}</span>
            <span>•</span>
            <span>{formatBytes(material.file_size)}</span>
            {courseTitle && (
              <>
                <span>•</span>
                <span className="truncate max-w-35">{courseTitle}</span>
              </>
            )}
          </div>
          {error && <p className="text-[11px] text-[#B42318] mt-1">{error}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        {isDownloaded ? (
          <>
            <Badge variant="success" size="sm">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Downloaded
            </Badge>
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
              className="p-2 text-[#666666] hover:text-[#B42318] hover:bg-[#F5F5F5] rounded-md transition-colors"
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
            {isDownloading ? `${downloadProgress}%` : 'Download for Offline'}
          </Button>
        )}
      </div>
    </div>
  )
}
