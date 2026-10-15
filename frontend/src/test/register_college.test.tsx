import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RegisterPage } from '../pages/auth/RegisterPage'
import { ApiError } from '../services/apiClient'

const register = vi.fn()
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ register }) }))

const listColleges = vi.fn()
const listBranches = vi.fn()
const listSections = vi.fn()
vi.mock('../services/registrationApi', () => ({
  registrationApi: {
    listColleges: (...a: unknown[]) => listColleges(...a),
    listBranches: (...a: unknown[]) => listBranches(...a),
    listSections: (...a: unknown[]) => listSections(...a),
  },
}))

const COLLEGE = /^College\s*\*?$/
const BRANCH = /^Branch\s*\*?$/
const SECTION = /^Section\s*\*?$/

const COLLEGES = [
  { id: 'col-a', name: 'Alpha College', location: 'Pune' },
  { id: 'col-b', name: 'Beta Institute', location: null },
]
const BRANCHES: Record<string, { id: string; name: string; short_code: string | null }[]> = {
  'col-a': [{ id: 'br-cse', name: 'Computer Science', short_code: 'CSE' }, { id: 'br-ece', name: 'Electronics', short_code: null }],
  'col-b': [{ id: 'br-me', name: 'Mechanical', short_code: 'ME' }],
}
const SECTIONS: Record<string, { id: string; college_id: string; branch_id: string; name: string }[]> = {
  'br-cse': [{ id: 'sec-a', college_id: 'col-a', branch_id: 'br-cse', name: 'Section A' }, { id: 'sec-b', college_id: 'col-a', branch_id: 'br-cse', name: 'Section B' }],
  'br-ece': [{ id: 'sec-e', college_id: 'col-a', branch_id: 'br-ece', name: 'Section E' }],
  'br-me': [{ id: 'sec-m', college_id: 'col-b', branch_id: 'br-me', name: 'Section M' }],
}

const renderPage = (portal: 'student' | 'teacher') =>
  render(
    <MemoryRouter>
      <RegisterPage portal={portal} />
    </MemoryRouter>,
  )

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const fillBasics = () => {
  type(/full name/i, 'Asha Rao')
  type(/email address/i, 'asha@example.com')
  type(/^password/i, 'password123')
  type(/confirm password/i, 'password123')
}
const optionTexts = (label: RegExp) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.text)
const waitColleges = () => waitFor(() => expect(optionTexts(COLLEGE)).toContain('Beta Institute'))

async function pick(college: string, branch: string, section: string) {
  fireEvent.change(screen.getByLabelText(COLLEGE), { target: { value: college } })
  await waitFor(() => expect(optionTexts(BRANCH).length).toBeGreaterThan(1))
  fireEvent.change(screen.getByLabelText(BRANCH), { target: { value: branch } })
  await waitFor(() => expect(optionTexts(SECTION).length).toBeGreaterThan(1))
  fireEvent.change(screen.getByLabelText(SECTION), { target: { value: section } })
}

beforeEach(() => {
  register.mockReset()
  listColleges.mockReset().mockResolvedValue(COLLEGES)
  listBranches.mockReset().mockImplementation(async (id: string) => BRANCHES[id] ?? [])
  listSections.mockReset().mockImplementation(async (id: string) => SECTIONS[id] ?? [])
})

