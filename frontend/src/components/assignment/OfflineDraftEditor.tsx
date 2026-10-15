import React, { useState, useEffect, useRef } from 'react'
import {
  Save,
  Send,
  CheckCircle,
  CloudUpload,
  Clock,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react'
import type { Assignment, AssignmentDraft } from '../../types'
import { syncManager } from '../../services/syncManager'
import { assignmentService } from '../../services/assignmentService'
import { ApiError } from '../../services/apiClient'
import { useAuth } from '../../context/AuthContext'
import { useNetworkStatus } from '../../context/NetworkContext'
import { useSync } from '../../context/SyncContext'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { Badge } from '../ui/Badge'

export interface OfflineDraftEditorProps {
  assignment: Assignment
  onSubmitted?: () => void
}

export const OfflineDraftEditor: React.FC<OfflineDraftEditorProps> = ({
  assignment,
  onSubmitted,
}) => {
  const { user } = useAuth()
  const { isOnline } = useNetworkStatus()
  const { refreshQueue } = useSync()

  const [content, setContent] = useState<string>('')
  const [draft, setDraft] = useState<AssignmentDraft | null>(null)
  const [saveStatus, setSaveStatus] = useState<
    'clean' | 'saved_locally' | 'waiting_sync' | 'submitting' | 'server_confirmed' | 'error'
  >('clean')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)

  const isServerSubmitted = Boolean(assignment.my_submission)
  const autoSaveTimerRef = useRef<number | null>(null)

  // Load existing draft or server submission on mount
  useEffect(() => {
    let isMounted = true

    async function loadInitial() {
      // If already submitted on server, set content
      if (assignment.my_submission) {
        if (isMounted) {
          setContent(assignment.my_submission.content)
          setSaveStatus('server_confirmed')
        }
        return
      }

      // Check IndexedDB draft
      const localDraft = await syncManager.getDraft(assignment.id)
      if (isMounted && localDraft) {
        setDraft(localDraft)
        setContent(localDraft.content)
        setLastSavedAt(localDraft.savedAt)
        if (localDraft.syncStatus === 'pending_sync') {
          setSaveStatus('waiting_sync')
        } else if (localDraft.content.trim()) {
          setSaveStatus('saved_locally')
        }
      }
    }

    loadInitial()
    return () => {
      isMounted = false
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [assignment])

  // Handle typing with debounced auto-save to IndexedDB ("Saved on this device")
  const handleChange = (newContent: string) => {
    setContent(newContent)

    if (isServerSubmitted) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)

    autoSaveTimerRef.current = window.setTimeout(async () => {
      if (!user) return
      try {
        const savedDraft = await syncManager.saveDraftLocally(
          assignment.id,
          user.id,
          assignment.course_id,
          assignment.title,
          newContent
        )
        setDraft(savedDraft)
        setLastSavedAt(savedDraft.savedAt)
        setSaveStatus('saved_locally')
      } catch (err: any) {
        console.error('Failed to auto-save draft locally:', err)
      }
    }, 600)
  }

  // Handle manual / explicit submission
  const handleSubmit = async () => {
    if (!content.trim()) {
      setErrorMessage('Please enter your response before submitting.')
      return
    }

    if (!user) return

    setErrorMessage(null)
    setSaveStatus('submitting')

    if (isOnline) {
      try {
        // Direct online submission with server confirmation
        const idempotencyKey = `sub-${assignment.id}-${user.id}-${Date.now()}`
        await assignmentService.submitAssignment(assignment.id, content, idempotencyKey)

        // Update local draft status to synced
        const updatedDraft = await syncManager.saveDraftLocally(
          assignment.id,
          user.id,
          assignment.course_id,
          assignment.title,
          content
        )
        updatedDraft.syncStatus = 'synced'
        setDraft(updatedDraft)
        setSaveStatus('server_confirmed')
        if (onSubmitted) onSubmitted()
      } catch (err: any) {
        if (err instanceof ApiError && !err.isNetworkError) {
          // The server answered and refused (closed assignment, not enrolled...). Queuing it would
          // just be refused again, so tell the student instead of pretending it will be retried.
          setErrorMessage(err.message)
          setSaveStatus('error')
        } else {
          // Connectivity problem: keep the work safe in the offline queue.
          console.warn('Online submit failed, enqueuing for offline retry:', err)
          await handleEnqueueOffline()
        }
      }
    } else {
      // Offline mode: enqueue to sync operations
      await handleEnqueueOffline()
    }
  }

  const handleEnqueueOffline = async () => {
    if (!user) return
    try {
      const { draft: queuedDraft } = await syncManager.enqueueSubmission(
        assignment.id,
        user.id,
        assignment.course_id,
        assignment.title,
        content
      )
      setDraft(queuedDraft)
      setLastSavedAt(queuedDraft.savedAt)
      setSaveStatus('waiting_sync')
      await refreshQueue()
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save offline submission')
      setSaveStatus('error')
    }
  }

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Status Bar */}
      <div className="p-3 bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          {saveStatus === 'server_confirmed' ? (
            <Badge variant="success" size="sm">
              <CheckCircle className="w-3.5 h-3.5 mr-1" />
              Server Confirmed
            </Badge>
          ) : saveStatus === 'waiting_sync' ? (
            <Badge variant="warning" size="sm">
              <CloudUpload className="w-3.5 h-3.5 mr-1" />
              Waiting to sync
            </Badge>
          ) : saveStatus === 'saved_locally' ? (
            <Badge variant="secondary" size="sm">
              <Save className="w-3.5 h-3.5 mr-1" />
              Saved on this device
            </Badge>
          ) : (
            <Badge variant="outline" size="sm">
              Draft
            </Badge>
          )}

          {lastSavedAt && (
            <span className="text-[#666666] text-[11px] flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Saved: {new Date(lastSavedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="text-[11px] text-[#666666] font-medium">
          {wordCount} Words • IndexedDB Persistence Active
        </div>
      </div>

      {/* Editor Area */}
      <div className="relative">
        <Textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          disabled={isServerSubmitted}
          rows={10}
          placeholder="Type your assignment answers, calculations, or report here. Work is automatically saved to local storage so you can safely close the app or go offline..."
          className="font-sans leading-relaxed text-sm"
        />
      </div>

      {errorMessage && (
        <div className="p-3 bg-[#B42318]/10 border border-[#B42318]/20 rounded-md text-xs text-[#B42318] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
        <p className="text-xs text-[#666666]">
          {isServerSubmitted ? (
            'Your submission has been received and locked for grading.'
          ) : isOnline ? (
            'Online: Submissions are verified immediately by the server.'
          ) : (
            'Offline: Submission will be queued safely and synced when connectivity returns.'
          )}
        </p>

        {!isServerSubmitted && (
          <Button
            onClick={handleSubmit}
            isLoading={saveStatus === 'submitting'}
            variant={saveStatus === 'waiting_sync' ? 'secondary' : 'primary'}
            icon={isOnline ? <Send className="w-3.5 h-3.5" /> : <CloudUpload className="w-3.5 h-3.5" />}
          >
            {isOnline ? 'Submit to Teacher' : 'Queue Offline Submission'}
          </Button>
        )}
      </div>
    </div>
  )
}
