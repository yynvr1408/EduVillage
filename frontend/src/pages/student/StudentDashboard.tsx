import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  Video,
  FileText,
  DownloadCloud,
  ArrowRight,
  Wifi,
  WifiOff,
  Clock,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  HardDrive,
  Play,
  PlayCircle,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useNetworkStatus } from '../../context/NetworkContext'
import { useSync } from '../../context/SyncContext'
import { courseService } from '../../services/courseService'
import { classService } from '../../services/classService'
import { assignmentService } from '../../services/assignmentService'
import { downloadManager } from '../../services/downloadManager'
import { syncManager } from '../../services/syncManager'
import type { Course, ClassRoom, Assignment, DownloadedResource, AssignmentDraft, Recording } from '../../types'
import { api } from '../../services/apiClient'
import { PageContainer } from '../../components/layout/PageContainer'
import { CourseCard } from '../../components/course/CourseCard'
import { ClassCard } from '../../components/class/ClassCard'
import { AssignmentCard } from '../../components/assignment/AssignmentCard'
import { Card, CardHeader, CardContent } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'

export const StudentDashboard: React.FC = () => {
  const { user } = useAuth()
  const { isOnline, quality, latencyMs } = useNetworkStatus()
  const { pendingCount, syncNow, isSyncing } = useSync()

  const [courses, setCourses] = useState<Course[]>([])
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [downloads, setDownloads] = useState<DownloadedResource[]>([])
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>({})
  const [isLoading, setIsLoading] = useState<boolean>(true)

  useEffect(() => {
    let isMounted = true

    async function loadDashboard() {
      setIsLoading(true)
      try {
        const [coursesData, classesData, recordingsData, assignmentsData, downloadsData] = await Promise.allSettled([
          courseService.getCourses(),
          classService.getClasses(),
          api.getRecordings(),
          assignmentService.getAssignments(),
          downloadManager.getAllDownloads(),
        ])

        if (!isMounted) return

        if (coursesData.status === 'fulfilled') setCourses(coursesData.value)
        if (classesData.status === 'fulfilled') setClasses(classesData.value)
        if (recordingsData.status === 'fulfilled') setRecordings(recordingsData.value)
        if (assignmentsData.status === 'fulfilled') setAssignments(assignmentsData.value)
        if (downloadsData.status === 'fulfilled') setDownloads(downloadsData.value)

        // Load local drafts
        if (assignmentsData.status === 'fulfilled') {
          const draftMap: Record<string, AssignmentDraft> = {}
          for (const a of assignmentsData.value) {
            const d = await syncManager.getDraft(a.id)
            if (d) draftMap[a.id] = d
          }
          if (isMounted) setDrafts(draftMap)
        }
      } catch (err) {
        console.error('Dashboard load error:', err)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadDashboard()
    return () => {
      isMounted = false
    }
  }, [])

  const liveClasses = classes.filter((c) => c.status === 'LIVE')
  const upcomingClasses = classes.filter((c) => c.status === 'SCHEDULED').slice(0, 2)
  const pendingAssignments = assignments.filter((a) => !a.my_submission).slice(0, 3)

  return (
    <PageContainer maxWidth="2xl">
      {/* Welcome & Connectivity State Banner */}
      <div className="mb-6 p-5 sm:p-6 bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-bold text-[#0F5B57] bg-[#DDF3EA] px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-[#CBD7D1]">
              Student Workspace
            </span>
            <Badge variant={isOnline ? 'success' : 'warning'} size="sm">
              {isOnline ? 'Online' : 'Offline Mode'}
            </Badge>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#202B2A]">
            Welcome back, {user?.full_name || 'Student'}
          </h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 leading-relaxed">
            {isOnline
              ? `Connected to EduVillage. Latency: ${latencyMs}ms (${quality}). All features active.`
              : 'Working offline. Saved downloads and local assignment drafts remain fully accessible.'}
          </p>
        </div>

        {/* Quick Sync & Offline Status Widget */}
        <div className="flex items-center gap-3 shrink-0 self-start md:self-auto">
          {pendingCount > 0 ? (
            <div className="flex items-center gap-2.5 p-2.5 px-3 bg-[#F1F5F2] border border-[#E1E8E4] rounded-xl text-xs">
              <Clock className="w-4 h-4 text-[#8A5700]" />
              <div>
                <p className="font-semibold text-[#202B2A]">{pendingCount} Waiting to Sync</p>
                <p className="text-[10px] text-[#687775]">Local drafts queued</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!isOnline || isSyncing}
                isLoading={isSyncing}
                onClick={() => syncNow()}
              >
                Sync
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 p-2.5 px-3.5 bg-[#F1F5F2] border border-[#E1E8E4] rounded-xl text-xs">
              <CheckCircle2 className="w-4 h-4 text-[#247A4D]" />
              <div>
                <p className="font-semibold text-[#202B2A]">Up to Date</p>
                <p className="text-[10px] text-[#687775]">{downloads.length} items offline</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live Class Alert (If any class is actively LIVE) */}
      {liveClasses.length > 0 && (
        <div className="mb-8 p-5 sm:p-6 bg-[#0F5B57] text-[#FFFFFF] rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3.5">
            <span className="w-3.5 h-3.5 rounded-full bg-[#E5F5EB] border-2 border-[#247A4D] animate-ping shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="live" size="sm">
                  LIVE CLASS NOW
                </Badge>
                <span className="text-xs text-[#DDF3EA] font-mono">{liveClasses[0].course_code}</span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-[#FFFFFF] mt-1">
                {liveClasses[0].title}
              </h2>
              <p className="text-xs text-[#DDF3EA] opacity-90">Instructor: {liveClasses[0].teacher_name}</p>
            </div>
          </div>

          <Link to={`/classroom/${liveClasses[0].id}`}>
            <Button size="md" variant="secondary" icon={<Video className="w-4 h-4" />}>
              Join Classroom Now
            </Button>
          </Link>
        </div>
      )}

      {/* Main Grid: Courses, Classes & Tasks */}
      <div className="flex flex-col gap-8">
        {/* Enrolled Courses */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#202B2A]">My Enrolled Courses</h2>
              <p className="text-xs text-[#687775]">Access curriculum modules, lessons, and offline assets</p>
            </div>
            <Link to="/student/courses" className="text-xs font-semibold text-[#0F5B57] hover:underline flex items-center gap-1">
              Browse All <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : courses.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="w-6 h-6" />}
              title="No courses found"
              description="Courses will appear here once loaded or when online connectivity returns."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {courses.slice(0, 2).map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>
          )}
        </section>

        {/* Upcoming Classes */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#202B2A]">Live Classes Timetable</h2>
              <p className="text-xs text-[#687775]">Join sessions or review synthesized lecture summaries</p>
            </div>
            <Link to="/student/classes" className="text-xs font-semibold text-[#0F5B57] hover:underline flex items-center gap-1">
              Full Schedule <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : classes.length === 0 ? (
            <EmptyState
              icon={<Video className="w-6 h-6" />}
              title="No classes scheduled"
              description="Upcoming interactive lectures will be posted by your teachers."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {classes.slice(0, 2).map((cls) => (
                <ClassCard key={cls.id} classroom={cls} />
              ))}
            </div>
          )}
        </section>

        {/* Recent Recorded Lessons */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#202B2A]">Recent Recorded Lessons</h2>
              <p className="text-xs text-[#687775]">Watch lecture replays, read AI summaries, or download for offline revision</p>
            </div>
            <Link to="/student/recorded-lessons" className="text-xs font-semibold text-[#0F5B57] hover:underline flex items-center gap-1">
              All Recordings <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : recordings.length === 0 ? (
            <EmptyState
              icon={<PlayCircle className="w-6 h-6" />}
              title="No recorded lessons available"
              description="Recordings will appear here after live lectures or when published by your teachers."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recordings.slice(0, 2).map((rec) => (
                <div
                  key={rec.id}
                  className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl p-4 sm:p-5 flex flex-col justify-between hover:border-[#CBD7D1] transition-all shadow-xs"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 bg-[#DDF3EA] border border-[#CBD7D1] rounded text-[#0F5B57]">
                        {rec.course_code || 'Recorded'}
                      </span>
                      <Badge variant={rec.status === 'READY' ? 'success' : 'default'} size="sm">
                        {rec.status === 'READY' ? 'Ready to watch' : 'Processing'}
                      </Badge>
                    </div>

                    <h3 className="font-bold text-sm sm:text-base text-[#202B2A] line-clamp-2">
                      {rec.title}
                    </h3>

                    <div className="flex items-center gap-3 text-xs text-[#687775] flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[#687775]" />
                        {Math.floor(rec.duration_seconds / 60)} min
                      </span>
                      {rec.transcript && (
                        <span className="flex items-center gap-1 text-[#202B2A]">
                          <FileText className="w-3.5 h-3.5 text-[#687775]" /> Transcript
                        </span>
                      )}
                      {rec.summary && (
                        <span className="flex items-center gap-1 text-[#0F5B57] font-medium">
                          <Sparkles className="w-3.5 h-3.5 text-[#0F5B57]" /> AI Summary
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[#E1E8E4] flex items-center justify-between">
                    <span className="text-xs text-[#687775]">
                      {rec.user_progress_seconds && rec.user_progress_seconds > 0
                        ? `Resume at ${Math.floor(rec.user_progress_seconds / 60)}m`
                        : 'Not started'}
                    </span>
                    <Link to={`/student/recorded-lessons/${rec.id}`}>
                      <Button size="sm" variant="primary" icon={<Play className="w-3.5 h-3.5" />}>
                        {rec.user_progress_seconds && rec.user_progress_seconds > 0 ? 'Resume' : 'Watch'}
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Pending Assignments & Local Drafts */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#202B2A]">Pending Assignments</h2>
              <p className="text-xs text-[#687775]">Complete and save drafts offline; syncs automatically when online</p>
            </div>
            <Link to="/student/assignments" className="text-xs font-semibold text-[#0F5B57] hover:underline flex items-center gap-1">
              All Assignments <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : pendingAssignments.length === 0 ? (
            <div className="p-6 border border-[#E1E8E4] rounded-2xl bg-[#FFFFFF] text-center text-xs text-[#687775]">
              <CheckCircle2 className="w-8 h-8 mx-auto text-[#247A4D] mb-2" />
              All assignments have been submitted. Great job!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingAssignments.map((a) => (
                <AssignmentCard key={a.id} assignment={a} draft={drafts[a.id]} />
              ))}
            </div>
          )}
        </section>

        {/* Offline Resources Section */}
        <section className="p-5 bg-[#F1F5F2] border border-[#E1E8E4] rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#DDF3EA] border border-[#CBD7D1] flex items-center justify-center text-[#0F5B57] shrink-0">
              <DownloadCloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#202B2A]">Offline Learning Hub</h3>
              <p className="text-xs text-[#687775]">
                You have {downloads.length} resource{downloads.length === 1 ? '' : 's'} saved on this device for offline study.
              </p>
            </div>
          </div>

          <Link to="/student/downloads">
            <Button size="sm" variant="outline">
              Manage Downloads
            </Button>
          </Link>
        </section>
      </div>
    </PageContainer>
  )
}