describe('registration: college -> branch -> section', () => {
  it('teacher form has the requested fields, no role question, and colleges come from the API', async () => {
    renderPage('teacher')
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument()
    await waitFor(() => expect(optionTexts(COLLEGE)).toContain('Alpha College — Pune'))
    for (const l of [/full name/i, /email address/i, /^password/i, /confirm password/i, COLLEGE, /college code/i, BRANCH, SECTION]) {
      expect(screen.getByLabelText(l)).toBeInTheDocument()
    }
    expect(screen.getByLabelText(BRANCH)).toBeDisabled()
    expect(screen.getByLabelText(SECTION)).toBeDisabled()
  })

  it('changing the college reloads branches and clears branch and section; changing the branch clears the section', async () => {
    renderPage('teacher')
    await waitColleges()
    fireEvent.change(screen.getByLabelText(COLLEGE), { target: { value: 'col-a' } })
    await waitFor(() => expect(optionTexts(BRANCH)).toEqual(['Select your branch', 'Computer Science (CSE)', 'Electronics']))
    fireEvent.change(screen.getByLabelText(BRANCH), { target: { value: 'br-cse' } })
    await waitFor(() => expect(optionTexts(SECTION)).toEqual(['Select your section', 'Section A', 'Section B', 'All Sections']))
    fireEvent.change(screen.getByLabelText(SECTION), { target: { value: 'sec-b' } })

    fireEvent.change(screen.getByLabelText(BRANCH), { target: { value: 'br-ece' } })
    await waitFor(() => expect(optionTexts(SECTION)).toContain('Section E'))
    expect((screen.getByLabelText(SECTION) as HTMLSelectElement).value).toBe('')

    fireEvent.change(screen.getByLabelText(BRANCH), { target: { value: 'br-cse' } })
    await waitFor(() => expect(optionTexts(SECTION)).toContain('Section B'))
    fireEvent.change(screen.getByLabelText(SECTION), { target: { value: 'sec-a' } })
    fireEvent.change(screen.getByLabelText(COLLEGE), { target: { value: 'col-b' } })
    await waitFor(() => expect(optionTexts(BRANCH)).toEqual(['Select your branch', 'Mechanical (ME)']))
    expect((screen.getByLabelText(BRANCH) as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText(SECTION) as HTMLSelectElement).value).toBe('')
    expect(screen.getByLabelText(SECTION)).toBeDisabled()
    expect(listBranches).toHaveBeenLastCalledWith('col-b')
  })

  it('only teachers get the All Sections option', async () => {
    renderPage('student')
    await waitColleges()
    fireEvent.change(screen.getByLabelText(COLLEGE), { target: { value: 'col-a' } })
    await waitFor(() => expect(optionTexts(BRANCH).length).toBeGreaterThan(1))
    fireEvent.change(screen.getByLabelText(BRANCH), { target: { value: 'br-cse' } })
    await waitFor(() => expect(optionTexts(SECTION)).toEqual(['Select your section', 'Section A', 'Section B']))
  })

  it('shows field-specific validation errors and does not call the server', async () => {
    renderPage('teacher')
    await waitColleges()
    type(/full name/i, 'Asha Rao')
    type(/email address/i, 'asha@example.com')
    type(/^password/i, 'password123')
    type(/confirm password/i, 'different123')
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(screen.getByText('Select your college.')).toBeInTheDocument()
    expect(screen.getByText(/Enter the college code/)).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  it('asks for the branch and the section in turn', async () => {
    renderPage('teacher')
    await waitColleges()
    fillBasics()
    type(/college code/i, 'EV-AAAA-2222')
    fireEvent.change(screen.getByLabelText(COLLEGE), { target: { value: 'col-a' } })
    await waitFor(() => expect(optionTexts(BRANCH).length).toBeGreaterThan(1))
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    expect(await screen.findByText('Select your branch.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(BRANCH), { target: { value: 'br-cse' } })
    await waitFor(() => expect(optionTexts(SECTION).length).toBeGreaterThan(1))
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    expect(await screen.findByText('Select a section or All Sections.')).toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  it('rejects a short password with the backend policy (8 characters)', async () => {
    renderPage('student')
    await waitColleges()
    type(/^password/i, 'short1')
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    expect(await screen.findByText('Password must be at least 8 characters long.')).toBeInTheDocument()
  })

  it('submits a specific section once and keeps every value on a server error', async () => {
    let reject!: (e: unknown) => void
    register.mockImplementation(() => new Promise((_, rej) => { reject = rej }))
    renderPage('teacher')
    await waitColleges()
    fillBasics()
    await pick('col-a', 'br-cse', 'sec-a')
    type(/college code/i, 'EV-WRONG-CODE')
    const submit = screen.getByRole('button', { name: /register/i })
    fireEvent.click(submit)
    fireEvent.click(submit) // double click must not send twice
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('asha@example.com', 'Asha Rao', 'password123', 'teacher', undefined, {
      collegeId: 'col-a', branchId: 'br-cse', sectionId: 'sec-a', allSections: false, collegeCode: 'EV-WRONG-CODE',
    })
    reject(new ApiError('The college code is incorrect for the selected college.', 422, false, 'INVALID_COLLEGE_CODE'))
    expect(await screen.findByText('The college code is incorrect for the selected college.')).toBeInTheDocument()
    expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe('Asha Rao')
    expect((screen.getByLabelText(/college code/i) as HTMLInputElement).value).toBe('EV-WRONG-CODE')
    expect((screen.getByLabelText(BRANCH) as HTMLSelectElement).value).toBe('br-cse')
    expect((screen.getByLabelText(SECTION) as HTMLSelectElement).value).toBe('sec-a')
  })

  it('"All Sections" is sent as a branch-wide flag, never as a section id', async () => {
    register.mockResolvedValue({ role: 'teacher' })
    renderPage('teacher')
    await waitColleges()
    fillBasics()
    await pick('col-a', 'br-cse', '__all_sections__')
    type(/college code/i, 'EV-AAAA-2222')
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    await waitFor(() => expect(register).toHaveBeenCalled())
    expect(register.mock.calls[0][5]).toEqual({
      collegeId: 'col-a', branchId: 'br-cse', sectionId: undefined, allSections: true, collegeCode: 'EV-AAAA-2222',
    })
  })

  it('shows a duplicate email next to the email field and a network failure as a banner', async () => {
    register.mockRejectedValueOnce(new ApiError('An account with this email already exists.', 409, false, 'EMAIL_TAKEN'))
    renderPage('student')
    await waitColleges()
    fillBasics()
    await pick('col-a', 'br-cse', 'sec-a')
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument()
    register.mockRejectedValueOnce(new ApiError('Network', 0, true))
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument()
  })

  it('a student sends the hierarchy but no college code', async () => {
    register.mockResolvedValue({ role: 'student' })
    renderPage('student')
    await waitColleges()
    expect(screen.queryByLabelText(/college code/i)).not.toBeInTheDocument()
    fillBasics()
    await pick('col-b', 'br-me', 'sec-m')
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    await waitFor(() => expect(register).toHaveBeenCalled())
    expect(register.mock.calls[0][5]).toEqual({ collegeId: 'col-b', branchId: 'br-me', sectionId: 'sec-m', allSections: false, collegeCode: '' })
  })

  it('shows empty and error states for colleges, branches and sections', async () => {
    listColleges.mockResolvedValueOnce([])
    const { unmount } = renderPage('teacher')
    expect(await screen.findByText(/No colleges are open for registration yet/)).toBeInTheDocument()
    unmount()

    listColleges.mockRejectedValueOnce(new Error('down'))
    renderPage('student')
    expect(await screen.findByText(/Could not load colleges/)).toBeInTheDocument()
    listColleges.mockResolvedValueOnce(COLLEGES)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitColleges()

    listBranches.mockRejectedValueOnce(new Error('down'))
    fireEvent.change(screen.getByLabelText(COLLEGE), { target: { value: 'col-a' } })
    expect(await screen.findByText(/Could not load branches/)).toBeInTheDocument()

    listBranches.mockResolvedValueOnce([])
    fireEvent.change(screen.getByLabelText(COLLEGE), { target: { value: 'col-b' } })
    expect(await screen.findByText(/This college has no branches yet/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(COLLEGE), { target: { value: 'col-a' } })
    await waitFor(() => expect(optionTexts(BRANCH).length).toBeGreaterThan(1))
    listSections.mockRejectedValueOnce(new Error('down'))
    fireEvent.change(screen.getByLabelText(BRANCH), { target: { value: 'br-cse' } })
    expect(await screen.findByText(/Could not load sections/)).toBeInTheDocument()

    listSections.mockResolvedValueOnce([])
    fireEvent.change(screen.getByLabelText(BRANCH), { target: { value: 'br-ece' } })
    expect(await screen.findByText(/This branch has no sections yet/)).toBeInTheDocument()
  })

  it('re-fetches branches when the server says the branch is no longer open', async () => {
    register.mockRejectedValueOnce(new ApiError('This branch is not available.', 409, false, 'BRANCH_INACTIVE'))
    renderPage('student')
    await waitColleges()
    fillBasics()
    await pick('col-a', 'br-cse', 'sec-a')
    const callsBefore = listBranches.mock.calls.length
    listBranches.mockResolvedValueOnce([BRANCHES['col-a'][1]])
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    expect(await screen.findByText('This branch is not available.')).toBeInTheDocument()
    await waitFor(() => expect(listBranches.mock.calls.length).toBe(callsBefore + 1))
    await waitFor(() => expect(optionTexts(BRANCH)).not.toContain('Computer Science (CSE)'))
  })

  it('re-fetches colleges when the server says the college is no longer open', async () => {
    register.mockRejectedValueOnce(new ApiError('This college is not accepting registrations.', 409, false, 'COLLEGE_INACTIVE'))
    renderPage('student')
    await waitColleges()
    fillBasics()
    await pick('col-a', 'br-cse', 'sec-a')
    listColleges.mockResolvedValueOnce([COLLEGES[1]])
    fireEvent.click(screen.getByRole('button', { name: /register/i }))
    expect(await screen.findByText('This college is not accepting registrations.')).toBeInTheDocument()
    await waitFor(() => expect(optionTexts(COLLEGE)).not.toContain('Alpha College — Pune'))
  })
})
