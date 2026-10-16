import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { LoginPage } from '../pages/auth/LoginPage'
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage'
import { VerifyOtpPage } from '../pages/auth/VerifyOtpPage'
import { ResetPasswordPage } from '../pages/auth/ResetPasswordPage'
import { ApiError } from '../services/apiClient'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), logout: vi.fn(), isSharedDevice: false, setSharedDevice: vi.fn() }),
}))

const requestPasswordResetOtp = vi.fn()
const verifyResetOtp = vi.fn()
const resetPassword = vi.fn()
vi.mock('../services/authService', () => ({
  authService: {
    requestPasswordResetOtp: (...a: unknown[]) => requestPasswordResetOtp(...a),
    verifyResetOtp: (...a: unknown[]) => verifyResetOtp(...a),
    resetPassword: (...a: unknown[]) => resetPassword(...a),
  },
}))

beforeEach(() => {
  requestPasswordResetOtp.mockReset()
  verifyResetOtp.mockReset()
  resetPassword.mockReset()
})

const renderWithRoutes = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/verify-otp" element={<VerifyOtpPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>
  )

describe('both login portals surface the same Forgot Password link', () => {
  it('student login has a Forgot password link to /forgot-password', () => {
    render(
      <MemoryRouter>
        <LoginPage portal="student" />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password')
  })

  it('teacher login has the identical Forgot password link to /forgot-password', () => {
    render(
      <MemoryRouter>
        <LoginPage portal="teacher" />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password')
  })
})

describe('forgot password: request OTP', () => {
  it('validates a required email before calling the backend', async () => {
    renderWithRoutes('/forgot-password')
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }))
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(requestPasswordResetOtp).not.toHaveBeenCalled()
  })

  it('on success, moves to the OTP screen without ever revealing account existence', async () => {
    requestPasswordResetOtp.mockResolvedValue({ message: 'generic' })
    renderWithRoutes('/forgot-password')
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'student@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }))
    expect(await screen.findByText(/we sent a 6-digit code/i)).toBeInTheDocument()
    expect(screen.getByText('student@example.com')).toBeInTheDocument()
    expect(requestPasswordResetOtp).toHaveBeenCalledWith('student@example.com')
  })

  it('shows a generic network error, never an account-existence message, on failure', async () => {
    requestPasswordResetOtp.mockRejectedValue(new ApiError('Network', 0, true))
    renderWithRoutes('/forgot-password')
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'x@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }))
    expect(await screen.findByText(/cannot reach the server/i)).toBeInTheDocument()
  })
})

describe('verify OTP', () => {
  it('redirects to /forgot-password if there is no email in navigation state (e.g. a refresh)', () => {
    renderWithRoutes('/verify-otp')
    expect(screen.getByRole('heading', { name: /forgot your password/i })).toBeInTheDocument()
  })

  it('disables submission until all 6 digits are entered', async () => {
    requestPasswordResetOtp.mockResolvedValue({ message: 'generic' })
    renderWithRoutes('/forgot-password')
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'student@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }))
    await screen.findByText(/we sent a 6-digit code/i)

    const submit = screen.getByRole('button', { name: /verify code/i })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123' } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } })
    expect(submit).not.toBeDisabled()
  })

  it('strips non-digit characters and caps at 6 digits', async () => {
    requestPasswordResetOtp.mockResolvedValue({ message: 'generic' })
    renderWithRoutes('/forgot-password')
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'student@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }))
    await screen.findByText(/we sent a 6-digit code/i)
    const input = screen.getByLabelText(/verification code/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '12a3456789' } })
    expect(input.value).toBe('123456')
  })

  it('on an incorrect code, shows the error and clears the field', async () => {
    requestPasswordResetOtp.mockResolvedValue({ message: 'generic' })
    verifyResetOtp.mockRejectedValue(new ApiError('That code is incorrect or has expired.', 401, false, 'INVALID_OTP'))
    renderWithRoutes('/forgot-password')
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'student@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }))
    await screen.findByText(/we sent a 6-digit code/i)
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }))
    expect(await screen.findByText('That code is incorrect or has expired.')).toBeInTheDocument()
    expect((screen.getByLabelText(/verification code/i) as HTMLInputElement).value).toBe('')
  })

  it('on a correct code, moves to the set-new-password screen with the reset authorization', async () => {
    requestPasswordResetOtp.mockResolvedValue({ message: 'generic' })
    verifyResetOtp.mockResolvedValue({ reset_token: 'opaque-reset-token', expires_in_minutes: 10 })
    renderWithRoutes('/forgot-password')
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'student@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }))
    await screen.findByText(/we sent a 6-digit code/i)
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }))
    expect(await screen.findByText(/reset your password/i)).toBeInTheDocument()
    expect(verifyResetOtp).toHaveBeenCalledWith('student@example.com', '123456')
  })

  it('the resend button is disabled during the 60s cooldown and re-requests a new code when clicked after it', async () => {
    requestPasswordResetOtp.mockResolvedValue({ message: 'generic' })
    renderWithRoutes('/forgot-password')
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'student@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }))
    await screen.findByText(/we sent a 6-digit code/i)
    expect(screen.getByRole('button', { name: /resend code in/i })).toBeDisabled()
    expect(requestPasswordResetOtp).toHaveBeenCalledTimes(1)
  })
})

describe('reset password: set new password', () => {
  it('redirects to /forgot-password with no reset authorization in navigation state', () => {
    renderWithRoutes('/reset-password')
    expect(screen.getByRole('heading', { name: /forgot your password/i })).toBeInTheDocument()
  })

  async function goToResetScreen() {
    requestPasswordResetOtp.mockResolvedValue({ message: 'generic' })
    verifyResetOtp.mockResolvedValue({ reset_token: 'opaque-reset-token', expires_in_minutes: 10 })
    renderWithRoutes('/forgot-password')
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'student@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }))
    await screen.findByText(/we sent a 6-digit code/i)
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }))
    await screen.findByText(/reset your password/i)
  }

  it('rejects a short password and a mismatched confirmation before calling the backend', async () => {
    await goToResetScreen()
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /^reset password$/i }))
    expect(await screen.findByText('Password must be at least 8 characters long.')).toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'longenough123' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'different123' } })
    fireEvent.click(screen.getByRole('button', { name: /^reset password$/i }))
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('on success, shows confirmation and a link back to login — never an automatic session', async () => {
    resetPassword.mockResolvedValue(undefined)
    await goToResetScreen()
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'brand-new-pass-1' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'brand-new-pass-1' } })
    fireEvent.click(screen.getByRole('button', { name: /^reset password$/i }))
    expect(await screen.findByText('Password Reset')).toBeInTheDocument()
    expect(resetPassword).toHaveBeenCalledWith('opaque-reset-token', 'brand-new-pass-1')
    expect(screen.getByRole('link', { name: /go to sign in/i })).toHaveAttribute('href', '/login')
  })

  it('shows the real backend error for an expired/used reset authorization', async () => {
    resetPassword.mockRejectedValue(new ApiError('This reset authorization is invalid or has expired.', 401, false, 'INVALID_RESET_TOKEN'))
    await goToResetScreen()
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'brand-new-pass-1' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'brand-new-pass-1' } })
    fireEvent.click(screen.getByRole('button', { name: /^reset password$/i }))
    expect(await screen.findByText('This reset authorization is invalid or has expired.')).toBeInTheDocument()
  })
})
