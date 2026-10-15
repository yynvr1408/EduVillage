import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, BookOpen } from 'lucide-react'
import { courseService } from '../../services/courseService'
import type { Course } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { CourseCard } from '../../components/course/CourseCard'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'

export const TeacherCoursesPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-6 h-6" />}
          title="No courses created yet"
          description="Create your first offline-ready course curriculum to start teaching."
          actionLabel="Create Course"
          onAction={() => {}}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((course) => (
            <CourseCard key={course.id} course={course} isTeacher={true} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
