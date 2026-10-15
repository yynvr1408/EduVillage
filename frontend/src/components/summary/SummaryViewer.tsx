import React from 'react'
import {
  Sparkles,
  Download,
  CheckCircle2,
  Clock,
  AlertCircle,
  HelpCircle,
  BookMarked,
  Lightbulb,
  FileText,
} from 'lucide-react'
import type { Summary } from '../../types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, CardHeader, CardContent } from '../ui/Card'

export interface SummaryViewerProps {
  summary: Summary
  isCompact?: boolean
  onReview?: () => void
  isTeacher?: boolean
}

export const SummaryViewer: React.FC<SummaryViewerProps> = ({
  summary,
  isCompact = false,
  onReview,
  isTeacher = false,
}) => {
  const isApproved = summary.review_status === 'APPROVED'
  const isPendingReview = summary.review_status === 'PENDING'
  const isRevisionRequested = summary.review_status === 'REVISION_REQUESTED'

  const handleDownload = () => {
    let md = `# EduVillage Lecture Summary\nClass Session: ${summary.class_id}\nDate: ${new Date(
      summary.created_at
    ).toLocaleDateString()}\nStatus: ${summary.review_status}\n\n## Overview\n${
      summary.overview || 'N/A'
    }\n\n`

    if (summary.key_concepts && summary.key_concepts.length > 0) {
      md += `## Key Concepts\n${summary.key_concepts.map((c) => `- ${c}`).join('\n')}\n\n`
    }

    if (summary.definitions && summary.definitions.length > 0) {
      md += `## Definitions\n${summary.definitions
        .map((d) => `### ${d.term}\n${d.definition}`)
        .join('\n\n')}\n\n`
    }

    if (summary.examples && summary.examples.length > 0) {
      md += `## Practical Examples\n${summary.examples.map((e) => `- ${e}`).join('\n')}\n\n`
    }

    if (summary.revision_questions && summary.revision_questions.length > 0) {
      md += `## Revision Questions\n${summary.revision_questions
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n')}\n\n`
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eduvillage-summary-${summary.class_id}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`flex flex-col gap-4 ${isCompact ? 'text-xs' : 'text-sm'}`}>
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#111111]" />
          <span className="font-semibold text-[#111111]">
            {isCompact ? 'Live Lecture Notes' : 'AI-Assisted Lecture Summary'}
          </span>
          <Badge
            variant={
              isApproved ? 'success' : isRevisionRequested ? 'warning' : 'secondary'
            }
            size="sm"
          >
            {isApproved ? 'Teacher Approved' : isRevisionRequested ? 'Revision Requested' : 'Pending Review'}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            icon={<Download className="w-3.5 h-3.5" />}
          >
            Download Notes
          </Button>

          {isTeacher && onReview && (
            <Button size="sm" variant="primary" onClick={onReview}>
              Review & Edit
            </Button>
          )}
        </div>
      </div>

      {/* Teacher notice banner */}
      {!isApproved && (
        <div className="p-3 bg-[#854D0E]/10 border border-[#854D0E]/30 rounded-md text-xs text-[#854D0E] flex items-center gap-2">
          <Clock className="w-4 h-4 shrink-0" />
          <span>
            {isPendingReview
              ? 'This summary was synthesized from the lecture audio and is pending teacher validation.'
              : 'The teacher has requested revisions for this lecture recap.'}
          </span>
        </div>
      )}

      {/* Overview */}
      {summary.overview && (
        <Card>
          <CardHeader className="py-2.5 px-4 font-semibold text-xs text-[#666666] flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#111111]" />
            Overview
          </CardHeader>
          <CardContent className="py-3 px-4 text-[#111111] leading-relaxed">
            {summary.overview}
          </CardContent>
        </Card>
      )}

      {/* Key Concepts */}
      {summary.key_concepts && summary.key_concepts.length > 0 && (
        <Card>
          <CardHeader className="py-2.5 px-4 font-semibold text-xs text-[#666666] flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-[#111111]" />
            Key Concepts
          </CardHeader>
          <CardContent className="py-3 px-4">
            <ul className="list-disc pl-5 flex flex-col gap-1.5 text-[#111111]">
              {summary.key_concepts.map((concept, idx) => (
                <li key={idx} className="leading-relaxed">
                  {concept}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Definitions */}
      {summary.definitions && summary.definitions.length > 0 && (
        <Card>
          <CardHeader className="py-2.5 px-4 font-semibold text-xs text-[#666666] flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-[#111111]" />
            Key Definitions & Terms
          </CardHeader>
          <CardContent className="py-3 px-4 flex flex-col gap-2.5">
            {summary.definitions.map((item, idx) => (
              <div key={idx} className="border-b border-[#F5F5F5] pb-2 last:border-0 last:pb-0">
                <span className="font-semibold text-[#111111] block mb-0.5">{item.term}</span>
                <p className="text-xs text-[#666666] leading-relaxed">{item.definition}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Revision Questions */}
      {summary.revision_questions && summary.revision_questions.length > 0 && (
        <Card>
          <CardHeader className="py-2.5 px-4 font-semibold text-xs text-[#666666] flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-[#111111]" />
            Revision & Self-Assessment Questions
          </CardHeader>
          <CardContent className="py-3 px-4">
            <ol className="list-decimal pl-5 flex flex-col gap-2 text-[#111111]">
              {summary.revision_questions.map((q, idx) => (
                <li key={idx} className="leading-relaxed pl-1">
                  {q}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
