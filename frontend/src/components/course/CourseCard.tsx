import React from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, User, ArrowRight } from 'lucide-react'
import type { Course } from '../../types'
import { Card, CardHeader, CardContent, CardFooter } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export interface CourseCardProps {
  course: Course
  isTeacher?: boolean
  /** Student catalog: while not enrolled, the footer button reads Enroll; after enrolling it becomes View Course. */
  enroll?: { enrolled: boolean; isEnrolling: boolean; onEnroll: () => void }
}

export const CourseCard: React.FC<CourseCardProps> = ({ course, isTeacher = false, enroll }) => {
  const detailLink = isTeacher
    ? `/teacher/courses/${course.id}/manage`
    : `/student/courses/${course.id}`

  return (
    <Card hoverable className="flex flex-col h-full">
      <CardHeader className="flex items-center justify-between gap-2">
        <Badge variant="outline" size="sm" className="font-mono">
          {course.code}
        </Badge>
        <span className="text-xs text-[#687775] flex items-center gap-1 font-medium">
          <BookOpen className="w-3.5 h-3.5 text-[#0F5B57]" />
          {course.lessons_count || course.lessons?.length || 0} Lessons
        </span>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        <h3 className="font-semibold text-base text-[#202B2A] line-clamp-1 mb-1 leading-snug">
          {course.title}
        </h3>
        {course.teacher_name && (
          <p className="text-xs text-[#687775] flex items-center gap-1.5 mb-3">
            <User className="w-3.5 h-3.5 shrink-0 text-[#687775]" />
            <span>{course.teacher_name}</span>
          </p>
        )}
        <p className="text-sm text-[#687775] line-clamp-3 leading-relaxed mt-auto">
          {course.description || 'Comprehensive curriculum engineered for low-bandwidth rural learning.'}
        </p>
      </CardContent>

      <CardFooter>
        <span className="text-xs text-[#687775] font-medium">
          {isTeacher ? 'Manage Curriculum' : 'Offline Ready'}
        </span>
        {enroll && !enroll.enrolled ? (
          <Button size="sm" variant="primary" isLoading={enroll.isEnrolling} onClick={enroll.onEnroll}>
            Enroll
          </Button>
        ) : (
          <Link to={detailLink}>
            <Button size="sm" variant={isTeacher ? 'outline' : 'primary'} icon={<ArrowRight className="w-3.5 h-3.5" />}>
              {isTeacher ? 'Manage' : 'View Course'}
            </Button>
          </Link>
        )}
      </CardFooter>
    </Card>
  )
}
