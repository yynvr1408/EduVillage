import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Plus,
  BookOpen,
  FileText,
  Users,
  CheckCircle2,
  FolderOpen,
  AlertCircle,
  Pencil,
  Archive,
} from 'lucide-react'
import { courseService } from '../../services/courseService'
import type { Course, Lesson } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
  Button,
  Dialog,
  FormField,
  Input,
  Textarea,
  LoadingState,
  ErrorState,
} from '../../components/ui'

export const TeacherManageCoursePage: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>()
  const navigate = useNavigate()

  const [course, setCourse] = useState<Course | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add Lesson Modal state
  const [isAddLessonOpen, setIsAddLessonOpen] = useState(false)
  const [lessonTitle, setLessonTitle] = useState('')
  const [lessonDescription, setLessonDescription] = useState('')
  const [lessonContent, setLessonContent] = useState('')
  const [isSavingLesson, setIsSavingLesson] = useState(false)
  const [lessonError, setLessonError] = useState<string | null>(null)

  // Edit Course Modal state
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Archive confirmation state
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const loadData = async () => {
    if (!courseId) return
    setIsLoading(true)
    setError(null)
    try {
      const c = await courseService.getCourseById(courseId)
      setCourse(c)
    } catch (err: any) {
      setError(err.message || 'Failed to load course')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [courseId])

  const handleAddLesson = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!lessonTitle.trim()) {
      setLessonError('Lesson title is required.')
      return
    }

    if (!courseId) return
    setIsSavingLesson(true)
    setLessonError(null)

    try {
      await courseService.createLesson(courseId, {
        title: lessonTitle,
        description: lessonDescription,
        order_index: (course?.lessons?.length || 0) + 1,
        content: lessonContent,
        offline_ready: true,
      })
      setIsAddLessonOpen(false)
      setLessonTitle('')
      setLessonDescription('')
      setLessonContent('')
      loadData()
    } catch (err: any) {
      setLessonError(err.message || 'Failed to save lesson.')
    } finally {
      setIsSavingLesson(false)
    }
  }

  const openEdit = () => {
    if (!course) return
    setEditTitle(course.title)
    setEditDescription(course.description || '')
    setEditError(null)
    setIsEditOpen(true)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!courseId) return
    if (!editTitle.trim()) {
      setEditError('Course title is required.')
      return
    }
    setIsSavingEdit(true)
    setEditError(null)
    try {
      await courseService.updateCourse(courseId, { title: editTitle.trim(), description: editDescription.trim() })
      setIsEditOpen(false)
      loadData()
    } catch (err: any) {
      setEditError(err.message || 'Failed to save changes.')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleArchive = async () => {
    if (!courseId) return
    setIsArchiving(true)
    setArchiveError(null)
    try {
      await courseService.archiveCourse(courseId)
      navigate('/teacher/courses')
    } catch (err: any) {
      setArchiveError(err.message || 'Failed to archive this course.')
      setIsArchiving(false)
    }
  }

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState message="Loading course curriculum and enrolled students..." />
      </PageContainer>
    )
  }

  if (error || !course) {
    return (
      <PageContainer>
        <div className="mb-4">
          <Link
            to="/teacher/courses"
            className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Courses
          </Link>
        </div>
        <ErrorState title="Course Not Found" message={error || 'Unable to retrieve course.'} />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <div className="mb-4">
        <Link
          to="/teacher/courses"
          className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Courses
        </Link>
      </div>

      {/* Header Info */}
      <div className="p-6 bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="font-mono">
              {course.code}
            </Badge>
            <Badge variant="secondary" size="sm">
              {course.lessons?.length || 0} Lessons
            </Badge>
            {course.status === 'archived' && (
              <Badge variant="warning" size="sm">
                Archived
              </Badge>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">
            {course.title}
          </h1>
          <p className="text-xs text-[#687775] mt-1 max-w-2xl">{course.description}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={openEdit} icon={<Pencil className="w-3.5 h-3.5" />}>
            Edit Course
          </Button>
          {course.status !== 'archived' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setArchiveError(null)
                setIsArchiveConfirmOpen(true)
              }}
              icon={<Archive className="w-3.5 h-3.5" />}
            >
              Archive
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => setIsAddLessonOpen(true)}
            icon={<Plus className="w-4 h-4" />}
          >
            Add New Lesson
          </Button>
        </div>
      </div>

      {/* Lessons List */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-[#202B2A] mb-3 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[#0F5B57]" /> Curriculum Lessons
        </h2>

        {(!course.lessons || course.lessons.length === 0) ? (
          <div className="p-8 border border-dashed border-[#CBD7D1] bg-[#F8FAF7] rounded-xl text-center text-xs text-[#687775]">
            No lessons created yet. Click 'Add New Lesson' to author curriculum notes.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {course.lessons.map((lesson, idx) => (
              <div
                key={lesson.id}
                className="p-4 bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl flex items-center justify-between gap-4 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[#687775] font-semibold">{idx + 1}.</span>
                    <span className="font-bold text-[#202B2A] text-sm">{lesson.title}</span>
                    <Badge variant="secondary" size="sm" className="text-xs">
                      Offline Ready
                    </Badge>
                  </div>
                  {lesson.description && (
                    <p className="text-[#687775] line-clamp-1">{lesson.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-[#687775]">
                    {lesson.content ? `${lesson.content.length} chars` : 'Empty'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add Lesson Dialog */}
      <Dialog
        isOpen={isAddLessonOpen}
        onClose={() => setIsAddLessonOpen(false)}
        title="Author Lesson"
        description="Add a lesson with rich text notes, formulas, and offline content."
        maxWidth="lg"
      >
        <form onSubmit={handleAddLesson} className="flex flex-col gap-4 text-xs">
          {lessonError && (
            <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#CBD7D1] rounded-lg font-medium">
              {lessonError}
            </div>
          )}

          <FormField label="Lesson Title" htmlFor="lessonTitle" required>
            <Input
              id="lessonTitle"
              value={lessonTitle}
              onChange={(e) => setLessonTitle(e.target.value)}
              placeholder="e.g. 1. Photovoltaic Cell Physics & Irradiance Variation"
              required
            />
          </FormField>

          <FormField label="Short Summary / Subtitle" htmlFor="lessonDesc">
            <Input
              id="lessonDesc"
              value={lessonDescription}
              onChange={(e) => setLessonDescription(e.target.value)}
              placeholder="Core takeaways..."
            />
          </FormField>

          <FormField label="Lesson Body (Markdown / LaTeX Supported)" htmlFor="lessonContent">
            <Textarea
              id="lessonContent"
              value={lessonContent}
              onChange={(e) => setLessonContent(e.target.value)}
              rows={8}
              placeholder="# Lesson Topic&#10;&#10;Key principles, diagrams, and equations..."
            />
          </FormField>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E1E8E4]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsAddLessonOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary" isLoading={isSavingLesson}>
              Save Lesson
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Edit Course Dialog */}
      <Dialog
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="Edit Course"
        description="Changes are saved to this course's record; enrollments and lesson history are untouched."
        maxWidth="lg"
      >
        <form onSubmit={handleSaveEdit} className="flex flex-col gap-4 text-xs">
          {editError && (
            <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#CBD7D1] rounded-lg font-medium">
              {editError}
            </div>
          )}

          <FormField label="Course Title" htmlFor="editTitle" required>
            <Input id="editTitle" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
          </FormField>

          <FormField label="Description" htmlFor="editDescription">
            <Textarea
              id="editDescription"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
            />
          </FormField>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E1E8E4]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary" isLoading={isSavingEdit}>
              Save Changes
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Archive Confirmation Dialog */}
      <Dialog
        isOpen={isArchiveConfirmOpen}
        onClose={() => !isArchiving && setIsArchiveConfirmOpen(false)}
        title="Archive This Course?"
        description="Archiving removes it from the catalog and new self-enrollment, but keeps every lesson, enrollment, assignment and class record intact — nothing is deleted, and you can keep managing it from your course list."
        maxWidth="md"
      >
        <div className="flex flex-col gap-4 text-xs">
          {archiveError && (
            <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#CBD7D1] rounded-lg font-medium">
              {archiveError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E1E8E4]">
            <Button type="button" variant="ghost" size="sm" disabled={isArchiving} onClick={() => setIsArchiveConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" variant="primary" isLoading={isArchiving} onClick={handleArchive}>
              Archive Course
            </Button>
          </div>
        </div>
      </Dialog>
    </PageContainer>
  )
}
