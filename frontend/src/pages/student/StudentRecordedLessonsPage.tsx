import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Video,
  Play,
  Download,
  CheckCircle,
  FileText,
  Sparkles,
  Clock,
  Search,
  Filter,
  HardDrive,
} from 'lucide-react'
import { api } from '../../services/apiClient'
import { downloadManager } from '../../services/downloadManager'
import {
  Card,
  Badge,
  Button,
  Input,
  LoadingState,
  ErrorState,
  EmptyState,
} from '../../components/ui'
import type { Recording } from '../../types'

function formatMinutes(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return `${mins} min${mins === 1 ? '' : 's'}`
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export const StudentRecordedLessonsPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'ready' | 'downloaded'>('all')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set())

  const { data: recordings, isLoading, error, refetch } = useQuery<Recording[]>({
    queryKey: ['recordings'],
    queryFn: () => api.getRecordings(),
  })

  // Check which recordings are already in IndexedDB
  React.useEffect(() => {
    async function checkDownloaded() {
      if (!recordings) return
      const set = new Set<string>()
      for (const r of recordings) {
        const isDown = await downloadManager.isRecordingDownloaded(r.id)
        if (isDown) set.add(r.id)
      }
      setDownloadedIds(set)
    }
    checkDownloaded()
  }, [recordings])

  const handleDownload = async (recording: Recording, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      setDownloadingId(recording.id)
      await downloadManager.downloadRecording(recording)
      setDownloadedIds((prev) => new Set([...prev, recording.id]))
    } catch (err: any) {
      alert(err.message || 'Failed to download recording')
    } finally {
      setDownloadingId(null)
    }
  }

  const filteredRecordings = (recordings || []).filter((r) => {
    const matchesSearch =
      r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.course_title && r.course_title.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (r.course_code && r.course_code.toLowerCase().includes(searchTerm.toLowerCase()))

    if (!matchesSearch) return false

    if (filterMode === 'ready') return r.status === 'READY'
    if (filterMode === 'downloaded') return downloadedIds.has(r.id)
    return true
  })

  return (
    <div className="w-full max-w-[110rem] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-20 lg:pb-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#E1E8E4] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#202B2A]">
            Recorded Lessons Library
          </h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-0.5">
            Watch missed lectures, review full transcripts, and download recordings for offline study.
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative w-full sm:flex-1 sm:max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#687775]" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by lecture title or course..."
            className="pl-9 h-9 text-xs sm:text-sm"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
              filterMode === 'all'
                ? 'bg-[#0F5B57] text-[#FFFFFF] border-[#0F5B57]'
                : 'bg-[#FFFFFF] text-[#687775] border-[#CBD7D1] hover:bg-[#DDF3EA] hover:text-[#0F5B57]'
            }`}
          >
            All Lessons ({recordings?.length || 0})
          </button>
          <button
            onClick={() => setFilterMode('ready')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
              filterMode === 'ready'
                ? 'bg-[#0F5B57] text-[#FFFFFF] border-[#0F5B57]'
                : 'bg-[#FFFFFF] text-[#687775] border-[#CBD7D1] hover:bg-[#DDF3EA] hover:text-[#0F5B57]'
            }`}
          >
            Ready to Play
          </button>
          <button
            onClick={() => setFilterMode('downloaded')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
              filterMode === 'downloaded'
                ? 'bg-[#0F5B57] text-[#FFFFFF] border-[#0F5B57]'
                : 'bg-[#FFFFFF] text-[#687775] border-[#CBD7D1] hover:bg-[#DDF3EA] hover:text-[#0F5B57]'
            }`}
          >
            Downloaded ({downloadedIds.size})
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingState message="Loading authorized recorded lessons..." />
      ) : error ? (
        <ErrorState
          title="Could Not Load Recordings"
          message="Unable to fetch lecture recordings from the server. Check connectivity or retry."
          onRetry={() => refetch()}
        />
      ) : filteredRecordings.length === 0 ? (
        <EmptyState
          icon={<Video className="w-10 h-10 text-[#0F5B57]" />}
          title={searchTerm ? 'No matching recorded lessons' : 'No recorded lessons available'}
          description={
            searchTerm
              ? 'Try modifying your search keywords or clear filters.'
              : 'Lectures conducted by your instructors will appear here after class sessions conclude.'
          }
          actionLabel={searchTerm ? 'Clear Search' : undefined}
          onAction={searchTerm ? () => setSearchTerm('') : undefined}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))] gap-4">
          {filteredRecordings.map((recording) => {
            const isDown = downloadedIds.has(recording.id)
            const isProcessing = recording.status === 'PROCESSING'
            const hasProgress = (recording.user_progress_seconds || 0) > 0

            return (
              <Card
                key={recording.id}
                className="flex flex-col justify-between hover:border-[#CBD7D1] transition-colors p-4 sm:p-5"
              >
                <div className="space-y-3">
                  {/* Top metadata tags */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                      <span className="text-xs font-mono text-[#687775] uppercase bg-[#F1F5F2] px-2 py-0.5 rounded border border-[#CBD7D1]">
                        {recording.course_code || 'Course'}
                      </span>
                      {isProcessing ? (
                        <Badge variant="warning" className="text-xs">
                          <Clock className="w-2.5 h-2.5 mr-1" /> Processing
                        </Badge>
                      ) : isDown ? (
                        <Badge variant="success" className="text-xs">
                          <HardDrive className="w-2.5 h-2.5 mr-1" /> Saved Offline
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          Ready
                        </Badge>
                      )}
                    </div>

                    <span className="text-xs text-[#687775] font-medium flex items-center">
                      <Clock className="w-3 h-3 mr-1 text-[#687775]" />
                      {formatMinutes(recording.duration_seconds)}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h2 className="text-base font-semibold text-[#202B2A] line-clamp-2">
                      {recording.title}
                    </h2>
                    {recording.description && (
                      <p className="text-xs text-[#687775] line-clamp-2 mt-1 leading-relaxed">
                        {recording.description}
                      </p>
                    )}
                  </div>

                  {/* Feature badges (Transcript, Summary, Resumed) */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                    {recording.has_transcript && (
                      <span className="inline-flex items-center text-xs text-[#687775] bg-[#F1F5F2] px-2 py-0.5 rounded border border-[#CBD7D1]">
                        <FileText className="w-3 h-3 mr-1 text-[#2364AA]" /> Transcript
                      </span>
                    )}
                    {recording.has_summary && (
                      <span className="inline-flex items-center text-xs text-[#687775] bg-[#F1F5F2] px-2 py-0.5 rounded border border-[#CBD7D1]">
                        <Sparkles className="w-3 h-3 mr-1 text-[#0F5B57]" /> AI Summary
                      </span>
                    )}
                    {hasProgress && !recording.user_completed && (
                      <span className="inline-flex items-center text-xs text-[#8A5700] bg-[#FFF0CB] px-2 py-0.5 rounded border border-[#CBD7D1]">
                        Resume at {formatDuration(recording.user_progress_seconds!)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions bottom row */}
                <div className="pt-4 mt-4 border-t border-[#E1E8E4] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                  <div className="text-xs text-[#687775]">
                    Instructor: <span className="text-[#202B2A] font-medium">{recording.teacher_name}</span>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    {/* Download button */}
                    {!isProcessing && !isDown && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => handleDownload(recording, e)}
                        disabled={downloadingId === recording.id}
                        className="text-xs h-10 sm:h-8 px-2.5 flex-1 sm:flex-none"
                        icon={<Download className="w-3.5 h-3.5" />}
                        title={`Download for offline study (~${Math.round(recording.file_size_bytes / (1024 * 1024))} MB)`}
                      >
                        {downloadingId === recording.id ? 'Saving...' : 'Download'}
                      </Button>
                    )}

                    {/* Watch Button */}
                    <Link to={`/student/recorded-lessons/${recording.id}`} className="flex-1 sm:flex-none">
                      <Button size="sm" className="text-xs h-10 sm:h-8 px-3 w-full sm:w-auto" icon={<Play className="w-3.5 h-3.5" />}>
                        {hasProgress ? 'Resume' : 'Watch'}
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
