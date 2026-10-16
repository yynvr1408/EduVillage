import React, { useState, useEffect } from 'react'
import { Video, Calendar, Filter } from 'lucide-react'
import { classService } from '../../services/classService'
import type { ClassRoom } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { ClassCard } from '../../components/class/ClassCard'
import { Badge } from '../../components/ui/Badge'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'

export const StudentClassesPage: React.FC = () => {
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [filter, setFilter] = useState<'all' | 'live' | 'scheduled' | 'ended'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    classService
      .getClasses()
      .then((data) => {
        if (isMounted) setClasses(data)
      })
      .catch((err) => {
        console.error(err)
        if (isMounted) setLoadError('Could not load your classes. Please try again.')
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const filtered = classes.filter((c) => {
    if (filter === 'live') return c.status === 'LIVE'
    if (filter === 'scheduled') return c.status === 'SCHEDULED'
    if (filter === 'ended') return c.status === 'ENDED'
    return true
  })

  // Branch-wide classes (created by an "All Sections" teacher) live in their own "Other Classes" section; every
  // class is in exactly one of the two lists, so nothing can appear twice.
  const mainClasses = filtered.filter((c) => !c.branch_id)
  const otherClasses = filtered.filter((c) => !!c.branch_id)
  const cardGrid = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4'

  return (
    <PageContainer
      title="Live Classroom Sessions"
      subtitle="Join real-time WebRTC audio/video sessions or read synthesized lecture summaries."
    >
      {/* Filter Tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {(['all', 'live', 'scheduled', 'ended'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer shrink-0 ${
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
          <SkeletonCard />
        </div>
      ) : loadError ? (
        <EmptyState icon={<Video className="w-6 h-6" />} title="Classes unavailable" description={loadError} />
      ) : (
        <>
          {mainClasses.length === 0 && otherClasses.length === 0 ? (
            <EmptyState
              icon={<Video className="w-6 h-6" />}
              title="No sessions found"
              description={`No classes match the filter '${filter}'.`}
            />
          ) : (
            mainClasses.length > 0 && (
              <div className={cardGrid}>
                {mainClasses.map((cls) => (
                  <ClassCard key={cls.id} classroom={cls} />
                ))}
              </div>
            )
          )}

          <section aria-labelledby="other-classes-heading" className="mt-8" data-testid="other-classes">
            <h2 id="other-classes-heading" className="text-base font-bold text-[#202B2A] mb-1">
              Other Classes
            </h2>
            <p className="text-xs text-[#687775] mb-4">Classes from teachers who teach every section of your branch.</p>
            {otherClasses.length === 0 ? (
              <p className="text-sm text-[#687775]">No other classes right now.</p>
            ) : (
              <div className={cardGrid}>
                {otherClasses.map((cls) => (
                  <ClassCard key={cls.id} classroom={cls} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </PageContainer>
  )
}
