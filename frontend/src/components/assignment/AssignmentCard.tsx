import React from 'react'
import { Link } from 'react-router-dom'
import { Calendar, CheckCircle2, Clock, CloudUpload, Edit3, ArrowRight } from 'lucide-react'
import { formatDueDate } from '../../utils/dates'
import type { Assignment, AssignmentDraft } from '../../types'
import { Card, CardHeader, CardContent, CardFooter } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export interface AssignmentCardProps {
  assignment: Assignment
  draft?: AssignmentDraft | null
  isTeacher?: boolean
}

export const AssignmentCard: React.FC<AssignmentCardProps> = ({
  assignment,
  draft,
  isTeacher = false,
}) => {
  const isServerSubmitted = Boolean(assignment.my_submission)
  const isPendingSync = draft?.syncStatus === 'pending_sync'
  const isLocalDraft = Boolean(draft && draft.content.trim() && !isServerSubmitted && !isPendingSync)

  const dueDateFormatted = formatDueDate(assignment.due_date, { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <Card className="flex flex-col h-full border-[#E1E8E4]">
      <CardHeader className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#687775] truncate">
          {assignment.course_title || 'Course Assignment'}
        </span>
        {/* Status Badge */}
        {isServerSubmitted ? (
          <Badge variant="success" size="sm">
            Submitted
          </Badge>
        ) : isPendingSync ? (
          <Badge variant="warning" size="sm">
            Waiting to sync
          </Badge>
        ) : isLocalDraft ? (
          <Badge variant="secondary" size="sm">
            Saved on this device
          </Badge>
        ) : isTeacher ? (
          <Badge variant="outline" size="sm">
            {assignment.submissions_count || 0} Submissions
          </Badge>
        ) : (
          <Badge variant="outline" size="sm">
            Pending
          </Badge>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        <h3 className="font-bold text-base text-[#202B2A] line-clamp-2 mb-2">
          {assignment.title}
        </h3>
        <p className="text-sm text-[#687775] line-clamp-3 mb-4 leading-relaxed">
          {assignment.instructions}
        </p>

        <div className="flex items-center gap-2 text-xs text-[#687775] mt-auto pt-2 border-t border-[#E1E8E4]">
          <Calendar className="w-3.5 h-3.5 shrink-0 text-[#687775]" />
          <span>{assignment.due_date ? `Due: ${dueDateFormatted}` : dueDateFormatted}</span>
          <span className="ml-auto font-semibold text-[#202B2A]">Max: {assignment.max_score} pts</span>
        </div>
      </CardContent>

      <CardFooter>
        <div className="text-xs text-[#687775] flex items-center gap-1.5">
          {isServerSubmitted ? (
            <span className="text-[#247A4D] flex items-center gap-1 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Confirmed on server
            </span>
          ) : isPendingSync ? (
            <span className="text-[#8A5700] flex items-center gap-1 font-semibold">
              <CloudUpload className="w-3.5 h-3.5" />
              In offline queue
            </span>
          ) : isLocalDraft ? (
            <span className="text-[#202B2A] flex items-center gap-1 font-semibold">
              <Edit3 className="w-3.5 h-3.5 text-[#0F5B57]" />
              Local draft ready
            </span>
          ) : (
            <span className="text-[#687775]">Ready to start</span>
          )}
        </div>

        <Link
          to={
            isTeacher
              ? `/teacher/assignments`
              : `/student/assignments/${assignment.id}`
          }
        >
          <Button size="sm" variant={isServerSubmitted ? 'secondary' : 'primary'}>
            {isTeacher ? 'View Details' : isServerSubmitted ? 'View Submission' : 'Open Assignment'}
          </Button>
        </Link>
      </CardFooter>
    </Card>
  )
}
