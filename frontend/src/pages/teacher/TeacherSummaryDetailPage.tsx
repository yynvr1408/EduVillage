import React, { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Edit3 } from 'lucide-react'
import { summaryService } from '../../services/summaryService'
import { SummaryViewer } from '../../components/summary/SummaryViewer'
import { SummaryReviewModal } from '../../components/summary/SummaryReviewModal'
import { Badge, Button, LoadingState, ErrorState } from '../../components/ui'
import type { Summary } from '../../types'

export const TeacherSummaryDetailPage: React.FC = () => {
  const { classId } = useParams<{ classId: string }>()
  const [isReviewOpen, setIsReviewOpen] = useState(false)

  const {
    data: summary,
    isLoading,
    error,
    refetch,
  } = useQuery<Summary>({
    queryKey: ['teacher-summary', classId],
    queryFn: () => summaryService.getClassSummary(classId!),
    enabled: Boolean(classId),
  })

  if (isLoading) {
    return <LoadingState message="Loading lecture summary..." />
  }

  if (error || !summary) {
    return (
      <ErrorState
        title="Summary Not Found"
        message="This class session has no AI summary yet, or it could not be loaded."
        actionLabel="Back to Summaries"
        onAction={() => window.history.back()}
      />
    )
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <Link
        to="/teacher/summaries"
        className="inline-flex items-center text-xs sm:text-sm font-medium text-[#687775] hover:text-[#0F5B57] transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        Back to Summaries
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E1E8E4]">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-[#202B2A]">Class Session: {summary.class_id}</span>
          <Badge
            variant={
              summary.review_status === 'APPROVED'
                ? 'success'
                : summary.review_status === 'REVISION_REQUESTED'
                ? 'warning'
                : 'secondary'
            }
            size="sm"
          >
            {summary.review_status === 'APPROVED'
              ? 'Approved by Teacher'
              : summary.review_status === 'REVISION_REQUESTED'
              ? 'Revision Requested'
              : 'Pending Teacher Review'}
          </Badge>
        </div>

        <Button size="sm" variant="primary" onClick={() => setIsReviewOpen(true)} icon={<Edit3 className="w-3.5 h-3.5" />}>
          Review & Edit Notes
        </Button>
      </div>

      <SummaryViewer summary={summary} isTeacher={true} onReview={() => setIsReviewOpen(true)} />

      <SummaryReviewModal
        summary={summary}
        isOpen={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        onSuccess={() => {
          setIsReviewOpen(false)
          refetch()
        }}
      />
    </div>
  )
}
