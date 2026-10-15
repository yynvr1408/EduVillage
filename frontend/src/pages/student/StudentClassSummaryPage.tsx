import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Sparkles, AlertCircle } from 'lucide-react'
import { summaryService } from '../../services/summaryService'
import { downloadManager } from '../../services/downloadManager'
import { classService } from '../../services/classService'
import type { Summary, ClassRoom } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { SummaryViewer } from '../../components/summary/SummaryViewer'
import { LoadingState, ErrorState, Button, Badge } from '../../components/ui'

export const StudentClassSummaryPage: React.FC = () => {
  const { classId } = useParams<{ classId: string }>()

  const [summary, setSummary] = useState<Summary | null>(null)
  const [classroom, setClassroom] = useState<ClassRoom | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savedOffline, setSavedOffline] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      if (!classId) return
      setIsLoading(true)
      setError(null)
      try {
        const [sum, cls] = await Promise.allSettled([
          summaryService.getClassSummary(classId),
          classService.getClassById(classId),
        ])

        if (!isMounted) return
        if (sum.status === 'fulfilled') {
          setSummary(sum.value)
          setSavedOffline(Boolean(await downloadManager.getDownloadedSummaryForClass(classId)))
        }
        else setError('No lecture summary is available yet for this class.')

        if (cls.status === 'fulfilled') setClassroom(cls.value)
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to load lecture summary')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadData()
    return () => {
      isMounted = false
    }
  }, [classId])

  if (isLoading) {
    return (
      <PageContainer>
        <LoadingState message="Retrieving lecture summary and revision notes..." />
      </PageContainer>
    )
  }

  if (error || !summary) {
    return (
      <PageContainer>
        <div className="mb-4">
          <Link
            to="/student/classes"
            className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Classes
          </Link>
        </div>
        <ErrorState
          title="Summary Not Yet Generated"
          message={error || 'The teacher has not yet generated or published the summary for this lecture.'}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer maxWidth="lg">
      <div className="mb-4">
        <Link
          to="/student/classes"
          className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Classes
        </Link>
      </div>

      <div className="mb-6">
        <span className="text-xs font-mono text-[#687775] uppercase tracking-wider block mb-1">
          {classroom?.course_code || 'EDU'} • Lecture Recap
        </span>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#202B2A]">
          {classroom?.title || 'Lecture Summary'}
        </h1>
        <p className="text-xs text-[#687775] mt-1">
          Generated from live session recording and verified by instructor. Available offline.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        {savedOffline ? (
          <>
            <Badge variant="success" size="sm">Available offline</Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await downloadManager.deleteDownloadedSummary(summary.id)
                setSavedOffline(false)
              }}
            >
              Remove from device
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              setSaveError(null)
              try {
                await downloadManager.downloadSummary(summary, classroom?.title)
                setSavedOffline(true)
              } catch (err: any) {
                setSaveError(err.message || 'Could not save this summary for offline use')
              }
            }}
          >
            Save for offline
          </Button>
        )}
        {saveError && <span className="text-xs text-[#B42318]">{saveError}</span>}
      </div>

      <SummaryViewer summary={summary} isTeacher={false} />
    </PageContainer>
  )
}
