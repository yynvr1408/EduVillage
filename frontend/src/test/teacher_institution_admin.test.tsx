import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TeacherInstitutionAdminPage } from '../pages/teacher/TeacherInstitutionAdminPage'

const myColleges = vi.fn()
const updateCollege = vi.fn()
const regenerateCode = vi.fn()
const listBranches = vi.fn()
vi.mock('../services/institutionAdminApi', () => ({
  institutionAdminApi: {
    myColleges: (...a: unknown[]) => myColleges(...a),
    updateCollege: (...a: unknown[]) => updateCollege(...a),
    regenerateCode: (...a: unknown[]) => regenerateCode(...a),
    listBranches: (...a: unknown[]) => listBranches(...a),
    createBranch: vi.fn(),
    updateBranch: vi.fn(),
    setBranchStatus: vi.fn(),
    listSections: vi.fn(),
    createSection: vi.fn(),
    updateSection: vi.fn(),
    setSectionStatus: vi.fn(),
  },
}))

const COLLEGE = {
  id: 'col-1',
  name: 'Rural College A',
  location: 'Pune',
  contact_email: null,
  contact_phone: null,
  code: 'EV-ABCD-1234',
  code_generated_at: new Date().toISOString(),
  status: 'active' as const,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

describe('TeacherInstitutionAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listBranches.mockResolvedValue([])
  })

  it('shows an empty state when the teacher administers no institution', async () => {
    myColleges.mockResolvedValue([])
    render(<TeacherInstitutionAdminPage />)
    expect(await screen.findByText(/not an administrator of any institution/i)).toBeInTheDocument()
  })

  it('lists a delegated college with its code, location and status', async () => {
    myColleges.mockResolvedValue([COLLEGE])
    render(<TeacherInstitutionAdminPage />)
    expect(await screen.findByText('Rural College A')).toBeInTheDocument()
    expect(screen.getByText('EV-ABCD-1234')).toBeInTheDocument()
    expect(screen.getByText('Pune')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('lets the teacher edit and save the college location', async () => {
    myColleges.mockResolvedValue([COLLEGE])
    updateCollege.mockResolvedValue({ ...COLLEGE, location: 'Riverside' })
    render(<TeacherInstitutionAdminPage />)
    await screen.findByText('Rural College A')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Details' }))
    const locationInput = screen.getByLabelText('Location')
    fireEvent.change(locationInput, { target: { value: 'Riverside' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateCollege).toHaveBeenCalledWith('col-1', {
        location: 'Riverside',
        contact_email: null,
        contact_phone: null,
      })
    )
    expect(await screen.findByText(/institution details updated/i)).toBeInTheDocument()
  })

  it('regenerates the registration code after confirmation', async () => {
    myColleges.mockResolvedValue([COLLEGE])
    regenerateCode.mockResolvedValue({ ...COLLEGE, code: 'EV-NEWX-9999' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TeacherInstitutionAdminPage />)
    await screen.findByText('Rural College A')

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Code' }))
    await waitFor(() => expect(regenerateCode).toHaveBeenCalledWith('col-1'))
  })

  it('does not regenerate the code if the teacher cancels the confirmation', async () => {
    myColleges.mockResolvedValue([COLLEGE])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<TeacherInstitutionAdminPage />)
    await screen.findByText('Rural College A')

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Code' }))
    expect(regenerateCode).not.toHaveBeenCalled()
  })

  it('opens the branches & sections dialog scoped to that college', async () => {
    myColleges.mockResolvedValue([COLLEGE])
    render(<TeacherInstitutionAdminPage />)
    await screen.findByText('Rural College A')

    fireEvent.click(screen.getByRole('button', { name: /Branches & Sections/i }))
    await waitFor(() => expect(listBranches).toHaveBeenCalledWith('col-1', ''))
  })

  it('surfaces a load error with a retry option', async () => {
    myColleges.mockRejectedValueOnce(new Error('Could not reach the server.'))
    myColleges.mockResolvedValueOnce([COLLEGE])
    render(<TeacherInstitutionAdminPage />)

    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Rural College A')).toBeInTheDocument()
  })
})
