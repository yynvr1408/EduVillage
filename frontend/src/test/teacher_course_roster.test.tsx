import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TeacherManageCoursePage } from '../pages/teacher/TeacherManageCoursePage'

const getCourseById = vi.fn()
const getEnrollments = vi.fn()
vi.mock('../services/courseService', () => ({
  courseService: {
    getCourseById: (...a: unknown[]) => getCourseById(...a),
    getEnrollments: (...a: unknown[]) => getEnrollments(...a),
    createLesson: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
  },
}))

const COURSE = {
  id: 'course-1', title: 'Algebra I', code: 'ALG1', description: 'Intro', teacher_id: 't-1',
  status: 'published', created_at: '2026-01-01T00:00:00Z', lessons: [],
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/teacher/courses/course-1/manage']}>
      <Routes>
        <Route path="/teacher/courses/:courseId/manage" element={<TeacherManageCoursePage />} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  getCourseById.mockReset().mockResolvedValue(COURSE)
  getEnrollments.mockReset()
})

describe('teacher course roster: real enrolled students, not hardcoded', () => {
  it('shows every enrolled student with name, email, branch/section and a live count', async () => {
    getEnrollments.mockResolvedValue([
      {
        id: 'e1', course_id: 'course-1', student_id: 's1', status: 'active', enrolled_at: '2026-02-01T00:00:00Z',
        student_name: 'Amina Diallo', student_email: 'amina@example.com',
        branch: { id: 'b1', name: 'Computer Science' }, section: { id: 'sec1', name: 'Section A' },
      },
      {
        id: 'e2', course_id: 'course-1', student_id: 's2', status: 'active', enrolled_at: '2026-02-02T00:00:00Z',
        student_name: 'Kwame Mensah', student_email: 'kwame@example.com', branch: null, section: null,
      },
    ])
    renderPage()
    expect(await screen.findByText('Amina Diallo')).toBeInTheDocument()
    expect(screen.getByText('amina@example.com')).toBeInTheDocument()
    expect(screen.getByText(/Computer Science/)).toBeInTheDocument()
    expect(screen.getByText(/Section A/)).toBeInTheDocument()
    expect(screen.getByText('Kwame Mensah')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument() // the roster count badge
  })

  it('shows an empty state when nobody is enrolled yet', async () => {
    getEnrollments.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/No students enrolled yet/)).toBeInTheDocument()
  })

  it('shows an error state instead of crashing when the roster request fails', async () => {
    getEnrollments.mockRejectedValue(new Error('network down'))
    renderPage()
    expect(await screen.findByText('Could not load the course roster.')).toBeInTheDocument()
  })

  it('requests the real backend roster for this exact course, not a hardcoded list', async () => {
    getEnrollments.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(getEnrollments).toHaveBeenCalledWith('course-1'))
  })
})
