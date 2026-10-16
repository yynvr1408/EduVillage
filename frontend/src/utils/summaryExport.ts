import type { Summary } from '../types'
import { loadChunk } from './loadChunk'

/**
 * Study-notes export for a lecture summary: PDF or DOCX (Word). Generated in the browser (so it also works
 * offline), and the heavy libraries are loaded only when a student actually downloads.
 */

export type SummaryExportFormat = 'pdf' | 'docx'

export interface ExportBlock {
  kind: 'title' | 'meta' | 'heading' | 'subheading' | 'paragraph' | 'bullet' | 'numbered'
  text: string
  n?: number
}

/** The document, independent of the file format, so both formats always carry the same content. */
export function buildSummaryBlocks(summary: Summary, classTitle?: string): ExportBlock[] {
  const blocks: ExportBlock[] = [
    { kind: 'title', text: 'EduVillage Lecture Summary' },
    { kind: 'meta', text: classTitle ? `Class: ${classTitle}` : `Class session: ${summary.class_id}` },
    { kind: 'meta', text: `Date: ${new Date(summary.created_at).toLocaleDateString()}` },
    { kind: 'heading', text: 'Overview' },
    { kind: 'paragraph', text: summary.overview || 'N/A' },
  ]
  if (summary.key_concepts?.length) {
    blocks.push({ kind: 'heading', text: 'Key Concepts' }, ...summary.key_concepts.map((t) => ({ kind: 'bullet' as const, text: t })))
  }
  if (summary.definitions?.length) {
    blocks.push({ kind: 'heading', text: 'Definitions' })
    for (const d of summary.definitions) blocks.push({ kind: 'subheading', text: d.term }, { kind: 'paragraph', text: d.definition })
  }
  if (summary.examples?.length) {
    blocks.push({ kind: 'heading', text: 'Practical Examples' }, ...summary.examples.map((t) => ({ kind: 'bullet' as const, text: t })))
  }
  if (summary.revision_questions?.length) {
    blocks.push({ kind: 'heading', text: 'Revision Questions' }, ...summary.revision_questions.map((t, i) => ({ kind: 'numbered' as const, text: t, n: i + 1 })))
  }
  return blocks
}

/** jsPDF's built-in fonts only cover Latin-1; text in other scripts would come out as garbage. */
export function pdfCanRender(blocks: ExportBlock[]): boolean {
  return blocks.every((b) => !/[^\u0000-ÿ‘’“”–—•…]/.test(b.text))
}

export async function buildPdf(blocks: ExportBlock[]): Promise<Blob> {
  const { jsPDF } = await loadChunk(() => import('jspdf'))
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 56
  const width = doc.internal.pageSize.getWidth() - margin * 2
  const bottom = doc.internal.pageSize.getHeight() - margin
  let y = margin
  const write = (text: string, size: number, bold: boolean, indent = 0, gap = 6, color: [number, number, number] = [32, 43, 42]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(text, width - indent) as string[]
    for (const line of lines) {
      if (y + size > bottom) {
        doc.addPage()
        y = margin
      }
      doc.text(line, margin + indent, y)
      y += size * 1.35
    }
    y += gap
  }
  for (const b of blocks) {
    if (b.kind === 'title') write(b.text, 20, true, 0, 4, [15, 91, 87])
    else if (b.kind === 'meta') write(b.text, 10, false, 0, 2, [104, 119, 117])
    else if (b.kind === 'heading') {
      y += 8
      write(b.text, 14, true, 0, 4, [15, 91, 87])
    } else if (b.kind === 'subheading') write(b.text, 11, true, 0, 2)
    else if (b.kind === 'paragraph') write(b.text, 11, false, 0, 8)
    else if (b.kind === 'bullet') write(`•  ${b.text}`, 11, false, 10, 4)
    else write(`${b.n}.  ${b.text}`, 11, false, 10, 4)
  }
  return doc.output('blob')
}

export async function buildDocx(blocks: ExportBlock[]): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await loadChunk(() => import('docx'))
  const children = blocks.map((b) => {
    switch (b.kind) {
      case 'title':
        return new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: b.text, bold: true, color: '0F5B57' })] })
      case 'meta':
        return new Paragraph({ children: [new TextRun({ text: b.text, color: '687775' })] })
      case 'heading':
        return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240 }, children: [new TextRun({ text: b.text, color: '0F5B57' })] })
      case 'subheading':
        return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: b.text })] })
      case 'bullet':
        return new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b.text })] })
      case 'numbered':
        return new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: `${b.n}. ${b.text}` })] })
      default:
        return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: b.text })] })
    }
  })
  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}

export type ExportResult = { ok: true; filename: string } | { ok: false; reason: 'UNSUPPORTED_SCRIPT' | 'FAILED' }

export async function exportSummary(summary: Summary, format: SummaryExportFormat, classTitle?: string): Promise<ExportResult> {
  const blocks = buildSummaryBlocks(summary, classTitle)
  if (format === 'pdf' && !pdfCanRender(blocks)) return { ok: false, reason: 'UNSUPPORTED_SCRIPT' }
  try {
    const blob = format === 'pdf' ? await buildPdf(blocks) : await buildDocx(blocks)
    const filename = `eduvillage-summary-${summary.class_id}.${format}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return { ok: true, filename }
  } catch {
    return { ok: false, reason: 'FAILED' }
  }
}
