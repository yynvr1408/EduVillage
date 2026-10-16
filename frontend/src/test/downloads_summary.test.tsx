import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { db } from '../db/db'
import { SummaryViewer } from '../components/summary/SummaryViewer'
import type { Summary } from '../types'

describe('Downloads & AI Lecture Summary Workflow', () => {
  beforeEach(async () => {
    await db.downloadedResources.clear()
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
    // notes are downloaded as PDF or Word (DOC), no longer as a Markdown file
    expect(screen.getByRole('button', { name: /^PDF$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^DOC$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download Notes/i })).not.toBeInTheDocument()
  })
})
