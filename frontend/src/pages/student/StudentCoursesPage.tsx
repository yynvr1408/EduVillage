import React, { useState, useEffect } from 'react'
import { Search, BookOpen } from 'lucide-react'
import { courseService } from '../../services/courseService'
import type { Course } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { CourseCard } from '../../components/course/CourseCard'
import { Input } from '../../components/ui/Input'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'

export const StudentCoursesPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([])
  const [searchQuery, setSearchQuery] = useState('')
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

  const filteredCourses = courses.filter(
    (c) =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  return (
    <PageContainer
      title="Course Catalog"
      subtitle="Explore rural-adapted curriculum modules, download study guides, and review lesson notes."
    >
      {/* Search Input */}
      <div className="mb-6 max-w-md">
        <Input
          type="search"
          placeholder="Search by course title or code (e.g. STEM-201)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filteredCourses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-6 h-6" />}
          title={searchQuery ? 'No matching courses found' : 'No courses available'}
          description={
            searchQuery
              ? `No courses matched "${searchQuery}". Try different keywords.`
              : 'Enrolled courses will appear here once loaded.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCourses.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
