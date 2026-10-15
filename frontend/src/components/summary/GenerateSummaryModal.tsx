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

/**
 * Teacher-triggered summary generation. There is no automatic trigger when a class ends, so this
 * is the only way a summary ever gets created. Transcript text is typed/pasted directly rather than
 * requiring a finished recording, so it works independently of the live-recording pipeline.
 */
export const GenerateSummaryModal: React.FC<GenerateSummaryModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [classes, setClasses] = useState<ClassRoom[]>([])
  const [classId, setClassId] = useState('')
  const [transcript, setTranscript] = useState('')
  const [isLoadingClasses, setIsLoadingClasses] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setDone(false)
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

  const handleGenerate = async () => {
    if (!classId || !transcript.trim()) {
      setError('Choose a class and enter the lecture transcript.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await summaryService.createSummaryJob(classId, transcript.trim())
      setDone(true)
      // Groq's response is fast, but this still runs as a background task on the server;
      // give it a moment before the list is reloaded.
      setTimeout(() => {
        onSuccess()
      }, 3000)
    } catch (err: any) {
      setError(err.message || 'Could not start summary generation.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Lecture Summary"
      description="Paste the lecture transcript to synthesize an overview, key concepts, and revision questions."
      maxWidth="lg"
    >
      <div className="flex flex-col gap-4 text-xs">
        {error && (
          <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#B42318]/30 rounded-lg font-medium">
            {error}
          </div>
        )}

        {done ? (
          <div className="p-3 bg-[#DDF3EA] text-[#0F5B57] border border-[#0F5B57]/30 rounded-lg font-medium">
            Summary generation started. This list will refresh automatically in a few seconds.
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

            <FormField label="Lecture Transcript" required hint={`${transcript.length} characters`}>
              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={8}
                placeholder="Paste or type what was said during the lecture..."
              />
            </FormField>

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
