import type { Summary } from '../types'
import { loadChunk } from './loadChunk'

/**
 * Study-notes export for a lecture summary, as a DOCX (Word) file. Generated in the browser (so
 * it also works offline), and the library is only loaded when a student actually downloads.
 */

export interface ExportBlock {
  kind: 'title' | 'meta' | 'heading' | 'subheading' | 'paragraph' | 'bullet' | 'numbered'
  text: string
  n?: number
}

export function buildSummaryBlocks(summary: Summary, classTitle?: string): ExportBlock[] {
  const blocks: ExportBlock[] = [
    { kind: 'title', text: 'LanternEd Lecture Summary' },
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

export type ExportResult = { ok: true; filename: string } | { ok: false; reason: 'FAILED' }

export async function exportSummary(summary: Summary, classTitle?: string): Promise<ExportResult> {
  const blocks = buildSummaryBlocks(summary, classTitle)
  try {
    const blob = await buildDocx(blocks)
    const filename = `eduvillage-summary-${summary.class_id}.docx`
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
