import React, { useState, useEffect } from 'react'
import { Sparkles, CheckCircle2, Clock, AlertTriangle, Edit3, Wand2 } from 'lucide-react'
import { summaryService } from '../../services/summaryService'
import type { Summary } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { SummaryViewer } from '../../components/summary/SummaryViewer'
import { SummaryReviewModal } from '../../components/summary/SummaryReviewModal'
import { GenerateSummaryModal } from '../../components/summary/GenerateSummaryModal'
import { Badge, Button, LoadingState, EmptyState } from '../../components/ui'

export const TeacherSummariesPage: React.FC = () => {
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [selectedSummary, setSelectedSummary] = useState<Summary | null>(null)
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [isGenerateOpen, setIsGenerateOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const loadSummaries = async () => {
    setIsLoading(true)
    try {
      const list = await summaryService.listSummaries()
      setSummaries(list)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadSummaries()
  }, [])

  return (
    <PageContainer
      title="AI Lecture Summaries & Teacher Review"
      subtitle="Review machine-generated lecture overviews, key concepts, and revision questions before publishing to students."
      action={
        <Button size="sm" variant="primary" icon={<Wand2 className="w-3.5 h-3.5" />} onClick={() => setIsGenerateOpen(true)}>
          Generate Summary
        </Button>
      }
    >
      {isLoading ? (
        <LoadingState message="Loading synthesized lecture summaries..." />
      ) : summaries.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="w-6 h-6" />}
          title="No lecture summaries generated"
          description="Summaries are generated when a live classroom session concludes."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {summaries.map((sum) => (
            <div
              key={sum.id}
              className="p-5 bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl flex flex-col gap-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E1E8E4]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-[#202B2A]">
                    Class Session: {sum.class_id}
                  </span>
                  <Badge
                    variant={
                      sum.review_status === 'APPROVED'
                        ? 'success'
                        : sum.review_status === 'REVISION_REQUESTED'
                        ? 'warning'
                        : 'secondary'
                    }
                    size="sm"
                  >
                    {sum.review_status === 'APPROVED'
                      ? 'Approved by Teacher'
                      : sum.review_status === 'REVISION_REQUESTED'
                      ? 'Revision Requested'
                      : 'Pending Teacher Review'}
                  </Badge>
                </div>

                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setSelectedSummary(sum)
                    setIsReviewOpen(true)
                  }}
                  icon={<Edit3 className="w-3.5 h-3.5" />}
                >
                  Review & Edit Notes
                </Button>
              </div>

              {/* Render structured SummaryViewer inside */}
              <SummaryViewer
                summary={sum}
                isTeacher={true}
                onReview={() => {
                  setSelectedSummary(sum)
                  setIsReviewOpen(true)
                }}
              />
            </div>
          ))}
        </div>
      )}

      <SummaryReviewModal
        summary={selectedSummary}
        isOpen={isReviewOpen}
        onClose={() => {
          setIsReviewOpen(false)
          setSelectedSummary(null)
        }}
        onSuccess={() => loadSummaries()}
      />

      <GenerateSummaryModal
        isOpen={isGenerateOpen}
        onClose={() => setIsGenerateOpen(false)}
        onSuccess={() => {
          setIsGenerateOpen(false)
          loadSummaries()
        }}
      />
    </PageContainer>
  )
}
