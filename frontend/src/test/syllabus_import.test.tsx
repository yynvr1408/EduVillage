import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { SyllabusImportDialog } from '../components/course/SyllabusImportDialog'

const previewText = vi.fn()
const previewPdf = vi.fn()
const bulk = vi.fn()
vi.mock('../services/courseService', () => ({
  courseService: {
    previewSyllabusText: (...a: unknown[]) => previewText(...a),
    previewSyllabusPdf: (...a: unknown[]) => previewPdf(...a),
    createLessonsBulk: (...a: unknown[]) => bulk(...a),
  },
}))

const onImported = vi.fn()
const renderDialog = () => render(<SyllabusImportDialog courseId="c1" isOpen onClose={() => {}} onImported={onImported} />)

beforeEach(() => {
  previewText.mockReset()
  previewPdf.mockReset()
  bulk.mockReset()
  onImported.mockReset()
})

describe('syllabus import dialog', () => {
  it('pasted lessons are previewed, can be edited and trimmed, and nothing is saved until confirmed', async () => {
    previewText.mockResolvedValue([
      { title: 'Unit 1: Cells', content: 'Structure' },
      { title: 'Unit 2: Genetics', content: null },
      { title: 'Unit 3: Oops', content: null },
    ])
    bulk.mockResolvedValue(2)
    renderDialog()
    fireEvent.change(screen.getByLabelText(/curriculum lessons/i), { target: { value: 'Unit 1: Cells\nUnit 2: Genetics\nUnit 3: Oops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview lessons' }))
    const list = await screen.findByTestId('proposed-lessons')
    expect(within(list).getAllByRole('textbox')).toHaveLength(3)
    expect(bulk).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove lesson 3' }))
    fireEvent.change(screen.getByLabelText('Lesson 2 title'), { target: { value: 'Unit 2: Heredity' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 lessons' }))
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2))
    expect(bulk).toHaveBeenCalledWith('c1', [
      { title: 'Unit 1: Cells', content: 'Structure' },
      { title: 'Unit 2: Heredity', content: null },
    ])
  })

  it('uploading a PDF previews lessons from the server; a non-PDF is refused without calling it', async () => {
    previewPdf.mockResolvedValue([{ title: 'Week 1', content: null }])
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /Upload PDF/ }))
    const input = screen.getByLabelText(/syllabus pdf/i) as HTMLInputElement

    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.docx', { type: 'application/msword' })] } })
    expect(await screen.findByText('Please choose a PDF file.')).toBeInTheDocument()
    expect(previewPdf).not.toHaveBeenCalled()

    const pdf = new File(['%PDF-1.4'], 'syllabus.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [pdf] } })
    await screen.findByTestId('proposed-lessons')
    expect(previewPdf).toHaveBeenCalledWith('c1', pdf)
  })

  it('shows the server message when a PDF cannot be read, and an empty paste is refused', async () => {
    previewPdf.mockRejectedValue(new Error('No text was found in that PDF (scanned pictures of pages cannot be read). Paste the lessons instead.'))
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Preview lessons' }))
    expect(await screen.findByText('Paste your lessons first.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Upload PDF/ }))
    fireEvent.change(screen.getByLabelText(/syllabus pdf/i), { target: { files: [new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText(/No text was found in that PDF/)).toBeInTheDocument()
  })
})
