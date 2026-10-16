import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SubmissionFiles, validateFile } from '../components/assignment/SubmissionFiles'

const list = vi.fn()
const upload = vi.fn()
const remove = vi.fn()
vi.mock('../services/assignmentService', () => ({
  assignmentService: {
    listAttachments: (...a: unknown[]) => list(...a),
    uploadAttachment: (...a: unknown[]) => upload(...a),
    deleteAttachment: (...a: unknown[]) => remove(...a),
    attachmentDownloadUrl: (a: string, b: string) => `/dl/${a}/${b}`,
  },
}))
let online = true
vi.mock('../context/NetworkContext', () => ({ useNetworkStatus: () => ({ isOnline: online }) }))

const file = (name: string, size = 1000, type = 'application/pdf') => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}
const att = (id: string, filename: string) => ({ id, filename, size_bytes: 2048, mime_type: 'application/pdf', created_at: '2026-01-01' })

beforeEach(() => {
  online = true
  list.mockReset().mockResolvedValue([])
  upload.mockReset()
  remove.mockReset()
})

describe('validateFile', () => {
  it('accepts PDF, DOC and DOCX and refuses everything else, empty or oversized', () => {
    for (const n of ['a.pdf', 'b.DOC', 'c.docx']) expect(validateFile(file(n), 0)).toBeNull()
    for (const n of ['a.png', 'b.exe', 'c.txt', 'd']) expect(validateFile(file(n), 0)).toMatch(/Only PDF and Word/)
    expect(validateFile(file('a.pdf', 0), 0)).toMatch(/empty/)
    expect(validateFile(file('a.pdf', 21 * 1024 * 1024), 0)).toMatch(/smaller than 20 MB/)
    expect(validateFile(file('a.pdf'), 5)).toMatch(/at most 5/)
  })
})

describe('SubmissionFiles', () => {
  it('shows the empty state, uploads a file, then lists it with download and remove', async () => {
    list.mockResolvedValueOnce([]).mockResolvedValue([att('f1', 'answer.pdf')])
    upload.mockResolvedValue(att('f1', 'answer.pdf'))
    render(<SubmissionFiles assignmentId="a1" />)
    expect(await screen.findByTestId('no-files')).toBeInTheDocument()
    const input = document.getElementById('submission-file') as HTMLInputElement
    const pdf = file('answer.pdf')
    fireEvent.change(input, { target: { files: [pdf] } })
    await waitFor(() => expect(upload).toHaveBeenCalledWith('a1', pdf))
    expect(await screen.findByText('answer.pdf')).toBeInTheDocument()
    expect(screen.getByLabelText('Download answer.pdf')).toHaveAttribute('href', '/dl/a1/f1')

    remove.mockResolvedValue(undefined)
    list.mockResolvedValue([])
    fireEvent.click(screen.getByLabelText('Remove answer.pdf'))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('a1', 'f1'))
    expect(await screen.findByTestId('no-files')).toBeInTheDocument()
  })

  it('refuses a wrong file type without calling the server and shows server errors', async () => {
    render(<SubmissionFiles assignmentId="a1" />)
    await screen.findByTestId('no-files')
    const input = document.getElementById('submission-file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file('photo.png', 100, 'image/png')] } })
    expect(await screen.findByText(/Only PDF and Word/)).toBeInTheDocument()
    expect(upload).not.toHaveBeenCalled()

    upload.mockRejectedValue(new Error("The file's contents do not match its type; it was rejected."))
    fireEvent.change(input, { target: { files: [file('fake.pdf')] } })
    expect(await screen.findByText(/contents do not match/)).toBeInTheDocument()
  })

  it('offline: explains that files need a connection and offers no upload button', async () => {
    online = false
    list.mockResolvedValue([att('f1', 'saved.pdf')])
    render(<SubmissionFiles assignmentId="a1" />)
    expect(await screen.findByText(/You are offline/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Choose a PDF or Word file/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Remove saved.pdf')).toBeDisabled()
  })
})
