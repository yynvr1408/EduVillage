import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, KeyRound } from 'lucide-react'
import { authService } from '../../services/authService'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'
import { Logo } from '../../components/ui/Logo'

type FieldErrors = Partial<Record<'newPassword' | 'confirmPassword', string>>

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { resetToken?: string; email?: string } | null
  const resetToken = state?.resetToken

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [isDone, setIsDone] = useState(false)

  useEffect(() => {
    // No reset authorization in navigation state (direct link, refresh, or arriving without
    // having verified a code): there is nothing valid to submit against.
    if (!resetToken) navigate('/forgot-password', { replace: true })
  }, [resetToken, navigate])

  if (!resetToken) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return

    const errs: FieldErrors = {}
    if (!newPassword) errs.newPassword = 'Enter a new password.'
    else if (newPassword.length < 8) errs.newPassword = 'Password must be at least 8 characters long.'
    if (confirmPassword !== newPassword) errs.confirmPassword = 'Passwords do not match.'
    setFieldErrors(errs)
    setError(null)
    if (Object.keys(errs).length > 0) return

    setIsLoading(true)
    try {
      await authService.resetPassword(resetToken, newPassword)
      setIsDone(true)
    } catch (err: any) {
      setError(
        err?.isNetworkError
          ? 'Cannot reach the server. Check your connection and try again.'
          : err?.message || 'This reset link is invalid or has expired. Please request a new code.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={48} className="mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">Reset Your Password</h1>
          {!isDone && (
            <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
              Choose a new password for your EduVillage account.
            </p>
          )}
        </div>

        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
          {isDone ? (
            <div className="text-center py-4 flex flex-col items-center">
              <CheckCircle2 className="w-12 h-12 text-[#247A4D] mb-3" />
              <h2 className="text-base font-bold text-[#202B2A] mb-1">Password Reset</h2>
              <p className="text-xs text-[#687775] mb-6 leading-relaxed">
                Your password has been changed. Please sign in again with your new password.
              </p>
              <Link to="/login" className="w-full">
                <Button fullWidth icon={<ArrowLeft className="w-4 h-4" />}>Go to Sign In</Button>
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-[#B42318] text-xs" role="alert">
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <FormField label="New Password" htmlFor="newPassword" required hint="Min. 8 characters" error={fieldErrors.newPassword}>
                  <Input
                    id="newPassword"
                    type="password"
                    isPassword
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    isError={!!fieldErrors.newPassword}
                    required
                  />
                </FormField>

                <FormField label="Confirm New Password" htmlFor="confirmPassword" required error={fieldErrors.confirmPassword}>
                  <Input
                    id="confirmPassword"
                    type="password"
                    isPassword
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    isError={!!fieldErrors.confirmPassword}
                    required
                  />
                </FormField>

                <Button type="submit" fullWidth isLoading={isLoading} icon={<KeyRound className="w-4 h-4" />} className="mt-2">
                  Reset Password
                </Button>

                <div className="text-center pt-2">
                  <Link to="/login" className="text-xs text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1 font-semibold">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
