import React, { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  FileText,
  Sparkles,
  Info,
  Calendar,
  Clock,
  User as UserIcon,
  HardDrive,
  Download,
  CheckCircle,
} from 'lucide-react'
import { api } from '../../services/apiClient'
import { downloadManager } from '../../services/downloadManager'
import { useAuth } from '../../context/AuthContext'
import { RecordedLecturePlayer } from '../../components/recording/RecordedLecturePlayer'
import { SummaryViewer } from '../../components/summary/SummaryViewer'
import { Button, Badge, LoadingState, ErrorState } from '../../components/ui'
import type { Recording } from '../../types'

export const StudentRecordedLessonDetailPage: React.FC = () => {
  const { recordingId } = useParams<{ recordingId: string }>()
  const { user } = useAuth()
  const backLink = user?.role === 'teacher' ? '/teacher/recorded-lessons' : '/student/recorded-lessons'
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary' | 'details'>('transcript')
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const {
    data: recording,
    isLoading,
    error,
    refetch,
  } = useQuery<Recording>({
    queryKey: ['recording', recordingId],
    queryFn: () => api.getRecording(recordingId!),
    enabled: Boolean(recordingId),
  })

  // Check offline download status
  React.useEffect(() => {
    if (!recordingId) return
    downloadManager.isRecordingDownloaded(recordingId).then(setIsDownloaded)
  }, [recordingId])

  const handleDownload = async () => {
    if (!recording) return
    try {
      setIsDownloading(true)
      await downloadManager.downloadRecording(recording)
      setIsDownloaded(true)
    } catch (err: any) {
      alert(err.message || 'Download failed')
    } finally {
      setIsDownloading(false)
    }
  }

  if (isLoading) {
    return <LoadingState message="Loading lecture recording..." />
  }

  if (error || !recording) {
    return (
      <ErrorState
        title="Lecture Recording Not Found"
        message="Unable to locate the requested lecture recording. It may have been archived or access is restricted."
        actionLabel="Back to Recorded Lessons"
        onAction={() => window.history.back()}
      />
    )
  }

  const hasTranscript = Boolean(recording.transcript && recording.transcript.trim().length > 0)
  const hasSummary = Boolean(recording.summary)

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Top Navigation Breadcrumb */}
      <div className="flex items-center justify-between gap-2 border-b border-[#E5E5E5] pb-3">
        <Link
          to={backLink}
          className="inline-flex items-center text-xs sm:text-sm font-medium text-[#666666] hover:text-[#111111] transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          Back to Recorded Lessons
        </Link>

        <div className="flex items-center space-x-2">
          {isDownloaded ? (
            <Badge variant="success" className="text-xs">
              <CheckCircle className="w-3.5 h-3.5 mr-1" /> Downloaded
            </Badge>
          ) : recording.status === 'READY' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              className="text-xs h-8"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              {isDownloading ? 'Saving...' : `Download (${Math.round(recording.file_size_bytes / (1024 * 1024))} MB)`}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Main Two-Column Layout (Desktop) / Single-Column Stack (Mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Player & Lecture Overview (8 Cols on Desktop) */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-4">
          <RecordedLecturePlayer
            recording={recording}
            initialPositionSeconds={recording.user_progress_seconds || 0}
          />

          {/* Lecture Metadata Card */}
          <div className="bg-[#FFFFFF] p-4 sm:p-5 border border-[#E5E5E5] rounded-sm space-y-3">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span className="text-xs font-mono font-semibold text-[#111111] bg-[#F5F5F5] px-2 py-0.5 rounded border border-[#E5E5E5]">
                {recording.course_code || 'Course'}
              </span>
              <span className="text-xs text-[#666666]">{recording.course_title}</span>
            </div>

            <h1 className="text-lg sm:text-xl font-bold text-[#111111] leading-tight">
              {recording.title}
            </h1>

            {recording.description && (
              <p className="text-xs sm:text-sm text-[#666666] leading-relaxed">
                {recording.description}
              </p>
            )}

            <div className="pt-2 border-t border-[#E5E5E5] flex flex-wrap items-center gap-4 text-xs text-[#666666]">
              <span className="flex items-center">
                <UserIcon className="w-3.5 h-3.5 mr-1 text-[#111111]" />
                Instructor: <strong className="text-[#111111] ml-1">{recording.teacher_name}</strong>
              </span>
              <span className="flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1" />
                Duration: {Math.round(recording.duration_seconds / 60)} minutes
              </span>
              <span className="flex items-center">
                <Calendar className="w-3.5 h-3.5 mr-1" />
                Recorded: {new Date(recording.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Tabbed Panel (Transcript / Summary / Details) (5 Cols on Desktop) */}
        <div className="lg:col-span-5 xl:col-span-4 bg-[#FFFFFF] border border-[#E5E5E5] rounded-sm overflow-hidden flex flex-col">
          {/* Tab Selector */}
          <div className="flex border-b border-[#E5E5E5] bg-[#F5F5F5] text-xs font-medium">
            {hasTranscript && (
              <button
                onClick={() => setActiveTab('transcript')}
                className={`flex-1 py-2.5 px-3 flex items-center justify-center space-x-1.5 border-b-2 transition-colors ${
                  activeTab === 'transcript'
                    ? 'border-[#111111] text-[#111111] bg-[#FFFFFF] font-semibold'
                    : 'border-transparent text-[#666666] hover:text-[#111111]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Transcript</span>
              </button>
            )}

            {hasSummary && (
              <button
                onClick={() => setActiveTab('summary')}
                className={`flex-1 py-2.5 px-3 flex items-center justify-center space-x-1.5 border-b-2 transition-colors ${
                  activeTab === 'summary'
                    ? 'border-[#111111] text-[#111111] bg-[#FFFFFF] font-semibold'
                    : 'border-transparent text-[#666666] hover:text-[#111111]'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Summary</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('details')}
              className={`flex-1 py-2.5 px-3 flex items-center justify-center space-x-1.5 border-b-2 transition-colors ${
                activeTab === 'details'
                  ? 'border-[#111111] text-[#111111] bg-[#FFFFFF] font-semibold'
                  : 'border-transparent text-[#666666] hover:text-[#111111]'
              }`}
            >
              <Info className="w-3.5 h-3.5" />
              <span>Details</span>
            </button>
          </div>

          {/* Tab Content Body */}
          <div className="p-4 sm:p-5 max-h-150 overflow-y-auto space-y-4">
            {/* Tab 1: Transcript */}
            {activeTab === 'transcript' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                    Lecture Transcript
                  </h3>
                  <span className="text-[11px] text-[#666666]">Automated verbatim log</span>
                </div>

                {hasTranscript ? (
                  <div className="text-xs sm:text-sm text-[#333333] leading-relaxed space-y-3 font-sans whitespace-pre-line bg-[#F5F5F5]/50 p-3.5 rounded border border-[#E5E5E5]">
                    {recording.transcript}
                  </div>
                ) : (
                  <p className="text-xs text-[#666666] italic">No transcript available for this lecture.</p>
                )}
              </div>
            )}

            {/* Tab 2: AI Summary */}
            {activeTab === 'summary' && (
              <div className="space-y-3">
                {recording.summary ? (
                  <SummaryViewer summary={recording.summary} />
                ) : (
                  <p className="text-xs text-[#666666] italic">No AI summary generated for this lecture.</p>
                )}
              </div>
            )}

            {/* Tab 3: Lecture Details & Offline Access */}
            {activeTab === 'details' && (
              <div className="space-y-4 text-xs text-[#666666]">
                <div>
                  <h4 className="font-semibold text-[#111111] text-xs uppercase tracking-wider mb-2">
                    Learning Recovery
                  </h4>
                  <p className="leading-relaxed">
                    This recorded lecture is provided for students who could not attend the live synchronous session or who wish to review complex mathematical and engineering procedures.
                  </p>
                </div>

                <div className="p-3 bg-[#F5F5F5] rounded border border-[#E5E5E5] space-y-2">
                  <div className="flex justify-between">
                    <span>Media File Size:</span>
                    <strong className="text-[#111111]">
                      {Math.round(recording.file_size_bytes / (1024 * 1024))} MB
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Offline Status:</span>
                    <strong className={isDownloaded ? 'text-[#166534]' : 'text-[#666666]'}>
                      {isDownloaded ? 'Available Locally in IndexedDB' : 'Network Stream Only'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Authorized Cohorts:</span>
                    <strong className="text-[#111111]">
                      {recording.section_ids?.length || 0} Sections
                    </strong>
                  </div>
                </div>

                {!isDownloaded && recording.status === 'READY' && (
                  <Button
                    variant="primary"
                    className="w-full text-xs"
                    onClick={handleDownload}
                    disabled={isDownloading}
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    {isDownloading ? 'Saving to Device...' : 'Download for Offline Study'}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
