import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Calendar, Video, AlertCircle } from 'lucide-react'
import { api } from '../../services/apiClient'
import { classService } from '../../services/classService'
import { courseService } from '../../services/courseService'
import type { Course, Section } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { FormField } from '../../components/ui/FormField'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'

export const TeacherCreateClassPage: React.FC = () => {
  const navigate = useNavigate()

  const [courses, setCourses] = useState<Course[]>([])
  const [courseId, setCourseId] = useState('')
  const [title, setTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sections, setSections] = useState<Section[]>([])
  const [sectionId, setSectionId] = useState<string>('')

  useEffect(() => {
    courseService.getCourses().then((list) => {
      setCourses(list)
      if (list.length > 0) setCourseId(list[0].id)
    })

    // Default to tomorrow 10:00 AM
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(10, 0, 0, 0)
    setScheduledAt(tomorrow.toISOString().slice(0, 16))
  }, [])

  useEffect(() => {
    if (courseId) {
      api.getSections(courseId).then(setSections).catch(() => setSections([]))
      setSectionId('')
    }
  }, [courseId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !courseId || !scheduledAt) {
      setError('Please select a course and enter class title and date/time.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await classService.scheduleClass({
        course_id: courseId,
        section_id: sectionId || undefined,
        title,
        scheduled_at: new Date(scheduledAt).toISOString(),
      })
      navigate('/teacher/classes')
    } catch (err: any) {
      setError(err.message || 'Failed to schedule class.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const courseOptions = courses.map((c) => ({
    value: c.id,
    label: `${c.code}: ${c.title}`,
  }))

  return (
    <PageContainer maxWidth="md">
      <div className="mb-4">
        <Link
          to="/teacher/classes"
          className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Class Sessions
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">
          Schedule Class Session
        </h1>
        <p className="text-xs text-[#687775] mt-1">
          Set up a live interactive lecture room. A dedicated LiveKit room token will be issued for you and authorized students.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-[#FDE8E7] text-[#B42318] border border-[#CBD7D1] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <FormField label="Associated Course" htmlFor="course" required>
              <Select
                id="course"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                options={courseOptions}
              />
            </FormField>

            {sections.length > 0 && (
              <FormField
                label="Target Cohort / Section (Optional)"
                htmlFor="section"
                hint="Assign class to a specific section group or leave as combined"
              >
                <Select
                  id="section"
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  options={[
                    { value: '', label: 'All Course Students (Combined Cohort)' },
                    ...sections.map((s) => ({
                      value: s.id,
                      label: `${s.name} (${s.student_count} students)`,
                    })),
                  ]}
                />
              </FormField>
            )}

            <FormField label="Session Title" htmlFor="title" required hint="e.g. Field Diagnostics: Ground Faults & Inverter Calibration">
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Class title..."
                required
              />
            </FormField>

            <FormField label="Date and Time" htmlFor="datetime" required>
              <Input
                id="datetime"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
            </FormField>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E1E8E4]">
              <Link to="/teacher/classes">
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                isLoading={isSubmitting}
                icon={<Video className="w-3.5 h-3.5" />}
              >
                Schedule Class
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
