import React from 'react'
import { Link } from 'react-router-dom'
import { Calendar, CheckCircle2, Clock, CloudUpload, Edit3, ArrowRight } from 'lucide-react'
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

  const dueDateFormatted = new Date(assignment.due_date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <Card className="flex flex-col h-full border-[#E5E5E5]">
      <CardHeader className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#666666] truncate">
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
        <h3 className="font-bold text-base text-[#111111] line-clamp-2 mb-2">
          {assignment.title}
        </h3>
        <p className="text-xs text-[#666666] line-clamp-3 mb-4 leading-relaxed">
          {assignment.instructions}
        </p>

        <div className="flex items-center gap-2 text-xs text-[#666666] mt-auto pt-2 border-t border-[#F5F5F5]">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>Due: {dueDateFormatted}</span>
          <span className="ml-auto font-medium text-[#111111]">Max: {assignment.max_score} pts</span>
        </div>
      </CardContent>

      <CardFooter>
        <div className="text-[11px] text-[#666666] flex items-center gap-1.5">
          {isServerSubmitted ? (
            <span className="text-[#166534] flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Confirmed on server
            </span>
          ) : isPendingSync ? (
            <span className="text-[#854D0E] flex items-center gap-1 font-medium">
              <CloudUpload className="w-3.5 h-3.5" />
              In offline queue
            </span>
          ) : isLocalDraft ? (
            <span className="text-[#111111] flex items-center gap-1 font-medium">
              <Edit3 className="w-3.5 h-3.5" />
              Local draft ready
            </span>
          ) : (
            <span className="text-[#666666]">Ready to start</span>
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
