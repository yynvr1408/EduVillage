import React, { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { Textarea } from '../ui/Textarea'
import type { Summary } from '../../types'
import { summaryService } from '../../services/summaryService'

export interface SummaryReviewModalProps {
  summary: Summary | null
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export const SummaryReviewModal: React.FC<SummaryReviewModalProps> = ({
  summary,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [overview, setOverview] = useState(summary?.overview || '')
  const [teacherNotes, setTeacherNotes] = useState(summary?.teacher_notes || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!summary) return null

  const handleReview = async (action: 'APPROVE' | 'REVISE') => {
    setIsSubmitting(true)
    setError(null)
    try {
      await summaryService.reviewSummary(summary.id, {
        action,
        overview,
        teacher_notes: teacherNotes,
        key_concepts: summary.key_concepts,
        revision_questions: summary.revision_questions,
      })
      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to update review status')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Review AI Lecture Summary"
      description="Verify and edit the synthesized overview, formulas, and revision questions before publishing to students."
      maxWidth="lg"
    >
      <div className="flex flex-col gap-4 text-xs">
        {error && (
          <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#B42318]/30 rounded-lg font-medium">
            {error}
          </div>
        )}

        <FormField label="Lecture Overview & Core Themes">
          <Textarea
            value={overview}
            onChange={(e) => setOverview(e.target.value)}
            rows={5}
            placeholder="Edit lecture summary overview..."
          />
        </FormField>

        <FormField label="Teacher Notes & Guidance">
          <Textarea
            value={teacherNotes}
            onChange={(e) => setTeacherNotes(e.target.value)}
            rows={3}
            placeholder="Add specific hints or instructions for students..."
          />
        </FormField>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E1E8E4]">
          <Button
            size="sm"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => handleReview('REVISE')}
          >
            Request Revision
          </Button>

          <Button
            size="sm"
            variant="primary"
            isLoading={isSubmitting}
            onClick={() => handleReview('APPROVE')}
          >
            Approve & Publish
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
