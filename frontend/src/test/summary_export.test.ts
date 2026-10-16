import { Blob as NodeBlob } from 'node:buffer'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { buildDocx, buildSummaryBlocks } from '../utils/summaryExport'
import type { Summary } from '../types'

// jsdom's Blob has no arrayBuffer(); the library only needs *a* Blob, so Node's is used for byte-level checks
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
  it('builds the content once, with every section, shared by the export', () => {
    const text = buildSummaryBlocks(summary, 'Biology 101').map((b) => b.text)
    expect(text).toContain('Class: Biology 101')
    for (const t of ['Overview', 'Key Concepts', 'Chlorophyll', 'Definitions', 'Stomata', 'Practical Examples', 'Revision Questions', 'What does chlorophyll do?']) {
      expect(text).toContain(t)
    }
  })

  it('creates a real DOCX (a zip package with a Word document part)', async () => {
    const blob = await buildDocx(buildSummaryBlocks(summary))
    const u = await bytes(blob)
    expect(ascii(u, 2)).toBe('PK')
    expect(new TextDecoder('latin1').decode(u)).toContain('word/document.xml')
  })

  it('renders non-Latin script content without issue (unlike the old PDF path)', async () => {
    const blob = await buildDocx(buildSummaryBlocks({ ...summary, overview: 'ఫోటోసింథసిస్' } as unknown as Summary))
    const u = await bytes(blob)
    expect(ascii(u, 2)).toBe('PK')
  })
})
