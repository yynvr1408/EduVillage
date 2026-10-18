import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Clock, Eye, Wand2 } from 'lucide-react'
import { summaryService } from '../../services/summaryService'
import type { Summary } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { GenerateSummaryModal } from '../../components/summary/GenerateSummaryModal'
import { Card, Badge, Button, LoadingState, EmptyState } from '../../components/ui'

export const TeacherSummariesPage: React.FC = () => {
  const [summaries, setSummaries] = useState<Summary[]>([])
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
        <div className="space-y-3">
          {summaries.map((sum) => (
            <Card key={sum.id} className="p-4 sm:p-5 border border-[#E1E8E4]">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-7 h-7 rounded-lg bg-[#DDF3EA] border border-[#CBD7D1] flex items-center justify-center text-[#0F5B57] shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </span>
                    <span className="font-semibold text-sm text-[#202B2A]">
                      Session #{sum.class_id.slice(0, 8)}
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
                        ? 'Approved'
                        : sum.review_status === 'REVISION_REQUESTED'
                        ? 'Revision Requested'
                        : 'Pending Review'}
                    </Badge>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs text-[#687775] pl-9">
                    <Clock className="w-3.5 h-3.5" />
                    Generated {new Date(sum.created_at).toLocaleDateString()}
                  </span>
                </div>

                <Link to={`/teacher/summaries/${sum.class_id}`}>
                  <Button size="sm" variant="outline" icon={<Eye className="w-3.5 h-3.5" />}>
                    View Summary
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

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
