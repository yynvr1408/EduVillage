import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { db } from '../db/db'
import { downloadManager } from '../services/downloadManager'
import { SummaryViewer } from '../components/summary/SummaryViewer'
import type { Material, Summary } from '../types'

describe('Downloads & AI Lecture Summary Workflow', () => {
  beforeEach(async () => {
    await db.downloadedResources.clear()
  })

  it('downloads resource and stores binary blob and metadata in IndexedDB', async () => {
    const material: Material = {
      id: 'mat-solar-guide',
      course_id: 'STEM-201',
      title: 'Solar Field Diagnostics Guidebook (PDF)',
      file_url: '/downloads/solar-guide.pdf',
      file_type: 'pdf',
      file_size: 2048,
      is_published: true,
      created_at: new Date().toISOString(),
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['%PDF-1.4 real bytes']) }))
    const downloaded = await downloadManager.downloadResource(material, 'Solar Energy')
    expect(downloaded.sizeBytes).toBeGreaterThan(0)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/downloads/solar-guide.pdf'), expect.objectContaining({ credentials: 'include' }))

    expect(downloaded.id).toBe('mat-solar-guide')
    expect(downloaded.title).toBe('Solar Field Diagnostics Guidebook (PDF)')

    const inDb = await db.downloadedResources.get('mat-solar-guide')
    expect(inDb).toBeDefined()
    expect(inDb?.fileType).toBe('pdf')

    const isPresent = await downloadManager.isDownloaded('mat-solar-guide')
    expect(isPresent).toBe(true)

    // Remove from local storage
    await downloadManager.deleteDownload('mat-solar-guide')
    const afterDelete = await downloadManager.isDownloaded('mat-solar-guide')
    expect(afterDelete).toBe(false)
  })

  it('never stores placeholder content when the download fails', async () => {
    const material: Material = {
      id: 'mat-missing',
      course_id: 'c-1',
      title: 'Not Reachable',
      file_url: '/api/v1/resources/mat-missing/download',
      file_type: 'pdf',
      file_size: 10,
      is_published: true,
      created_at: new Date().toISOString(),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, blob: async () => new Blob([]) }))
    await expect(downloadManager.downloadResource(material)).rejects.toThrow(/no longer have access/i)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(downloadManager.downloadResource(material)).rejects.toThrow()
    expect(await downloadManager.isDownloaded('mat-missing')).toBe(false)
  })

  it('renders SummaryViewer with Overview, Key Concepts, Definitions, and Revision Questions', () => {
    const summary: Summary = {
      id: 'sum-1',
      class_id: 'class-stem-101',
      course_id: 'STEM-201',
      status: 'COMPLETED',
      review_status: 'APPROVED',
      overview: 'Foundational concepts of solar microgrid balancing and load calculation.',
      key_concepts: [
        'Photovoltaic energy conversion efficiency',
        'LiFePO4 cycle life advantages',
      ],
      definitions: [
        {
          term: 'MPPT Sizing',
          definition: 'Maximum Power Point Tracking dynamic voltage conversion.',
        },
      ],
      examples: [
        'Calculating battery bank Amp-hours for remote dispensaries.',
      ],
      revision_questions: [
        'What is the primary factor affecting solar panel efficiency at high temperatures?',
      ],
      created_at: new Date().toISOString(),
    }

    render(<SummaryViewer summary={summary} />)

    expect(screen.getByText(/Foundational concepts of solar microgrid/i)).toBeInTheDocument()
    expect(screen.getByText(/Photovoltaic energy conversion efficiency/i)).toBeInTheDocument()
    expect(screen.getByText(/MPPT Sizing/i)).toBeInTheDocument()
    expect(screen.getByText(/What is the primary factor affecting solar panel efficiency/i)).toBeInTheDocument()
    expect(screen.getByText(/Teacher Approved/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download Notes/i })).toBeInTheDocument()
  })
})
