import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentDashboard } from '../pages/student/StudentDashboard'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'student-1', role: 'student', full_name: 'Asha Rao', email: 'a@b.c' } }),
}))
vi.mock('../context/NetworkContext', () => ({
  useNetworkStatus: () => ({ isOnline: true, quality: 'good', latencyMs: 40 }),
}))
vi.mock('../context/SyncContext', () => ({
  useSync: () => ({ pendingCount: 0, syncNow: async () => {}, isSyncing: false }),
}))

vi.mock('../services/courseService', () => ({ courseService: { getCourses: vi.fn().mockResolvedValue([]) } }))
vi.mock('../services/classService', () => ({ classService: { getClasses: vi.fn().mockResolvedValue([]) } }))
vi.mock('../services/assignmentService', () => ({ assignmentService: { getAssignments: vi.fn().mockResolvedValue([]) } }))
vi.mock('../services/downloadManager', () => ({ downloadManager: { getAllDownloads: vi.fn().mockResolvedValue([]) } }))
vi.mock('../services/syncManager', () => ({ syncManager: { getDraft: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('../services/apiClient', () => ({ api: { getRecordings: vi.fn().mockResolvedValue([]) } }))

const listMyCollegeTeachers = vi.fn()
vi.mock('../services/registrationApi', () => ({
  registrationApi: { listMyCollegeTeachers: (...a: unknown[]) => listMyCollegeTeachers(...a) },
}))

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <StudentDashboard />
    </MemoryRouter>
  )

beforeEach(() => {
  listMyCollegeTeachers.mockReset()
})

describe('student dashboard: teachers in your college', () => {
  it('shows real teachers from the backend, with their branch/section and published courses', async () => {
    listMyCollegeTeachers.mockResolvedValue([
      {
        id: 't-1',
        full_name: 'Mr. Okafor',
        branch: { id: 'b-1', name: 'Computer Science' },
        section: { id: 's-1', name: 'Section A' },
        all_sections: false,
        courses: [{ id: 'c-1', title: 'Algebra' }],
      },
    ])
    renderDashboard()
    expect(await screen.findByText('Mr. Okafor')).toBeInTheDocument()
    expect(screen.getByText(/Computer Science/)).toBeInTheDocument()
    expect(screen.getByText(/Section A/)).toBeInTheDocument()
    expect(screen.getByText('Algebra')).toBeInTheDocument()
  })

  it('shows a branch-wide teacher as "All Sections", not a specific section', async () => {
    listMyCollegeTeachers.mockResolvedValue([
      { id: 't-2', full_name: 'Ms. Lindqvist', branch: { id: 'b-1', name: 'Electronics' }, section: null, all_sections: true, courses: [] },
    ])
    renderDashboard()
    expect(await screen.findByText('Ms. Lindqvist')).toBeInTheDocument()
    expect(screen.getByText(/All Sections/)).toBeInTheDocument()
    expect(screen.getByText('No published courses yet')).toBeInTheDocument()
  })

  it('shows the empty state when no teachers are assigned to the student yet', async () => {
    listMyCollegeTeachers.mockResolvedValue([])
    renderDashboard()
    expect(await screen.findByText('No teachers found yet')).toBeInTheDocument()
  })

  it('shows an error state instead of crashing when the request fails', async () => {
    listMyCollegeTeachers.mockRejectedValue(new Error('network down'))
    renderDashboard()
    expect(await screen.findByText(/Could not load teachers/)).toBeInTheDocument()
  })

  it('requests the real authenticated endpoint, not a hardcoded list', async () => {
    listMyCollegeTeachers.mockResolvedValue([])
    renderDashboard()
    await waitFor(() => expect(listMyCollegeTeachers).toHaveBeenCalledTimes(1))
  })
})
