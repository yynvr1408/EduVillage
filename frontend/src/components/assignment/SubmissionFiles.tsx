import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, FileText, Trash2, Download, WifiOff } from 'lucide-react'
import { assignmentService } from '../../services/assignmentService'
import type { SubmissionAttachment } from '../../types'
import { useNetworkStatus } from '../../context/NetworkContext'
import { Button } from '../ui/Button'

export const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx']
export const MAX_FILE_MB = 20
export const MAX_FILES = 5

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Client-side pre-check so an obviously wrong file never starts uploading. The server checks again (real file contents). */
export function validateFile(file: File, existingCount: number): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext)) return 'Only PDF and Word documents (.pdf, .doc, .docx) can be attached.'
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `Each file must be smaller than ${MAX_FILE_MB} MB.`
  if (existingCount >= MAX_FILES) return `You can attach at most ${MAX_FILES} files.`
  return null
}

/** PDF / Word files that go with a student's answer. Files need a connection (the written answer itself still works offline). */
export const SubmissionFiles: React.FC<{ assignmentId: string }> = ({ assignmentId }) => {
  const { isOnline } = useNetworkStatus()
  const [files, setFiles] = useState<SubmissionAttachment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setFiles(await assignmentService.listAttachments(assignmentId))
    } catch {
      setFiles([])
    }
  }, [assignmentId])

  useEffect(() => {
    void load()
  }, [load])

  const onPick = async (picked: FileList | null) => {
    const file = picked?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    const problem = validateFile(file, files?.length ?? 0)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await assignmentService.uploadAttachment(assignmentId, file)
      await load()
    } catch (err: any) {
      setError(err?.isNetworkError ? 'Upload failed because the connection was lost. Try again when you are online.' : err?.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await assignmentService.deleteAttachment(assignmentId, id)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Could not remove the file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6" aria-label="Attached files">
      <h2 className="text-base font-bold text-[#202B2A] mb-2 flex items-center gap-2">
        <Paperclip className="w-4 h-4 text-[#0F5B57]" /> Attach files (PDF or Word)
      </h2>
      <div className="p-4 bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl flex flex-col gap-3 text-xs">
        <p className="text-[#687775]">
          Optional. Up to {MAX_FILES} files, {MAX_FILE_MB} MB each. Files are uploaded straight away and sent to your teacher with your answer.
        </p>

        {error && (
          <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#B42318]/30 rounded-lg font-medium" role="alert">
            {error}
          </div>
        )}

        {files === null ? (
          <p className="text-[#687775]">Loading attached files...</p>
        ) : files.length === 0 ? (
          <p className="text-[#687775]" data-testid="no-files">No files attached yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="attached-files">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 border border-[#E1E8E4] rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-[#0F5B57] shrink-0" />
                <span className="flex-1 min-w-0 break-words font-semibold text-[#202B2A]">{f.filename}</span>
                <span className="text-[#687775] shrink-0">{formatSize(f.size_bytes)}</span>
                <a
                  href={assignmentService.attachmentDownloadUrl(assignmentId, f.id)}
                  className="p-1.5 text-[#0F5B57] hover:bg-[#DDF3EA] rounded-md"
                  aria-label={`Download ${f.filename}`}
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  disabled={busy || !isOnline}
                  aria-label={`Remove ${f.filename}`}
                  className="p-1.5 text-[#687775] hover:text-[#B42318] disabled:opacity-40 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!isOnline ? (
          <p className="flex items-center gap-2 text-[#8A5700] bg-[#FFF0CB] p-2.5 rounded-lg border border-[#8A5700]/30">
            <WifiOff className="w-4 h-4 shrink-0" />
            You are offline. Your written answer is saved on this device; connect to the internet to attach files.
          </p>
        ) : (
          <div>
            <input
              ref={inputRef}
              id="submission-file"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={busy}
              onChange={(e) => onPick(e.target.files)}
            />
            <label htmlFor="submission-file">
              <Button type="button" size="sm" variant="outline" isLoading={busy} onClick={() => inputRef.current?.click()} icon={<Paperclip className="w-3.5 h-3.5" />}>
                {busy ? 'Uploading...' : 'Choose a PDF or Word file'}
              </Button>
            </label>
          </div>
        )}
      </div>
    </section>
  )
}
