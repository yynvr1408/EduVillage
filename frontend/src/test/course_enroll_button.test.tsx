import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentCoursesPage } from '../pages/student/StudentCoursesPage'

const getCatalog = vi.fn()
const getCourses = vi.fn()
const enroll = vi.fn()
vi.mock('../services/courseService', () => ({
  courseService: { getCatalog: () => getCatalog(), getCourses: () => getCourses(), enroll: (id: string) => enroll(id) },
}))

const course = (id: string, title: string) => ({
  id, title, code: id.toUpperCase(), teacher_id: 't', created_at: '2026-01-01', status: 'published', lessons_count: 1,
})

beforeEach(() => {
  getCatalog.mockReset().mockResolvedValue([course('a', 'Open Course'), course('b', 'Mine Already')])
  getCourses.mockReset().mockResolvedValue([course('b', 'Mine Already')])
  enroll.mockReset()
})

const renderPage = () => render(<MemoryRouter><StudentCoursesPage /></MemoryRouter>)

describe('course catalog enroll button', () => {
  it('shows Enroll in place of View Course until enrolled, then switches to View Course', async () => {
    enroll.mockResolvedValue({})
    renderPage()
    await screen.findByText('Open Course')
    expect(screen.queryByText(/Enroll to access/)).not.toBeInTheDocument() // the old banner button is gone
    expect(screen.getAllByRole('button', { name: 'Enroll' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /View Course/ })).toHaveLength(1) // only the already-enrolled course

    fireEvent.click(screen.getByRole('button', { name: 'Enroll' }))
    await waitFor(() => expect(enroll).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /View Course/ })).toHaveLength(2))
    expect(screen.queryByRole('button', { name: 'Enroll' })).not.toBeInTheDocument()
  })

  it('stays on Enroll and shows the error when enrolling fails', async () => {
    enroll.mockRejectedValue(new Error('Could not enroll in this course.'))
    renderPage()
    await screen.findByText('Open Course')
    fireEvent.click(screen.getByRole('button', { name: 'Enroll' }))
    expect(await screen.findByText('Could not enroll in this course.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enroll' })).toBeInTheDocument()
  })
})
