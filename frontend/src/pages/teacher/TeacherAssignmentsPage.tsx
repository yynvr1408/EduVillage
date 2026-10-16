import React, { useState, useEffect } from 'react'
import {
  FileCheck,
  Plus,
  Calendar,
  CheckCircle2,
  Users,
  AlertCircle,
  Eye,
  Paperclip,
} from 'lucide-react'
import { assignmentService } from '../../services/assignmentService'
import { courseService } from '../../services/courseService'
import { formatDueDate } from '../../utils/dates'
import type { Assignment, Course, Submission } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { Card, CardHeader, CardContent } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Dialog } from '../../components/ui/Dialog'
import { FormField } from '../../components/ui/FormField'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'

export const TeacherAssignmentsPage: React.FC = () => {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Create Assignment Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [courseId, setCourseId] = useState('')
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [maxScore, setMaxScore] = useState(100)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Submissions Modal
  const [isSubmissionsOpen, setIsSubmissionsOpen] = useState(false)
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [allAsg, allCourses] = await Promise.allSettled([
        assignmentService.getAssignments(),
        courseService.getCourses(),
      ])

      if (allAsg.status === 'fulfilled') setAssignments(allAsg.value)
      if (allCourses.status === 'fulfilled') {
        setCourses(allCourses.value)
        if (allCourses.value.length > 0 && !courseId) {
          setCourseId(allCourses.value[0].id)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // Default due date to 5 days ahead
    const d = new Date()
    d.setDate(d.getDate() + 5)
    setDueDate(d.toISOString().slice(0, 10))
  }, [])

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !courseId || !instructions.trim() || !dueDate) {
      setError('Please fill in all required fields.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await assignmentService.createAssignment({
        course_id: courseId,
        title,
        instructions,
        due_date: new Date(dueDate).toISOString(),
        max_score: maxScore,
      })

      setIsCreateOpen(false)
      setTitle('')
      setInstructions('')
      loadData()
    } catch (err: any) {
      setError(err.message || 'Failed to create assignment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleViewSubmissions = async (a: Assignment) => {
    setSelectedAssignment(a)
    setIsSubmissionsOpen(true)
    setLoadingSubmissions(true)
    try {
      const list = await assignmentService.getSubmissions(a.id)
      setSubmissions(list)
    } finally {
      setLoadingSubmissions(false)
    }
  }

  const courseOptions = courses.map((c) => ({
    value: c.id,
    label: `${c.code}: ${c.title}`,
  }))

  return (
    <PageContainer
      title="Course Assignments & Tasks"
      subtitle="Publish problem sets, evaluate student submissions, and monitor offline sync activity."
      action={
        <Button
          size="sm"
          variant="primary"
          onClick={() => setIsCreateOpen(true)}
          icon={<Plus className="w-4 h-4" />}
        >
          Create Assignment
        </Button>
      }
    >
      {assignments.length === 0 ? (
        <div className="p-8 border border-dashed border-[#CBD7D1] bg-[#F8FAF7] rounded-xl text-center text-xs text-[#687775]">
          <FileCheck className="w-8 h-8 mx-auto text-[#0F5B57] mb-2" />
          No assignments authored yet. Click 'Create Assignment' above to create one.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {assignments.map((a) => (
            <div
              key={a.id}
              className="p-4 bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-sm text-[#202B2A]">{a.title}</span>
                  <Badge variant="outline" size="sm" className="font-mono">
                    {a.course_title || 'Course'}
                  </Badge>
                </div>
                <p className="text-[#687775] line-clamp-2 max-w-2xl mb-1">{a.instructions}</p>
                <div className="flex items-center gap-2 text-[#84908D]">
                  <span>{a.due_date ? `Due: ${formatDueDate(a.due_date)}` : 'No due date'}</span>
                  <span>•</span>
                  <span>Max Score: {a.max_score} pts</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleViewSubmissions(a)}
                  icon={<Eye className="w-3.5 h-3.5" />}
                >
                  View Submissions ({a.submissions_count || 0})
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Assignment Dialog */}
      <Dialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Author Assignment"
        description="Provide problem instructions. Students can draft answers offline and submit idempotently."
        maxWidth="lg"
      >
        <form onSubmit={handleCreateAssignment} className="flex flex-col gap-4 text-xs">
          {error && (
            <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#CBD7D1] rounded-lg font-medium">
              {error}
            </div>
          )}

          <FormField label="Course" htmlFor="asgCourse" required>
            <Select
              id="asgCourse"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              options={courseOptions}
            />
          </FormField>

          <FormField label="Assignment Title" htmlFor="asgTitle" required>
            <Input
              id="asgTitle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Rural Solar Load & Sizing Calculation"
              required
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Due Date" htmlFor="asgDueDate" required>
              <Input
                id="asgDueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </FormField>

            <FormField label="Maximum Score (Points)" htmlFor="asgScore" required>
              <Input
                id="asgScore"
                type="number"
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value))}
                required
              />
            </FormField>
          </div>

          <FormField label="Task Instructions & Deliverables" htmlFor="asgInstr" required>
            <Textarea
              id="asgInstr"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={6}
              placeholder="Detail the technical requirements, input parameters, and expected format..."
              required
            />
          </FormField>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E1E8E4]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              isLoading={isSubmitting}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Publish Assignment
            </Button>
          </div>
        </form>
      </Dialog>

      {/* View Submissions Dialog */}
      <Dialog
        isOpen={isSubmissionsOpen}
        onClose={() => setIsSubmissionsOpen(false)}
        title={selectedAssignment ? `Submissions: ${selectedAssignment.title}` : 'Submissions'}
        description="Review student answers submitted online or synced via offline queue."
        maxWidth="lg"
      >
        <div className="flex flex-col gap-3 text-xs">
          {loadingSubmissions ? (
            <p className="text-center py-6 text-[#687775]">Loading student responses...</p>
          ) : submissions.length === 0 ? (
            <p className="text-center py-6 text-[#687775]">
              No student submissions received yet for this assignment.
            </p>
          ) : (
            submissions.map((sub) => (
              <div
                key={sub.id}
                className="p-4 bg-[#F1F5F2] border border-[#E1E8E4] rounded-xl flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#202B2A]">
                      {sub.student_name || 'Student'}
                    </span>
                    <Badge variant="success" size="sm">
                      {sub.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-[#687775]">
                    Submitted: {new Date(sub.submitted_at).toLocaleString()}
                  </span>
                </div>
                <div className="p-3 bg-[#FFFFFF] border border-[#E1E8E4] rounded-lg text-[#202B2A] whitespace-pre-wrap leading-relaxed">
                  {sub.content || <span className="text-[#687775]">No written answer.</span>}
                </div>
                {sub.attachments && sub.attachments.length > 0 && (
                  <ul className="flex flex-col gap-1.5" aria-label="Attached files">
                    {sub.attachments.map((f) => (
                      <li key={f.id}>
                        <a
                          href={assignmentService.attachmentDownloadUrl(sub.assignment_id, f.id)}
                          className="inline-flex items-center gap-2 text-[#0F5B57] font-semibold hover:underline"
                        >
                          <Paperclip className="w-3.5 h-3.5" /> {f.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </Dialog>
    </PageContainer>
  )
}
