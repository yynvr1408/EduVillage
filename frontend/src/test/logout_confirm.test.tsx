import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppHeader } from '../components/layout/AppHeader'

const logout = vi.fn(async () => {})
let unsaved = { hasUnsaved: false, count: 0, draftTitles: [] as string[] }

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', full_name: 'Afzal', email: 'afzal97016458@gmail.com', role: 'student' },
    logout,
    switchUser: vi.fn(),
    checkUnsavedWork: async () => unsaved,
    isTeacher: false,
    isSharedDevice: false,
  }),
}))
vi.mock('../context/NetworkContext', () => ({ useNetworkStatus: () => ({ isOnline: true, quality: 'excellent' }) }))
vi.mock('../context/SyncContext', () => ({ useSync: () => ({ pendingCount: 0 }) }))
vi.mock('../components/ui/SyncStatusModal', () => ({ SyncStatusModal: () => null }))

const renderHeader = () =>
  render(
    <MemoryRouter initialEntries={['/student/dashboard']}>
      <Routes>
        <Route path="/student/dashboard" element={<AppHeader />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  logout.mockClear()
  unsaved = { hasUnsaved: false, count: 0, draftTitles: [] }
})

describe('header profile and sign-out', () => {
  it('shows only the user name, never the email address', () => {
    renderHeader()
    expect(screen.getByText('Afzal')).toBeInTheDocument()
    expect(screen.queryByText(/afzal97016458@gmail\.com/)).toBeNull()
    expect(screen.queryByText(/@/)).toBeNull()
  })

  it('asks for confirmation before signing out, and does nothing until the student confirms', async () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /log out or switch user/i }))

    expect(await screen.findByText('Confirm sign out')).toBeInTheDocument()
    expect(screen.getByText(/are you sure you want to log out/i)).toBeInTheDocument()
    expect(logout).not.toHaveBeenCalled() // clicking the icon alone must not sign anyone out

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Login page')).toBeInTheDocument()
  })

  it('Cancel keeps the student signed in', async () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /log out or switch user/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Confirm sign out')).toBeNull())
    expect(logout).not.toHaveBeenCalled()
    expect(screen.queryByText('Login page')).toBeNull()
  })

  it('with unsynchronized work the existing, stronger warning is shown instead (still a confirmation)', async () => {
    unsaved = { hasUnsaved: true, count: 1, draftTitles: ['Cell structure quiz'] }
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /log out or switch user/i }))
    expect(await screen.findByText('Unsynchronized Work on Device')).toBeInTheDocument()
    expect(screen.getByText('Cell structure quiz')).toBeInTheDocument()
    expect(screen.queryByText('Confirm sign out')).toBeNull()
    expect(logout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /proceed to sign out/i }))
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
  })
})
