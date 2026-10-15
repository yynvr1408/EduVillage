import React, { useEffect, useState } from 'react'
import { FileText, WifiOff } from 'lucide-react'
import { summaryService } from '../../services/summaryService'
import { SummaryViewer } from '../summary/SummaryViewer'
import { LoadingState } from '../ui'
import type { Summary } from '../../types'

export interface TextFallbackPanelProps {
  classId: string
}

/**
 * Shown when the connection is too weak to sustain even audio-only mode (sustained "Lost"
 * quality while already audio-only — see useAdaptiveAudio's severeDegradation). Reads the most
 * recently approved lecture summary through summaryService, which already falls back through an
 * explicitly-downloaded copy and a passively-cached one, so this keeps working even if the live
 * API call itself fails. This is deliberately NOT a live, word-by-word transcript of what the
 * teacher is saying right now — it's the latest already-generated summary, offered as a reading
 * fallback so the student has something concrete instead of silence.
 */
export const TextFallbackPanel: React.FC<TextFallbackPanelProps> = ({ classId }) => {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasSummary, setHasSummary] = useState(false)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    summaryService
      .getClassSummary(classId)
      .then((s) => {
        if (!active) return
        setSummary(s)
        setHasSummary(true)
      })
      .catch(() => {
        if (active) setHasSummary(false)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [classId])

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 overflow-y-auto">
      <div className="max-w-lg w-full">
        <div className="flex items-center gap-2 mb-4 text-[#C9D3D0]">
          <WifiOff className="w-5 h-5 text-[#2364AA]" />
          <p className="text-xs">
            <strong className="text-white">Connection too weak for audio right now.</strong> Showing the latest
            lecture summary so you can keep following along. Audio/video will resume automatically once the
            connection recovers.
          </p>
        </div>

        <div className="bg-white rounded-xl p-4 sm:p-5 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <LoadingState message="Checking for a lecture summary..." />
          ) : hasSummary && summary ? (
            <SummaryViewer summary={summary} isCompact isTeacher={false} />
          ) : (
            <div className="text-center py-10 text-[#687775] text-xs flex flex-col items-center gap-2">
              <FileText className="w-8 h-8 text-[#0F5B57]" />
              <p>No summary is available yet for this session.</p>
              <p>We'll keep trying to restore audio in the background.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
