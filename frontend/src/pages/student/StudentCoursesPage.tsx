import React, { useState, useEffect } from 'react'
import { Search, BookOpen } from 'lucide-react'
import { courseService } from '../../services/courseService'
import type { Course } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { CourseCard } from '../../components/course/CourseCard'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'

export const StudentCoursesPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([])
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set())
  const [enrollingId, setEnrollingId] = useState<string | null>(null)
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    // The catalog is every published course; "mine" decides which ones show View vs Enroll.
    Promise.all([courseService.getCatalog(), courseService.getCourses()])
      .then(([catalog, mine]) => {
        if (!isMounted) return
        const merged = new Map(catalog.map((c) => [c.id, c]))
        mine.forEach((c) => merged.set(c.id, c))
        setCourses([...merged.values()])
        setEnrolledIds(new Set(mine.map((c) => c.id)))
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const handleEnroll = async (courseId: string) => {
    setEnrollingId(courseId)
    setEnrollError(null)
    try {
      await courseService.enroll(courseId)
      setEnrolledIds((prev) => new Set(prev).add(courseId))
    } catch (err: any) {
      setEnrollError(err.message || 'Could not enroll in this course.')
    } finally {
      setEnrollingId(null)
    }
  }

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
      {enrollError && (
        <div className="mb-4 p-3 bg-[#FDE8E7] text-[#B42318] border border-[#CBD7D1] rounded-lg text-xs font-medium">{enrollError}</div>
      )}

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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">
          {filteredCourses.map((course) => (
            <div key={course.id} className="flex flex-col gap-2">
              <CourseCard course={course} />
              {!enrolledIds.has(course.id) && (
                <Button
                  size="sm"
                  variant="secondary"
                  fullWidth
                  isLoading={enrollingId === course.id}
                  onClick={() => handleEnroll(course.id)}
                >
                  Enroll to access lessons, classes and assignments
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
