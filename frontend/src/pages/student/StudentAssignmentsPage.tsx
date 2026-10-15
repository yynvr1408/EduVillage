import React, { useState, useEffect } from 'react'
import { FileText, CheckCircle2, Clock, CloudUpload } from 'lucide-react'
import { assignmentService } from '../../services/assignmentService'
import { syncManager } from '../../services/syncManager'
import type { Assignment, AssignmentDraft } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { AssignmentCard } from '../../components/assignment/AssignmentCard'
import { SkeletonCard } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/EmptyState'

export const StudentAssignmentsPage: React.FC = () => {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>({})
  const [filter, setFilter] = useState<'all' | 'pending' | 'submitted'>('all')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      setIsLoading(true)
      try {
        const list = await assignmentService.getAssignments()
        if (!isMounted) return
        setAssignments(list)

        const draftMap: Record<string, AssignmentDraft> = {}
        for (const a of list) {
          const d = await syncManager.getDraft(a.id)
          if (d) draftMap[a.id] = d
        }
        if (isMounted) setDrafts(draftMap)
      } catch (err) {
        console.error(err)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadData()
    return () => {
      isMounted = false
    }
  }, [])

  const filtered = assignments.filter((a) => {
    const isSubmitted = Boolean(a.my_submission)
    if (filter === 'pending') return !isSubmitted
    if (filter === 'submitted') return isSubmitted
    return true
  })

  return (
    <PageContainer
      title="Assignments & Field Tasks"
      subtitle="Complete course assessments offline. Drafts are safely preserved on your device and synced idempotently."
    >
      {/* Filter Tabs */}
      <div className="flex items-center gap-2 mb-6">
        {(['all', 'pending', 'submitted'] as const).map((tab) => (
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
            {tab === 'all' ? 'All Assignments' : tab}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-6 h-6" />}
          title="No assignments found"
          description={`No assignments found under the '${filter}' filter.`}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((a) => (
            <AssignmentCard key={a.id} assignment={a} draft={drafts[a.id]} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
