import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Calendar, FileText, CheckCircle2, Clock } from 'lucide-react'
import { assignmentService } from '../../services/assignmentService'
import type { Assignment } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { OfflineDraftEditor } from '../../components/assignment/OfflineDraftEditor'
import { Badge, Card, CardHeader, CardContent, LoadingState, ErrorState } from '../../components/ui'

export const StudentAssignmentDetailPage: React.FC = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>()

  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = async () => {
    if (!assignmentId) return
    setIsLoading(true)
    setError(null)
    try {
      const a = await assignmentService.getAssignmentById(assignmentId)
      setAssignment(a)
    } catch (err: any) {
      setError(err.message || 'Failed to load assignment')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [assignmentId])

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState message="Loading assignment instructions and local draft..." />
      </PageContainer>
    )
  }

  if (error || !assignment) {
    return (
      <PageContainer>
        <div className="mb-4">
          <Link
            to="/student/assignments"
            className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Assignments
          </Link>
        </div>
        <ErrorState
          title="Assignment Not Found"
          message={error || 'Unable to load assignment details.'}
        />
      </PageContainer>
    )
  }

  const isServerSubmitted = Boolean(assignment.my_submission)

  return (
    <PageContainer maxWidth="lg">
      {/* Back Link */}
      <div className="mb-4">
        <Link
          to="/student/assignments"
          className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Assignments
        </Link>
      </div>

      {/* Assignment Header Card */}
      <div className="p-6 bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold text-[#687775]">
            {assignment.course_title || 'Course Assignment'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#687775] flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-[#687775]" />
              Due: {new Date(assignment.due_date).toLocaleDateString()}
            </span>
            <Badge variant={isServerSubmitted ? 'success' : 'outline'}>
              {isServerSubmitted ? 'Submitted' : 'Open for Submission'}
            </Badge>
          </div>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#202B2A] mb-4">
          {assignment.title}
        </h1>

        {/* Instructions */}
        <div className="p-4 bg-[#F1F5F2] border border-[#E1E8E4] rounded-xl text-xs sm:text-sm text-[#202B2A] leading-relaxed whitespace-pre-wrap font-sans">
          {assignment.instructions}
        </div>
      </div>

      {/* Existing Server Submission Banner if Graded / Submitted */}
      {isServerSubmitted && (
        <div className="p-4 bg-[#E5F5EB] border border-[#CBD7D1] rounded-2xl mb-6 text-xs text-[#247A4D] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-[#247A4D]" />
            <div>
              <p className="font-bold text-[#247A4D]">Submission Confirmed by Server</p>
              <p className="text-[11px] text-[#247A4D]">
                Submitted on {new Date(assignment.my_submission!.submitted_at).toLocaleString()}
                {assignment.my_submission!.score !== null &&
                  ` • Score: ${assignment.my_submission!.score} / ${assignment.max_score}`}
              </p>
            </div>
          </div>
          {assignment.my_submission!.feedback && (
            <div className="text-right">
              <span className="font-semibold block text-[#247A4D]">Teacher Feedback:</span>
              <span className="text-[#202B2A]">{assignment.my_submission!.feedback}</span>
            </div>
          )}
        </div>
      )}

      {/* Offline-Capable Draft & Submission Editor */}
      <section>
        <h2 className="text-base font-bold text-[#202B2A] mb-2 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#0F5B57]" /> Your Response & Calculations
        </h2>
        <OfflineDraftEditor
          assignment={assignment}
          onSubmitted={() => loadData()}
        />
      </section>
    </PageContainer>
  )
}
