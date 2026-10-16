import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Video, Calendar } from 'lucide-react'
import { classService } from '../../services/classService'
import type { ClassRoom } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { ClassCard } from '../../components/class/ClassCard'
import { Button } from '../../components/ui/Button'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'

type Filter = 'upcoming' | 'ended' | 'all'

// A scheduled class is going live any moment and a live one needs to be rejoined - a teacher
// checking in on this page wants both together, at a glance, separate from classes that are done.
const FILTER_LABELS: Record<Filter, string> = { upcoming: 'Live & Scheduled', ended: 'Ended', all: 'All Classes' }

export const TeacherClassesPage: React.FC = () => {
  const navigate = useNavigate()
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [filter, setFilter] = useState<Filter>('upcoming')
  const [isLoading, setIsLoading] = useState(true)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadClasses = async () => {
    setIsLoading(true)
    try {
      const list = await classService.getClasses()
      setClasses(list)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadClasses()
  }, [])

  // Starting IS joining, from the teacher's side: go straight into the room instead of waiting
  // on a full list refresh just to show a second "Enter Room" button to click.
  const handleStartClass = async (classId: string) => {
    setActionError(null)
    setStartingId(classId)
    try {
      await classService.startClass(classId)
      navigate(`/classroom/${classId}`)
    } catch (err: any) {
      setActionError(err.message || 'Could not start this class.')
      setStartingId(null)
    }
  }

  const handleEndClass = async (classId: string) => {
    await classService.endClass(classId)
    loadClasses()
  }

  const handleCancelClass = async (classId: string) => {
    await classService.cancelClass(classId)
    loadClasses()
  }

  const filtered = classes
    .filter((c) => {
      if (filter === 'upcoming') return c.status === 'LIVE' || c.status === 'SCHEDULED'
      if (filter === 'ended') return c.status === 'ENDED'
      return true
    })
    // Within the combined tab, a class already live (needs rejoining now) outranks one merely scheduled.
    .sort((a, b) => (filter === 'upcoming' ? Number(b.status === 'LIVE') - Number(a.status === 'LIVE') : 0))

  return (
    <PageContainer
      title="Classroom Sessions"
      subtitle="Schedule upcoming LiveKit sessions, broadcast low-bandwidth video/audio, and manage lecture status."
      action={
        <Link to="/teacher/classes/new">
          <Button size="sm" variant="primary" icon={<Plus className="w-4 h-4" />}>
            Schedule Class
          </Button>
        </Link>
      }
    >
      {/* Filter Tabs */}
      <div className="flex items-center gap-2 mb-6">
        {(['upcoming', 'ended', 'all'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
              filter === tab
                ? 'bg-[#0F5B57] text-[#FFFFFF]'
                : 'bg-[#F1F5F2] text-[#687775] hover:text-[#0F5B57] hover:bg-[#DDF3EA] border border-[#E1E8E4]'
            }`}
          >
            {FILTER_LABELS[tab]}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-xs text-[#B42318]">
          {actionError}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Video className="w-6 h-6" />}
          title="No class sessions found"
          description={`No classes under '${FILTER_LABELS[filter]}'. Click 'Schedule Class' to add a session.`}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">
          {filtered.map((cls) => (
            <ClassCard
              key={cls.id}
              classroom={cls}
              isTeacher={true}
              onStart={handleStartClass}
              onEnd={handleEndClass}
              onCancel={handleCancelClass}
              isStarting={startingId === cls.id}
            />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
