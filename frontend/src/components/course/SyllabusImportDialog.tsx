import React, { useRef, useState } from 'react'
import { FileUp, ClipboardPaste, Trash2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { FormField } from '../ui/FormField'
import { courseService, type ProposedLesson } from '../../services/courseService'

type Mode = 'paste' | 'pdf'

/** Pasted text or a syllabus PDF becomes a list of proposed lessons; nothing is saved until the teacher confirms. */
export const SyllabusImportDialog: React.FC<{
  courseId: string
  isOpen: boolean
  onClose: () => void
  onImported: (count: number) => void
}> = ({ courseId, isOpen, onClose, onImported }) => {
  const [mode, setMode] = useState<Mode>('paste')
  const [text, setText] = useState('')
  const [lessons, setLessons] = useState<ProposedLesson[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setText('')
    setLessons(null)
    setError(null)
    setMode('paste')
    if (fileRef.current) fileRef.current.value = ''
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const run = async (job: () => Promise<ProposedLesson[]>) => {
    setBusy(true)
    setError(null)
    try {
      setLessons(await job())
    } catch (err: any) {
      setLessons(null)
      setError(err?.message || 'Could not read that syllabus.')
    } finally {
      setBusy(false)
    }
  }

  const previewText = () => {
    if (!text.trim()) {
      setError('Paste your lessons first.')
      return
    }
    void run(() => courseService.previewSyllabusText(courseId, text))
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError('Please choose a PDF file.')
      return
    }
    void run(() => courseService.previewSyllabusPdf(courseId, file))
  }

  const confirm = async () => {
    if (!lessons?.length) return
    setBusy(true)
    setError(null)
    try {
      const created = await courseService.createLessonsBulk(courseId, lessons)
      reset()
      onImported(created)
    } catch (err: any) {
      setError(err?.message || 'Could not add the lessons.')
    } finally {
      setBusy(false)
    }
  }

  const update = (i: number, title: string) => setLessons((ls) => ls && ls.map((l, n) => (n === i ? { ...l, title } : l)))
  const remove = (i: number) => setLessons((ls) => (ls ? ls.filter((_, n) => n !== i) : ls))

  const tab = (m: Mode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => {
        setMode(m)
        setError(null)
      }}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
        mode === m ? 'bg-[#0F5B57] text-[#FFFFFF] border-[#0F5B57]' : 'bg-[#FFFFFF] text-[#687775] border-[#CBD7D1] hover:text-[#0F5B57]'
      }`}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title="Import Curriculum"
      description="Paste your lesson list or upload a syllabus PDF. You can review and edit the lessons before they are added."
      maxWidth="lg"
    >
      <div className="flex flex-col gap-4 text-xs">
        {error && (
          <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#CBD7D1] rounded-lg font-medium" role="alert">
            {error}
          </div>
        )}

        {lessons === null ? (
          <>
            <div className="flex gap-2">
              {tab('paste', 'Paste lessons', <ClipboardPaste className="w-3.5 h-3.5" />)}
              {tab('pdf', 'Upload PDF', <FileUp className="w-3.5 h-3.5" />)}
            </div>

            {mode === 'paste' ? (
              <>
                <FormField label="Curriculum lessons" htmlFor="syllabus-text" hint="One lesson per line, or headings like Unit 1 / Chapter 2 / 3. Topic">
                  <Textarea
                    id="syllabus-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={9}
                    placeholder={'Unit 1: Cells\nStructure of a cell\nUnit 2: Genetics'}
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button size="sm" onClick={previewText} isLoading={busy}>
                    Preview lessons
                  </Button>
                </div>
              </>
            ) : (
              <FormField label="Syllabus PDF" htmlFor="syllabus-pdf" hint="Text PDFs up to 10 MB (scanned images cannot be read)">
                <input
                  ref={fileRef}
                  id="syllabus-pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={busy}
                  onChange={(e) => onFile(e.target.files?.[0])}
                  className="block w-full text-xs text-[#202B2A] file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border file:border-[#CBD7D1] file:bg-[#FFFFFF] file:text-[#0F5B57] file:font-semibold"
                />
                {busy && <p className="text-[#687775] mt-2">Reading the PDF...</p>}
              </FormField>
            )}
          </>
        ) : (
          <>
            <p className="text-[#687775]">
              {lessons.length} lesson{lessons.length === 1 ? '' : 's'} found. Edit a title or remove lessons you do not want, then add them.
            </p>
            <ul className="flex flex-col gap-2 max-h-72 overflow-y-auto" data-testid="proposed-lessons">
              {lessons.map((l, i) => (
                <li key={i} className="flex items-start gap-2 border border-[#E1E8E4] rounded-lg p-2">
                  <div className="flex-1 min-w-0">
                    <input
                      aria-label={`Lesson ${i + 1} title`}
                      value={l.title}
                      maxLength={255}
                      onChange={(e) => update(i, e.target.value)}
                      className="w-full text-sm font-semibold text-[#202B2A] bg-transparent border-b border-transparent focus:border-[#0F5B57] focus:outline-none"
                    />
                    {l.content && <p className="text-[#687775] mt-1 line-clamp-2 whitespace-pre-line">{l.content}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove lesson ${i + 1}`}
                    className="p-1.5 text-[#687775] hover:text-[#B42318] cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#E1E8E4]">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLessons(null)}>
                Back
              </Button>
              <Button size="sm" onClick={confirm} isLoading={busy} disabled={lessons.filter((l) => l.title.trim()).length === 0}>
                Add {lessons.filter((l) => l.title.trim()).length} lessons
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
