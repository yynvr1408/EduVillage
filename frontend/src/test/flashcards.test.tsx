import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Flashcards } from '../components/summary/Flashcards'
import { SummaryViewer } from '../components/summary/SummaryViewer'
import type { Summary } from '../types'

const cards = [
  { term: 'Photosynthesis', definition: 'Converting light into chemical energy.' },
  { term: 'Chlorophyll', definition: 'The pigment that absorbs light for photosynthesis.' },
]

describe('Flashcards', () => {
  it('shows the term first, flips to the definition on click, and tracks position', () => {
    render(<Flashcards cards={cards} />)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument()
    expect(screen.queryByText('Converting light into chemical energy.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /showing term/i }))
    expect(screen.getByText('Converting light into chemical energy.')).toBeInTheDocument()
  })

  it('Next/Prev wrap around and always reset to showing the term', () => {
    render(<Flashcards cards={cards} />)
    fireEvent.click(screen.getByRole('button', { name: /showing term/i })) // flip to definition
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByText('Chlorophyll')).toBeInTheDocument() // back to showing the term on the new card

    fireEvent.click(screen.getByRole('button', { name: 'Next' })) // wraps past the end
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Prev' })) // wraps the other way
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('Shuffle re-orders the deck and resets to the first card', () => {
    render(<Flashcards cards={cards} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    // still exactly one of these two terms showing - shuffle never drops or duplicates cards
    const shown = screen.queryByText(cards[0].term) ?? screen.queryByText(cards[1].term)
    expect(shown).toBeInTheDocument()
  })
})

describe('SummaryViewer flashcards entry point', () => {
  const base: Summary = {
    id: 's1',
    class_id: 'c1',
    course_id: 'co1',
    status: 'COMPLETED',
    review_status: 'APPROVED',
    created_at: new Date().toISOString(),
    definitions: cards,
  }

  it('offers a Study Flashcards button when the summary has definitions, and opens the deck', () => {
    render(<SummaryViewer summary={base} />)
    const button = screen.getByRole('button', { name: 'Study Flashcards' })
    fireEvent.click(button)
    expect(within(screen.getByRole('dialog')).getByText('Photosynthesis')).toBeInTheDocument()
  })

  it('hides the Study Flashcards button when there are no definitions', () => {
    render(<SummaryViewer summary={{ ...base, definitions: [] }} />)
    expect(screen.queryByRole('button', { name: 'Study Flashcards' })).not.toBeInTheDocument()
  })
})
