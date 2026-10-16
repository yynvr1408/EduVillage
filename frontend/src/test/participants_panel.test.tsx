import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ParticipantsPanel } from '../pages/classroom/ClassroomPage'
import type { ClassParticipant } from '../types'

function makeParticipant(overrides: Partial<ClassParticipant> = {}): ClassParticipant {
  return {
    id: 'p-1',
    user_id: 'u-1',
    full_name: 'Amara Okafor',
    email: 'amara@example.com',
    joined_at: new Date().toISOString(),
    left_at: null,
    status: 'JOINED',
    ...overrides,
  }
}

describe('ParticipantsPanel (teacher roster: see who joined, remove a student)', () => {
  it('shows a loading message while the first fetch is in flight', () => {
    render(<ParticipantsPanel participants={[]} isLoading={true} removingUserId={null} errorMessage={null} onRemove={vi.fn()} />)
    expect(screen.getByText(/loading participants/i)).toBeInTheDocument()
  })

  it('shows an empty state once loaded with nobody present', () => {
    render(<ParticipantsPanel participants={[]} isLoading={false} removingUserId={null} errorMessage={null} onRemove={vi.fn()} />)
    expect(screen.getByText(/no one has joined yet/i)).toBeInTheDocument()
  })

  it("lists each participant's name and email, with a Remove action for a currently-joined student", () => {
    const onRemove = vi.fn()
    const participant = makeParticipant()
    render(
      <ParticipantsPanel participants={[participant]} isLoading={false} removingUserId={null} errorMessage={null} onRemove={onRemove} />
    )

    expect(screen.getByText('Amara Okafor')).toBeInTheDocument()
    expect(screen.getByText('amara@example.com')).toBeInTheDocument()
    expect(screen.getByText('JOINED')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Remove Amara Okafor/i }))
    expect(onRemove).toHaveBeenCalledWith(participant)
  })

  it('does not offer a Remove action for a participant who already left or was removed', () => {
    const left = makeParticipant({ id: 'p-2', user_id: 'u-2', full_name: 'Left Student', status: 'LEFT' })
    const removed = makeParticipant({ id: 'p-3', user_id: 'u-3', full_name: 'Removed Student', status: 'REMOVED' })
    render(
      <ParticipantsPanel participants={[left, removed]} isLoading={false} removingUserId={null} errorMessage={null} onRemove={vi.fn()} />
    )

    expect(screen.queryByRole('button', { name: /Remove Left Student/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove Removed Student/i })).not.toBeInTheDocument()
    expect(screen.getByText('LEFT')).toBeInTheDocument()
    expect(screen.getByText('REMOVED')).toBeInTheDocument()
  })

  it('disables the Remove button for the student currently being removed, and surfaces a reported error', () => {
    const participant = makeParticipant()
    render(
      <ParticipantsPanel
        participants={[participant]}
        isLoading={false}
        removingUserId="u-1"
        errorMessage="Could not remove this student."
        onRemove={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Remove Amara Okafor/i })).toBeDisabled()
    expect(screen.getByText('Could not remove this student.')).toBeInTheDocument()
  })
})
