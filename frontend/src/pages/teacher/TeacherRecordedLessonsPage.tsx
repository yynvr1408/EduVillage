import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Video,
  Play,
  Share2,
  Eye,
  EyeOff,
  Clock,
  CheckCircle,
  AlertCircle,
  Users,
  Search,
  Filter,
  RefreshCw,
  FileText,
  Sparkles,
} from 'lucide-react'
import { api } from '../../services/apiClient'
import {
  Card,
  Badge,
  Button,
  Input,
  Dialog,
  LoadingState,
  ErrorState,
  EmptyState,
} from '../../components/ui'
import type { Recording, Section } from '../../types'

export const TeacherRecordedLessonsPage: React.FC = () => {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [reuseModalRecording, setReuseModalRecording] = useState<Recording | null>(null)
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([])

  const {
    data: recordings,
    isLoading: recordingsLoading,
    error: recordingsError,
    refetch,
  } = useQuery<Recording[]>({
    queryKey: ['teacher-recordings'],
    queryFn: () => api.getRecordings(),
  })

  const { data: sections } = useQuery<Section[]>({
    queryKey: ['sections', reuseModalRecording?.course_id],
    queryFn: () => api.getSections(reuseModalRecording?.course_id),
    enabled: Boolean(reuseModalRecording),
  })

  // Mutation: Reuse recording in sections
  const reuseMutation = useMutation({
    mutationFn: ({ recordingId, targetSectionIds }: { recordingId: string; targetSectionIds: string[] }) =>
      api.reuseRecording(recordingId, targetSectionIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-recordings'] })
      setReuseModalRecording(null)
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to update section associations')
    },
  })

  // Mutation: Toggle publish status
  const togglePublishMutation = useMutation({
    mutationFn: (recordingId: string) => api.togglePublishRecording(recordingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-recordings'] })
    },
  })

  const handleOpenReuseModal = (recording: Recording) => {
    setReuseModalRecording(recording)
    setSelectedSectionIds(recording.section_ids || [])
  }

  const handleToggleSection = (sectionId: string) => {
    setSelectedSectionIds((prev) =>
      prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId]
    )
  }

  const handleConfirmReuse = () => {
    if (!reuseModalRecording) return
    reuseMutation.mutate({
      recordingId: reuseModalRecording.id,
      targetSectionIds: selectedSectionIds,
    })
  }

  const filteredRecordings = (recordings || []).filter((r) =>
    r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (r.course_title && r.course_title.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#E1E8E4] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#202B2A]">
            Recorded Lessons & Resource Sharing
          </h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-0.5">
            Manage captured lectures, monitor transcript processing, and reuse recordings across multi-section student cohorts.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-md relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#687775]" />
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter recordings by title or subject..."
          className="pl-9 h-9 text-xs sm:text-sm"
        />
      </div>

      {/* List */}
      {recordingsLoading ? (
        <LoadingState message="Loading teaching recordings..." />
      ) : recordingsError ? (
        <ErrorState
          title="Could Not Load Recordings"
          message="Failed to load your course recordings from the backend."
          onRetry={() => refetch()}
        />
      ) : filteredRecordings.length === 0 ? (
        <EmptyState
          icon={<Video className="w-10 h-10 text-[#0F5B57]" />}
          title="No recordings in library"
          description="Lectures conducted in LiveKit classrooms will automatically appear here once sessions conclude."
        />
      ) : (
        <div className="space-y-4">
          {filteredRecordings.map((recording) => {
            const isProcessing = recording.status === 'PROCESSING'

            return (
              <Card key={recording.id} className="p-4 sm:p-5 border border-[#E1E8E4]">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  {/* Left Info */}
                  <div className="space-y-2 max-w-2xl">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="text-xs font-mono text-[#687775] uppercase bg-[#F1F5F2] px-2 py-0.5 rounded border border-[#CBD7D1]">
                        {recording.course_code || 'Course'}
                      </span>
                      {isProcessing ? (
                        <Badge variant="warning" className="text-xs">
                          <Clock className="w-2.5 h-2.5 mr-1" /> Processing
                        </Badge>
                      ) : recording.is_published ? (
                        <Badge variant="success" className="text-xs">
                          Published
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          Draft / Private
                        </Badge>
                      )}

                      <span className="text-xs text-[#687775]">
                        {Math.round(recording.duration_seconds / 60)} mins
                      </span>
                    </div>

                    <h2 className="text-base sm:text-lg font-semibold text-[#202B2A]">
                      {recording.title}
                    </h2>

                    {recording.description && (
                      <p className="text-xs text-[#687775] line-clamp-2 leading-relaxed">
                        {recording.description}
                      </p>
                    )}

                    {/* Shared Sections pill list */}
                    <div className="flex items-center space-x-2 text-xs text-[#687775] pt-1">
                      <Users className="w-3.5 h-3.5 text-[#0F5B57]" />
                      <span>Authorized Cohorts:</span>
                      <div className="flex items-center space-x-1 flex-wrap">
                        {recording.section_ids && recording.section_ids.length > 0 ? (
                          recording.section_ids.map((secId) => (
                            <span
                              key={secId}
                              className="text-xs font-mono bg-[#F1F5F2] px-1.5 py-0.5 rounded border border-[#CBD7D1] text-[#202B2A]"
                            >
                              {secId}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-[#8A5700] italic">
                            All enrolled students in course
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex items-center space-x-2 shrink-0 pt-2 lg:pt-0">
                    {/* Reuse in Section Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenReuseModal(recording)}
                      disabled={isProcessing}
                      className="text-xs h-8"
                      title="Share this existing recording with additional sections without re-uploading"
                    >
                      <Share2 className="w-3.5 h-3.5 mr-1.5" />
                      Reuse in Section
                    </Button>

                    {/* Publish / Unpublish Toggle */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => togglePublishMutation.mutate(recording.id)}
                      disabled={isProcessing || togglePublishMutation.isPending}
                      className="text-xs h-8"
                    >
                      {recording.is_published ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5 mr-1" /> Unpublish
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5 mr-1" /> Publish
                        </>
                      )}
                    </Button>

                    {/* View & Play */}
                    <Link to={`/student/recorded-lessons/${recording.id}`}>
                      <Button size="sm" className="text-xs h-8">
                        <Play className="w-3.5 h-3.5 mr-1.5" />
                        Preview
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Reuse In Section Modal */}
      {reuseModalRecording && (
        <Dialog
          isOpen={Boolean(reuseModalRecording)}
          onClose={() => setReuseModalRecording(null)}
          title="Reuse Recording Across Sections"
        >
          <div className="space-y-4 text-xs sm:text-sm">
            <div>
              <p className="font-semibold text-[#202B2A]">{reuseModalRecording.title}</p>
              <p className="text-xs text-[#687775] mt-0.5">
                Select the authorized student cohorts / sections that should have access to this lecture.
              </p>
            </div>

            <div className="space-y-2 border border-[#E1E8E4] rounded-lg p-3 bg-[#F1F5F2] max-h-48 overflow-y-auto">
              {!sections || sections.length === 0 ? (
                <p className="text-xs text-[#687775] italic">No multi-section cohorts configured for this course.</p>
              ) : (
                sections.map((sec) => {
                  const isChecked = selectedSectionIds.includes(sec.id)
                  return (
                    <label
                      key={sec.id}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-[#FFFFFF] cursor-pointer transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSection(sec.id)}
                          className="rounded border-[#CBD7D1] text-[#0F5B57] focus:ring-[#0F5B57]"
                        />
                        <span className="font-medium text-[#202B2A]">{sec.name}</span>
                      </div>
                      <span className="text-xs font-mono text-[#687775]">
                        {sec.student_count} students
                      </span>
                    </label>
                  )
                })
              )}
            </div>

            <div className="p-2.5 bg-[#E5F5EB] rounded-lg border border-[#CBD7D1] text-xs text-[#247A4D] leading-relaxed">
              <strong>Bandwidth & Storage Efficient:</strong> Reusing an authorized recording creates lightweight permission references without duplicating large media files or consuming storage quotas.
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#E1E8E4]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReuseModalRecording(null)}
                disabled={reuseMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmReuse}
                disabled={reuseMutation.isPending}
              >
                {reuseMutation.isPending ? 'Updating...' : 'Save Section Sharing'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
