import React, { useEffect, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'
import { classService } from '../../services/classService'
import { summaryService } from '../../services/summaryService'
import type { ClassRoom } from '../../types'

export interface GenerateSummaryModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const JOB_ERROR_MESSAGES: Record<string, string> = {
  STT_NOT_CONFIGURED: 'Speech-to-text is not configured on the server (SPEECH_TO_TEXT_API_KEY is unset).',
  NO_TRANSCRIPT_SOURCE: 'The recording has no stored media to transcribe.',
  MISSING_RECORDS: 'The summary job lost track of its transcript — try generating again.',
  LLM_ERROR: 'The AI summarization call failed. This is usually transient — try again.',
  UNEXPECTED_ERROR: 'An unexpected server error occurred while generating the summary.',
}

const POLL_INTERVAL_MS = 1500
const POLL_MAX_ATTEMPTS = 20 // ~30s — real transcription (R2 fetch + Whisper + Groq) can take a while

/**
 * Teacher-triggered summary generation. There is no automatic trigger when a class ends, so this
 * is the only way a summary ever gets created.
 *
 * Transcript text is optional: leaving it blank tells apiClient.createSummaryJob to find the
 * class's ready recording and transcribe its real audio (OpenAI Whisper) before summarizing —
 * the actual "from what the teacher said" pipeline. Typing/pasting a transcript instead bypasses
 * that and summarizes the typed text directly, which is useful when no recording exists yet.
 */
export const GenerateSummaryModal: React.FC<GenerateSummaryModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [classId, setClassId] = useState('')
  const [transcript, setTranscript] = useState('')
  const [isLoadingClasses, setIsLoadingClasses] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'form' | 'polling' | 'completed' | 'failed'>('form')

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setPhase('form')
    setTranscript('')
    setIsLoadingClasses(true)
    classService
      .getClasses()
      .then((list) => {
        setClasses(list)
        setClassId(list[0]?.id ?? '')
      })
      .catch(() => setError('Could not load your classes.'))
      .finally(() => setIsLoadingClasses(false))
  }, [isOpen])

  const pollJob = async (jobId: string): Promise<'completed' | 'failed'> => {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      try {
        const job = await summaryService.getJobStatus(jobId)
        if (job.status === 'completed') return 'completed'
        if (job.status === 'failed') {
          setError(
            (job.error_code && JOB_ERROR_MESSAGES[job.error_code]) ||
              `Generation failed (${job.error_code || 'unknown error'}).`
          )
          return 'failed'
        }
        // still queued/processing: keep polling
      } catch {
        // a transient status-check failure shouldn't stop the poll; just try again next tick
      }
    }
    // Gave up waiting, but the job may still be running server-side — not necessarily a failure.
    setError('Still processing after 30 seconds. Check back on this page shortly — the job may still complete.')
    return 'failed'
  }

  const handleGenerate = async () => {
    if (!classId) {
      setError('Choose a class.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      // Blank transcript -> createSummaryJob transcribes the class's ready recording's real
      // audio instead; a typed/pasted transcript is summarized directly.
      const job = await summaryService.createSummaryJob(classId, transcript.trim() || undefined)
      setPhase('polling')
      const result = await pollJob(job.job_id)
      setPhase(result)
      if (result === 'completed') onSuccess() // closes the modal and reloads the list
    } catch (err: any) {
      setError(err.message || 'Could not start summary generation.')
      setPhase('form')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Lecture Summary"
      description="Leave the transcript blank to transcribe the class's recorded audio automatically, or paste a transcript to use that instead."
      maxWidth="lg"
    >
      <div className="flex flex-col gap-4 text-xs">
        {phase === 'form' && error && (
          <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#B42318]/30 rounded-lg font-medium">
            {error}
          </div>
        )}

        {phase === 'polling' ? (
          <div className="p-4 bg-[#E8F3FC] text-[#2364AA] border border-[#2364AA]/30 rounded-lg font-medium flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-[#2364AA] border-t-transparent rounded-full animate-spin shrink-0" />
            Generating summary — transcribing and summarizing, this can take up to 30 seconds...
          </div>
        ) : phase === 'failed' ? (
          <div className="flex flex-col gap-3">
            <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#B42318]/30 rounded-lg font-medium">{error}</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null)
                setPhase('form')
              }}
            >
              Try Again
            </Button>
          </div>
        ) : (
          <>
            <FormField label="Class Session" required>
              <Select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                disabled={isLoadingClasses || classes.length === 0}
                options={
                  classes.length > 0
                    ? classes.map((c) => ({ value: c.id, label: `${c.title} — ${c.course_title || c.course_code || ''}` }))
                    : [{ value: '', label: isLoadingClasses ? 'Loading classes...' : 'No classes found' }]
                }
              />
            </FormField>

            <FormField
              label="Lecture Transcript"
              hint={transcript.length > 0 ? `${transcript.length} characters` : 'Optional — leave blank to transcribe the recording'}
            >
              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={8}
                placeholder="Leave blank to transcribe the class's recorded audio, or paste/type a transcript to use instead..."
              />
            </FormField>

            <p className="text-xs text-[#687775] -mt-2">
              With no transcript, the class's ready recording (if any) is transcribed from its real audio using
              speech-to-text. If no recording is ready yet, this will fail — paste a transcript instead in that case.
            </p>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E1E8E4]">
              <Button size="sm" variant="outline" disabled={isSubmitting} onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" isLoading={isSubmitting} onClick={handleGenerate}>
                Generate Summary
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
