import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentClassesPage } from '../pages/student/StudentClassesPage'

const getClasses = vi.fn()
vi.mock('../services/classService', () => ({ classService: { getClasses: () => getClasses() } }))

const klass = (id: string, title: string, status: string, branch?: string) => ({
  id, course_id: 'c1', title, status, scheduled_at: '2026-11-01T10:00:00Z', livekit_room_name: '', teacher_id: 't', course_title: 'Algorithms',
  course_code: 'CS1', branch_id: branch ? 'br' : undefined, branch_name: branch,
})

const renderPage = () => render(<MemoryRouter><StudentClassesPage /></MemoryRouter>)

beforeEach(() => getClasses.mockReset())

describe('student classes: Other Classes', () => {
  it('lists branch-wide classes under "Other Classes" and section classes in the existing area, never both', async () => {
    getClasses.mockResolvedValue([
      klass('k1', 'My section lecture', 'SCHEDULED'),
      klass('k2', 'Branch-wide lecture', 'LIVE', 'Computer Science'),
    ])
    renderPage()
    const other = await screen.findByTestId('other-classes')
    expect(within(other).getByRole('heading', { name: 'Other Classes' })).toBeInTheDocument()
    expect(within(other).getByText('Branch-wide lecture')).toBeInTheDocument()
    expect(within(other).getByText('Branch: Computer Science')).toBeInTheDocument()
    expect(within(other).queryByText('My section lecture')).not.toBeInTheDocument()
    // exactly once on the whole page
    expect(screen.getAllByText('Branch-wide lecture')).toHaveLength(1)
    expect(screen.getAllByText('My section lecture')).toHaveLength(1)
  })

  it('status filters apply to both areas', async () => {
    getClasses.mockResolvedValue([
      klass('k1', 'Scheduled mine', 'SCHEDULED'),
      klass('k2', 'Live branch', 'LIVE', 'CSE'),
      klass('k3', 'Ended branch', 'ENDED', 'CSE'),
    ])
    renderPage()
    await screen.findByText('Live branch')
    fireEvent.click(screen.getByRole('button', { name: 'live' }))
    expect(screen.getByText('Live branch')).toBeInTheDocument()
    expect(screen.queryByText('Ended branch')).not.toBeInTheDocument()
    expect(screen.queryByText('Scheduled mine')).not.toBeInTheDocument()
  })

  it('shows an empty state for Other Classes when there are none, and keeps the existing classes', async () => {
    getClasses.mockResolvedValue([klass('k1', 'Only mine', 'SCHEDULED')])
    renderPage()
    await screen.findByText('Only mine')
    expect(within(screen.getByTestId('other-classes')).getByText('No other classes right now.')).toBeInTheDocument()
  })

  it('shows the existing empty state when there are no classes at all, and an error state on failure', async () => {
    getClasses.mockResolvedValueOnce([])
    const { unmount } = renderPage()
    expect(await screen.findByText('No sessions found')).toBeInTheDocument()
    unmount()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getClasses.mockRejectedValueOnce(new Error('down'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Classes unavailable')).toBeInTheDocument())
  })
})
