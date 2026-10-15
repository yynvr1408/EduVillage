import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Video,
  BookOpen,
  FileCheck,
  Sparkles,
  Plus,
  Play,
  Upload,
  Calendar,
  Users,
  CheckCircle2,
  Clock,
  ArrowRight,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { courseService } from '../../services/courseService'
import { classService } from '../../services/classService'
import { summaryService } from '../../services/summaryService'
import { assignmentService } from '../../services/assignmentService'
import type { Course, ClassRoom, Summary, Assignment } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { Card, CardHeader, CardContent, CardFooter } from '../../components/ui/Card'
import { ClassCard } from '../../components/class/ClassCard'
import { CourseCard } from '../../components/course/CourseCard'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { SummaryReviewModal } from '../../components/summary/SummaryReviewModal'

export const TeacherDashboard: React.FC = () => {
  const { user } = useAuth()

  const [courses, setCourses] = useState<Course[]>([])
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [selectedSummary, setSelectedSummary] = useState<Summary | null>(null)
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [coursesData, classesData, summariesData, assignmentsData] = await Promise.allSettled([
        courseService.getCourses(),
        classService.getClasses(),
        summaryService.listSummaries(),
        assignmentService.getAssignments(),
      ])

      if (coursesData.status === 'fulfilled') setCourses(coursesData.value)
      if (classesData.status === 'fulfilled') setClasses(classesData.value)
      if (summariesData.status === 'fulfilled') setSummaries(summariesData.value)
      if (assignmentsData.status === 'fulfilled') setAssignments(assignmentsData.value)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleStartClass = async (classId: string) => {
    await classService.startClass(classId)
    loadData()
  }

  const handleEndClass = async (classId: string) => {
    await classService.endClass(classId)
    loadData()
  }

  const pendingSummaries = summaries.filter((s) => s.review_status === 'PENDING')
  const liveClasses = classes.filter((c) => c.status === 'LIVE')
  const upcomingClasses = classes.filter((c) => c.status === 'SCHEDULED')

  return (
    <PageContainer maxWidth="2xl">
      {/* Header Banner & Quick Action Bar */}
      <div className="mb-6 p-6 bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div>
          <span className="text-xs font-bold text-[#0F5B57] bg-[#DDF3EA] px-2.5 py-0.5 rounded-full uppercase tracking-wider inline-block mb-1.5 border border-[#CBD7D1]">
            Teacher Console
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">
            Welcome, {user?.full_name}
          </h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 leading-relaxed">
            Manage your courses, broadcast live audio/video sessions, and review AI summaries.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/teacher/courses/new">
            <Button size="sm" variant="outline" icon={<Plus className="w-3.5 h-3.5" />}>
              New Course
            </Button>
          </Link>
          <Link to="/teacher/classes/new">
            <Button size="sm" variant="outline" icon={<Calendar className="w-3.5 h-3.5" />}>
              Schedule Class
            </Button>
          </Link>
          <Link to="/teacher/materials">
            <Button size="sm" variant="secondary" icon={<Upload className="w-3.5 h-3.5" />}>
              Upload Material
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <div className="p-4 bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl shadow-xs">
          <p className="text-xs text-[#687775] font-medium">Active Courses</p>
          <p className="text-xl sm:text-2xl font-bold text-[#202B2A] mt-1">{courses.length}</p>
        </div>
        <div className="p-4 bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl shadow-xs">
          <p className="text-xs text-[#687775] font-medium">Live / Scheduled</p>
          <p className="text-xl sm:text-2xl font-bold text-[#202B2A] mt-1">
            {liveClasses.length + upcomingClasses.length}
          </p>
        </div>
        <div className="p-4 bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl shadow-xs">
          <p className="text-xs text-[#687775] font-medium">Pending Reviews</p>
          <p className="text-xl sm:text-2xl font-bold text-[#8A5700] mt-1">
            {pendingSummaries.length}
          </p>
        </div>
        <div className="p-4 bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl shadow-xs">
          <p className="text-xs text-[#687775] font-medium">Assignments</p>
          <p className="text-xl sm:text-2xl font-bold text-[#202B2A] mt-1">
            {assignments.length}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {/* Pending AI Summary Reviews Alert Section */}
        {pendingSummaries.length > 0 && (
          <section className="p-5 sm:p-6 bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#DDF3EA] border border-[#CBD7D1] flex items-center justify-center text-[#0F5B57]">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h2 className="text-base font-bold text-[#202B2A]">
                  AI Lecture Summaries Requiring Review ({pendingSummaries.length})
                </h2>
              </div>
              <Link to="/teacher/summaries" className="text-xs font-semibold text-[#0F5B57] hover:underline">
                View All
              </Link>
            </div>
            <p className="text-xs text-[#687775] mb-4 leading-relaxed">
              AI has synthesized lecture transcripts for completed sessions. Review and edit the key concepts and formulas before releasing to students.
            </p>

            <div className="flex flex-col gap-2.5">
              {pendingSummaries.slice(0, 2).map((sum) => (
                <div
                  key={sum.id}
                  className="p-3.5 bg-[#F1F5F2] border border-[#E1E8E4] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="warning" size="sm">
                        Needs Review
                      </Badge>
                      <span className="text-xs text-[#687775]">
                        {new Date(sum.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="font-semibold text-[#202B2A] line-clamp-1">{sum.overview}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setSelectedSummary(sum)
                      setIsReviewOpen(true)
                    }}
                  >
                    Review & Publish
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Classes to Start / Monitor */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#202B2A]">Classroom Sessions</h2>
              <p className="text-xs text-[#687775]">Start scheduled classrooms or enter live WebRTC rooms</p>
            </div>
            <Link to="/teacher/classes" className="text-xs font-semibold text-[#0F5B57] hover:underline flex items-center gap-1">
              All Sessions <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : classes.length === 0 ? (
            <div className="p-8 border border-dashed border-[#CBD7D1] rounded-2xl bg-[#F8FAF7] text-center text-xs text-[#687775]">
              No classes scheduled yet. Click 'Schedule Class' above to create one.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {classes.slice(0, 2).map((cls) => (
                <ClassCard
                  key={cls.id}
                  classroom={cls}
                  isTeacher={true}
                  onStart={handleStartClass}
                  onEnd={handleEndClass}
                />
              ))}
            </div>
          )}
        </section>

        {/* My Courses */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#202B2A]">Curriculum Management</h2>
              <p className="text-xs text-[#687775]">Add modules, manage lessons, and inspect student access</p>
            </div>
            <Link to="/teacher/courses" className="text-xs font-semibold text-[#0F5B57] hover:underline flex items-center gap-1">
              All Courses <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {courses.slice(0, 2).map((course) => (
              <CourseCard key={course.id} course={course} isTeacher={true} />
            ))}
          </div>
        </section>
      </div>

      <SummaryReviewModal
        summary={selectedSummary}
        isOpen={isReviewOpen}
        onClose={() => {
          setIsReviewOpen(false)
          setSelectedSummary(null)
        }}
        onSuccess={() => loadData()}
      />
    </PageContainer>
  )
}
