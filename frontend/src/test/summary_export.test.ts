import { Blob as NodeBlob } from 'node:buffer'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { buildDocx, buildPdf, buildSummaryBlocks, pdfCanRender } from '../utils/summaryExport'
import type { Summary } from '../types'

// jsdom's Blob has no arrayBuffer(); the libraries only need *a* Blob, so Node's is used for byte-level checks
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

const summary = {
  id: 's1', class_id: 'class-1', course_id: 'c1', status: 'COMPLETED', review_status: 'APPROVED', created_at: '2026-10-16T10:00:00Z',
  overview: 'Photosynthesis converts light into chemical energy.',
  key_concepts: ['Chlorophyll', 'Light reactions'],
  definitions: [{ term: 'Stomata', definition: 'Pores that let gases in and out of a leaf.' }],
  examples: ['Plants growing toward a window'],
  revision_questions: ['What does chlorophyll do?'],
} as unknown as Summary

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())
const ascii = (u: Uint8Array, n: number) => String.fromCharCode(...u.slice(0, n))

describe('summary export', () => {
  it('builds the same content for both formats, including every section', () => {
    const text = buildSummaryBlocks(summary, 'Biology 101').map((b) => b.text)
    expect(text).toContain('Class: Biology 101')
    for (const t of ['Overview', 'Key Concepts', 'Chlorophyll', 'Definitions', 'Stomata', 'Practical Examples', 'Revision Questions', 'What does chlorophyll do?']) {
      expect(text).toContain(t)
    }
  })

  it('creates a real PDF', async () => {
    const blob = await buildPdf(buildSummaryBlocks(summary))
    const u = await bytes(blob)
    expect(ascii(u, 5)).toBe('%PDF-')
    expect(u.length).toBeGreaterThan(1000)
  })

  it('creates a real DOCX (a zip package with a Word document part)', async () => {
    const blob = await buildDocx(buildSummaryBlocks(summary))
    const u = await bytes(blob)
    expect(ascii(u, 2)).toBe('PK')
    expect(new TextDecoder('latin1').decode(u)).toContain('word/document.xml')
  })

  it('paginates a long summary instead of overflowing one page', async () => {
    const long = { ...summary, key_concepts: Array.from({ length: 120 }, (_, i) => `Concept number ${i} explained in a sentence long enough to matter`) } as unknown as Summary
    const u = await bytes(await buildPdf(buildSummaryBlocks(long)))
    const pages = new TextDecoder('latin1').decode(u).match(/\/Type\s*\/Page[^s]/g) ?? []
    expect(pages.length).toBeGreaterThan(1)
  })

  it('flags text a PDF cannot show, so the UI can point to the DOC version', () => {
    expect(pdfCanRender(buildSummaryBlocks(summary))).toBe(true)
    expect(pdfCanRender(buildSummaryBlocks({ ...summary, overview: 'ఫోటోసింథసిస్' } as unknown as Summary))).toBe(false)
  })
})
