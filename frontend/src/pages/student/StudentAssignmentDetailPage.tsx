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
            className="text-xs font-semibold text-[#666666] hover:text-[#111111] inline-flex items-center gap-1.5"
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
          className="text-xs font-semibold text-[#666666] hover:text-[#111111] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Assignments
        </Link>
      </div>

      {/* Assignment Header Card */}
      <div className="p-6 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold text-[#666666]">
            {assignment.course_title || 'Course Assignment'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#666666] flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              Due: {new Date(assignment.due_date).toLocaleDateString()}
            </span>
            <Badge variant={isServerSubmitted ? 'success' : 'outline'}>
              {isServerSubmitted ? 'Submitted' : 'Open for Submission'}
            </Badge>
          </div>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111111] mb-4">
          {assignment.title}
        </h1>

        {/* Instructions */}
        <div className="p-4 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg text-xs sm:text-sm text-[#111111] leading-relaxed whitespace-pre-wrap font-sans">
          {assignment.instructions}
        </div>
      </div>

      {/* Existing Server Submission Banner if Graded / Submitted */}
      {isServerSubmitted && (
        <div className="p-4 bg-[#166534]/10 border border-[#166534]/20 rounded-xl mb-6 text-xs text-[#166534] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-bold">Submission Confirmed by Server</p>
              <p className="text-[11px] text-[#166534]/80">
                Submitted on {new Date(assignment.my_submission!.submitted_at).toLocaleString()}
                {assignment.my_submission!.score !== null &&
                  ` • Score: ${assignment.my_submission!.score} / ${assignment.max_score}`}
              </p>
            </div>
          </div>
          {assignment.my_submission!.feedback && (
            <div className="text-right">
              <span className="font-semibold block">Teacher Feedback:</span>
              <span>{assignment.my_submission!.feedback}</span>
            </div>
          )}
        </div>
      )}

      {/* Offline-Capable Draft & Submission Editor */}
      <section>
        <h2 className="text-base font-bold text-[#111111] mb-2 flex items-center gap-2">
          <FileText className="w-4 h-4" /> Your Response & Calculations
        </h2>
        <OfflineDraftEditor
          assignment={assignment}
          onSubmitted={() => loadData()}
        />
      </section>
    </PageContainer>
  )
}
