import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Video, Calendar } from 'lucide-react'
import { classService } from '../../services/classService'
import type { ClassRoom } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { ClassCard } from '../../components/class/ClassCard'
import { Button } from '../../components/ui/Button'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'

export const TeacherClassesPage: React.FC = () => {
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [filter, setFilter] = useState<'all' | 'live' | 'scheduled' | 'ended'>('all')
  const [isLoading, setIsLoading] = useState(true)

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

  const handleStartClass = async (classId: string) => {
    await classService.startClass(classId)
    loadClasses()
  }

  const handleEndClass = async (classId: string) => {
    await classService.endClass(classId)
    loadClasses()
  }

  const handleCancelClass = async (classId: string) => {
    await classService.cancelClass(classId)
    loadClasses()
  }

  const filtered = classes.filter((c) => {
    if (filter === 'live') return c.status === 'LIVE'
    if (filter === 'scheduled') return c.status === 'SCHEDULED'
    if (filter === 'ended') return c.status === 'ENDED'
    return true
  })

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
        {(['all', 'live', 'scheduled', 'ended'] as const).map((tab) => (
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
            {tab === 'all' ? 'All Classes' : tab}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Video className="w-6 h-6" />}
          title="No class sessions found"
          description={`No classes match '${filter}'. Click 'Schedule Class' to add a session.`}
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
            />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
