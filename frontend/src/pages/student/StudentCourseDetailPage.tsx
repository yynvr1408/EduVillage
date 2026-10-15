import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  BookOpen,
  User,
  ArrowLeft,
  FileText,
  Video,
  Download,
  Calendar,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
} from 'lucide-react'
import { courseService } from '../../services/courseService'
import { classService } from '../../services/classService'
import { assignmentService } from '../../services/assignmentService'
import { downloadManager } from '../../services/downloadManager'
import type { Course, Lesson, ClassRoom, Assignment, Material } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { Card, CardHeader, CardContent, Badge, Button, LoadingState, ErrorState } from '../../components/ui'
import { DownloadItem } from '../../components/download/DownloadItem'

export const StudentCourseDetailPage: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>()

  const [course, setCourse] = useState<Course | null>(null)
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      if (!courseId) return
      setIsLoading(true)
      setError(null)
      try {
        const [c, allCls, allAsg] = await Promise.all([
          courseService.getCourseById(courseId),
          classService.getClasses(),
          assignmentService.getAssignments(courseId),
        ])

        if (!isMounted) return
        setCourse(c)
        setClasses(allCls.filter((cl) => cl.course_id === courseId))
        setAssignments(allAsg)

        // Generate or load materials for the course
        const sampleMaterials: Material[] = [
          {
            id: `mat-${courseId}-1`,
            course_id: courseId,
            title: `${c.code} Field Diagnostics Handbook (PDF)`,
            file_url: `/downloads/${c.code.toLowerCase()}-handbook.pdf`,
            file_type: 'pdf',
            file_size: 2450000,
            is_published: true,
            created_at: new Date().toISOString(),
          },
          {
            id: `mat-${courseId}-2`,
            course_id: courseId,
            title: `${c.code} Sizing & Engineering Calculation Sheet`,
            file_url: `/downloads/${c.code.toLowerCase()}-worksheet.pdf`,
            file_type: 'pdf',
            file_size: 980000,
            is_published: true,
            created_at: new Date().toISOString(),
          },
          {
            id: `mat-${courseId}-3`,
            course_id: courseId,
            title: `Audio Lecture: Emergency Maintenance & Troubleshooting`,
            file_url: `/downloads/${c.code.toLowerCase()}-audio.mp3`,
            file_type: 'audio',
            file_size: 5600000,
            is_published: true,
            created_at: new Date().toISOString(),
          },
        ]
        setMaterials(sampleMaterials)
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to load course details')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadData()
    return () => {
      isMounted = false
    }
  }, [courseId])

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState message="Loading course curriculum and offline resources..." />
      </PageContainer>
    )
  }

  if (error || !course) {
    return (
      <PageContainer>
        <ErrorState
          title="Course Not Found"
          message={error || 'Unable to retrieve course details.'}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      {/* Back button */}
      <div className="mb-4">
        <Link
          to="/student/courses"
          className="text-xs font-semibold text-[#666666] hover:text-[#111111] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Courses
        </Link>
      </div>

      {/* Course Overview Card */}
      <div className="p-6 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl mb-8">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Badge variant="outline" className="font-mono">
            {course.code}
          </Badge>
          <Badge variant="secondary" size="sm">
            {course.lessons?.length || 0} Lessons
          </Badge>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111111] mb-2">
          {course.title}
        </h1>
        {course.teacher_name && (
          <p className="text-xs text-[#666666] flex items-center gap-1.5 mb-4">
            <User className="w-4 h-4" /> Instructor: <strong className="text-[#111111]">{course.teacher_name}</strong>
          </p>
        )}
        <p className="text-sm text-[#666666] leading-relaxed max-w-3xl">
          {course.description || 'Comprehensive curriculum optimized for offline and low-bandwidth learning.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Lessons list */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <section>
            <h2 className="text-lg font-bold text-[#111111] mb-3 flex items-center gap-2">
              <BookOpen className="w-5 h-5" /> Course Curriculum & Lessons
            </h2>

            {(!course.lessons || course.lessons.length === 0) ? (
              <div className="p-6 border border-[#E5E5E5] rounded-lg text-center text-xs text-[#666666]">
                Lessons are being uploaded by the instructor.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {course.lessons.map((lesson) => (
                  <Link
                    key={lesson.id}
                    to={`/student/lessons/${lesson.id}`}
                    className="p-4 bg-[#FFFFFF] border border-[#E5E5E5] hover:border-[#111111] rounded-lg flex items-center justify-between transition-colors group"
                  >
                    <div className="min-w-0 pr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-[#111111] group-hover:underline truncate">
                          {lesson.title}
                        </span>
                        {lesson.offline_ready && (
                          <Badge variant="secondary" size="sm" className="text-[10px]">
                            Offline Ready
                          </Badge>
                        )}
                      </div>
                      {lesson.description && (
                        <p className="text-xs text-[#666666] line-clamp-1">
                          {lesson.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#666666] group-hover:text-[#111111] shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Downloadable Course Materials */}
          <section>
            <h2 className="text-lg font-bold text-[#111111] mb-3 flex items-center gap-2">
              <FolderOpen className="w-5 h-5" /> Downloadable Course Materials
            </h2>
            <p className="text-xs text-[#666666] mb-4">
              Save study resources to your device's IndexedDB storage for offline reading and playback.
            </p>

            <div className="flex flex-col gap-2.5">
              {materials.map((m) => (
                <DownloadItem key={m.id} material={m} courseTitle={course.title} />
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Related Classes & Assignments */}
        <div className="flex flex-col gap-6">
          {/* Related Live / Scheduled Classes */}
          <Card>
            <CardHeader className="py-3 px-4 font-bold text-sm text-[#111111] flex items-center gap-2">
              <Video className="w-4 h-4" /> Class Sessions
            </CardHeader>
            <CardContent className="p-4 flex flex-col gap-3">
              {classes.length === 0 ? (
                <p className="text-xs text-[#666666]">No class sessions currently scheduled.</p>
              ) : (
                classes.map((c) => (
                  <div key={c.id} className="p-3 bg-[#F5F5F5] rounded-md flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between">
                      <Badge variant={c.status === 'LIVE' ? 'live' : 'secondary'} size="sm">
                        {c.status}
                      </Badge>
                      <span className="text-[11px] text-[#666666]">
                        {new Date(c.scheduled_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="font-semibold text-[#111111] line-clamp-1">{c.title}</p>
                    {c.status === 'LIVE' ? (
                      <Link to={`/classroom/${c.id}`} className="mt-1">
                        <Button size="sm" variant="primary" fullWidth>
                          Join Live Room
                        </Button>
                      </Link>
                    ) : c.status === 'ENDED' ? (
                      <Link to={`/student/classes/${c.id}/summary`} className="mt-1">
                        <Button size="sm" variant="outline" fullWidth>
                          View Summary
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Related Assignments */}
          <Card>
            <CardHeader className="py-3 px-4 font-bold text-sm text-[#111111] flex items-center gap-2">
              <FileText className="w-4 h-4" /> Course Tasks
            </CardHeader>
            <CardContent className="p-4 flex flex-col gap-3">
              {assignments.length === 0 ? (
                <p className="text-xs text-[#666666]">No assignments assigned yet.</p>
              ) : (
                assignments.map((a) => (
                  <div key={a.id} className="p-3 border border-[#E5E5E5] rounded-md flex flex-col gap-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#111111] line-clamp-1">{a.title}</span>
                      {a.my_submission ? (
                        <Badge variant="success" size="sm">Submitted</Badge>
                      ) : (
                        <Badge variant="outline" size="sm">Due {new Date(a.due_date).toLocaleDateString()}</Badge>
                      )}
                    </div>
                    <Link to={`/student/assignments/${a.id}`} className="mt-1">
                      <Button size="sm" variant={a.my_submission ? 'secondary' : 'outline'} fullWidth>
                        {a.my_submission ? 'Review Answer' : 'Open Draft'}
                      </Button>
                    </Link>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}
