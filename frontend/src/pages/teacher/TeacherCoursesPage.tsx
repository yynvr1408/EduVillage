import React, { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Plus, Search, BookOpen, CheckCircle2, X } from 'lucide-react'
import { courseService } from '../../services/courseService'
import type { Course } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { CourseCard } from '../../components/course/CourseCard'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'

export const TeacherCoursesPage: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [flashMessage, setFlashMessage] = useState<string | null>((location.state as any)?.flashMessage ?? null)

  useEffect(() => {
    // Clear the router state so refreshing/revisiting this page doesn't re-show a stale message.
    if ((location.state as any)?.flashMessage) {
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let isMounted = true
    courseService
      .getCourses()
      .then((data) => {
        if (isMounted) setCourses(data)
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const filtered = courses.filter(
    (c) =>
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <PageContainer
      title="Courses & Curricula"
      subtitle="Author educational courses, organize sequential lessons, and publish downloadable assets."
      action={
        <Link to="/teacher/courses/new">
          <Button size="sm" variant="primary" icon={<Plus className="w-4 h-4" />}>
            Create Course
          </Button>
        </Link>
      }
    >
      {flashMessage && (
        <div
          role="status"
          className="mb-6 p-3 bg-[#DDF3EA] text-[#0F5B57] border border-[#0F5B57]/30 rounded-lg text-xs font-medium flex items-center justify-between gap-3"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {flashMessage}
          </span>
          <button
            type="button"
            onClick={() => setFlashMessage(null)}
            className="shrink-0 text-[#0F5B57] hover:opacity-70 cursor-pointer"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="mb-6 max-w-md">
        <Input
          type="search"
          placeholder="Filter courses by title or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-6 h-6" />}
          title="No courses created yet"
          description="Create your first offline-ready course curriculum to start teaching."
          actionLabel="Create Course"
          onAction={() => navigate('/teacher/courses/new')}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">
          {filtered.map((course) => (
            <CourseCard key={course.id} course={course} isTeacher={true} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
