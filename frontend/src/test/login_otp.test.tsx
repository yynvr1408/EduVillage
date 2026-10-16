import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LoginPage } from '../pages/auth/LoginPage'
import { ApiError } from '../services/apiClient'

const login = vi.fn()
const verifyLoginOtp = vi.fn()
const logout = vi.fn(async () => {})
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login, verifyLoginOtp, logout, isSharedDevice: false, setSharedDevice: vi.fn() }),
}))

const challenge = {
  otp_required: true as const, email: 'amina@example.com', message: 'This account is signed in on another device.',
  otp_ttl_minutes: 5, resend_cooldown_seconds: 60,
}
const student = { id: 'u', full_name: 'Amina', email: 'amina@example.com', role: 'student', status: 'active' }

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/login/student']}>
      <Routes>
        <Route path="/login/student" element={<LoginPage portal="student" />} />
        <Route path="/student/dashboard" element={<div>Student dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  )

const submitCredentials = () => {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'amina@example.com' } })
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
}

beforeEach(() => {
  login.mockReset()
  verifyLoginOtp.mockReset()
})

describe('second-device sign-in needs the emailed code', () => {
  it('a normal sign-in is unchanged and goes straight to the dashboard', async () => {
    login.mockResolvedValue(student)
    renderPage()
    submitCredentials()
    expect(await screen.findByText('Student dashboard')).toBeInTheDocument()
    expect(screen.queryByLabelText('Verification Code')).not.toBeInTheDocument()
  })

  it('shows the code step instead of signing in, then signs in after the right code', async () => {
    login.mockResolvedValue(challenge)
    verifyLoginOtp.mockResolvedValue(student)
    renderPage()
    submitCredentials()
    expect(await screen.findByText(/signed in on another device/)).toBeInTheDocument()
    expect(screen.queryByText('Student dashboard')).not.toBeInTheDocument()
    const verify = screen.getByRole('button', { name: 'Verify and Sign In' })
    expect(verify).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '12ab3456' } })
    expect((screen.getByLabelText(/verification code/i) as HTMLInputElement).value).toBe('123456') // digits only, max 6
    fireEvent.click(verify)
    expect(await screen.findByText('Student dashboard')).toBeInTheDocument()
    expect(verifyLoginOtp).toHaveBeenCalledWith('amina@example.com', '123456')
  })

  it('shows a wrong-code error, clears the field and stays on the code step', async () => {
    login.mockResolvedValue(challenge)
    verifyLoginOtp.mockRejectedValue(new ApiError('That code is incorrect or has expired.', 401, false, 'INVALID_OTP'))
    renderPage()
    submitCredentials()
    await screen.findByText(/signed in on another device/)
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and Sign In' }))
    expect(await screen.findByText('That code is incorrect or has expired.')).toBeInTheDocument()
    expect((screen.getByLabelText(/verification code/i) as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('Student dashboard')).not.toBeInTheDocument()
  })

  it('resend is locked during the cooldown and Back returns to the password form', async () => {
    login.mockResolvedValue(challenge)
    renderPage()
    submitCredentials()
    await screen.findByText(/signed in on another device/)
    expect(screen.getByRole('button', { name: /Resend code in/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument())
  })

  it('shows the send failure from the server', async () => {
    login.mockRejectedValue(new ApiError('We could not send the verification code. Please try again shortly.', 503, false, 'OTP_SEND_FAILED'))
    renderPage()
    submitCredentials()
    expect(await screen.findByText(/could not send the verification code/)).toBeInTheDocument()
  })
})
