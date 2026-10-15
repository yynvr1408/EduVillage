import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  DownloadCloud,
  FileText,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { courseService } from '../../services/courseService'
import { useNetworkStatus } from '../../context/NetworkContext'
import type { Lesson, Course } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { Badge, Button, Card, CardContent, LoadingState, ErrorState } from '../../components/ui'

export const StudentLessonPage: React.FC = () => {
  const { lessonId } = useParams<{ lessonId: string }>()
  const { isOnline } = useNetworkStatus()

  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [course, setCourse] = useState<Course | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadLesson() {
      if (!lessonId) return
      setIsLoading(true)
      setError(null)

      try {
        const l = await courseService.getLessonById(lessonId)
        if (!isMounted) return
        setLesson(l)

        try {
          const c = await courseService.getCourseById(l.course_id)
          if (isMounted) setCourse(c)
        } catch {
          // Course load optional if offline
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Unable to load lesson')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadLesson()
    return () => {
      isMounted = false
    }
  }, [lessonId])

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState message="Loading lesson content from cache..." />
      </PageContainer>
    )
  }

  if (error || !lesson) {
    return (
      <PageContainer>
        <ErrorState
          title="Lesson Unavailable"
          message={error || 'This lesson content has not been downloaded for offline access.'}
        />
      </PageContainer>
    )
  }

  // Determine prev / next lesson
  let prevLesson: Lesson | undefined
  let nextLesson: Lesson | undefined

  if (course?.lessons) {
    const currentIndex = course.lessons.findIndex((l) => l.id === lesson.id)
    if (currentIndex > 0) prevLesson = course.lessons[currentIndex - 1]
    if (currentIndex < course.lessons.length - 1) nextLesson = course.lessons[currentIndex + 1]
  }

  return (
    <PageContainer maxWidth="lg">
      {/* Top back navigation */}
      <div className="flex items-center justify-between mb-4">
        <Link
          to={`/student/courses/${lesson.course_id}`}
          className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Curriculum
        </Link>

        <div className="flex items-center gap-2">
          {lesson.offline_ready && (
            <Badge variant="success" size="sm">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Available Offline
            </Badge>
          )}
          <Badge variant={isOnline ? 'secondary' : 'default'} size="sm">
            {isOnline ? 'Synced' : 'Local Storage Cache'}
          </Badge>
        </div>
      </div>

      {/* Lesson Header */}
      <div className="pb-6 mb-6 border-b border-[#E1E8E4]">
        {course && (
          <span className="text-xs font-mono text-[#687775] uppercase tracking-wider block mb-1">
            {course.code} • Lesson {lesson.order_index}
          </span>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#202B2A]">
          {lesson.title}
        </h1>
        {lesson.description && (
          <p className="text-sm text-[#687775] mt-2 leading-relaxed">{lesson.description}</p>
        )}
      </div>

      {/* Lesson Body Content */}
      <article className="prose prose-neutral max-w-none mb-10 text-sm leading-relaxed text-[#202B2A] space-y-4">
        {lesson.content ? (
          <div className="p-6 bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl font-sans whitespace-pre-wrap leading-relaxed text-[#202B2A]">
            {lesson.content}
          </div>
        ) : (
          <div className="p-8 border border-dashed border-[#CBD7D1] bg-[#F8FAF7] rounded-2xl text-center text-xs text-[#687775]">
            Interactive lesson notes and formulas are stored here.
          </div>
        )}
      </article>

      {/* Previous / Next Lesson Navigation Footer */}
      <div className="pt-6 border-t border-[#E1E8E4] flex items-center justify-between gap-4">
        {prevLesson ? (
          <Link to={`/student/lessons/${prevLesson.id}`} className="min-w-0">
            <Button size="sm" variant="outline" icon={<ArrowLeft className="w-3.5 h-3.5" />}>
              <span className="truncate max-w-37.5 sm:max-w-xs">{prevLesson.title}</span>
            </Button>
          </Link>
        ) : (
          <div />
        )}

        {nextLesson ? (
          <Link to={`/student/lessons/${nextLesson.id}`} className="min-w-0">
            <Button size="sm" variant="primary">
              <span className="truncate max-w-37.5 sm:max-w-xs">{nextLesson.title}</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        ) : (
          <Link to={`/student/courses/${lesson.course_id}`}>
            <Button size="sm" variant="secondary">
              Finish Curriculum
            </Button>
          </Link>
        )}
      </div>
    </PageContainer>
  )
}
