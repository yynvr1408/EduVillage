import React, { useState, useEffect } from 'react'
import { DownloadCloud, Trash2, ExternalLink, HardDrive, FileText, Music } from 'lucide-react'
import { downloadManager } from '../../services/downloadManager'
import type { DownloadedResource } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { StorageMeter } from '../../components/download/StorageMeter'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'

export const StudentDownloadsPage: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadedResource[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadDownloads = async () => {
    setIsLoading(true)
    try {
      const items = await downloadManager.getAllDownloads()
      setDownloads(items)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDownloads()
  }, [])

  const handleDelete = async (id: string) => {
    await downloadManager.deleteDownload(id)
    loadDownloads()
  }

  const handleOpenOffline = async (id: string) => {
    const url = await downloadManager.getResourceBlobUrl(id)
    if (url) {
      window.open(url, '_blank')
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  return (
    <PageContainer
      title="Offline Learning Downloads"
      subtitle="Study materials saved to your browser's IndexedDB database. Fully readable without an internet connection."
    >
      <div className="mb-6">
        <StorageMeter />
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-[#111111] flex items-center gap-2">
          <DownloadCloud className="w-4 h-4" /> Downloaded Files ({downloads.length})
        </h2>
      </div>

      {downloads.length === 0 ? (
        <EmptyState
          icon={<DownloadCloud className="w-6 h-6" />}
          title="No resources downloaded yet"
          description="Browse your course modules to download PDFs, formula guides, and audio lectures for offline learning."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {downloads.map((item) => {
            const isAudio = item.fileType === 'audio' || item.fileType === 'mp3'
            return (
              <div
                key={item.id}
                className="p-4 bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-md bg-[#F5F5F5] border border-[#E5E5E5] flex items-center justify-center shrink-0 text-[#111111]">
                    {isAudio ? <Music className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[#111111] truncate">{item.title}</p>
                    <div className="flex items-center gap-2 text-[#666666] mt-0.5">
                      <span className="uppercase text-[10px] font-mono">{item.fileType}</span>
                      <span>•</span>
                      <span>{formatBytes(item.sizeBytes)}</span>
                      <span>•</span>
                      <span>Saved: {new Date(item.downloadedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenOffline(item.id)}
                    icon={<ExternalLink className="w-3.5 h-3.5" />}
                  >
                    Open Resource
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="p-2 text-[#666666] hover:text-[#B42318] hover:bg-[#F5F5F5] rounded-md transition-colors"
                    title="Remove download"
                    aria-label="Remove download"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PageContainer>
  )
}
