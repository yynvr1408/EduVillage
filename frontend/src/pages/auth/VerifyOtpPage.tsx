import React, { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, Clock } from 'lucide-react'
import { authService } from '../../services/authService'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { Logo } from '../../components/ui/Logo'

const OTP_TTL_SECONDS = 5 * 60
const RESEND_COOLDOWN_SECONDS = 60

const formatMMSS = (totalSeconds: number) => {
  const s = Math.max(0, totalSeconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const VerifyOtpPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const email = (location.state as { email?: string } | null)?.email

  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(OTP_TTL_SECONDS)
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Direct/refreshed navigation with no email in state: nothing to verify against.
    if (!email) navigate('/forgot-password', { replace: true })
  }, [email, navigate])

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [resendCooldown])

  if (!email) return null

  const handleOtpChange = (raw: string) => {
    const digitsOnly = raw.replace(/\D/g, '').slice(0, 6)
    setOtp(digitsOnly)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    if (otp.length !== 6) {
      setError('Enter the full 6-digit code.')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const { reset_token: resetToken } = await authService.verifyResetOtp(email, otp)
      navigate('/reset-password', { state: { resetToken, email }, replace: true })
    } catch (err: any) {
      setError(
        err?.isNetworkError
          ? 'Cannot reach the server. Check your connection and try again.'
          : err?.message || 'That code is incorrect or has expired.'
      )
      setOtp('')
      inputRef.current?.focus()
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    if (resendCooldown > 0 || isResending) return
    setIsResending(true)
    setError(null)
    try {
      await authService.requestPasswordResetOtp(email)
      setSecondsLeft(OTP_TTL_SECONDS)
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setOtp('')
    } catch (err: any) {
      setError(err?.isNetworkError ? 'Cannot reach the server. Check your connection and try again.' : 'Could not resend the code. Please try again.')
    } finally {
      setIsResending(false)
    }
  }

  const expired = secondsLeft <= 0

  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={48} className="mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">Enter Verification Code</h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
            We sent a 6-digit code to <strong className="text-[#202B2A]">{email}</strong>.
          </p>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-[#B42318] text-xs" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <FormField label="Verification Code" htmlFor="otp" required>
              <input
                ref={inputRef}
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={otp}
                onChange={(e) => handleOtpChange(e.target.value)}
                maxLength={6}
                className="w-full text-center text-2xl font-mono tracking-[0.5em] pl-[0.5em] py-3 rounded-lg border border-[#CBD7D1] bg-[#FFFFFF] text-[#202B2A] focus:outline-none focus:ring-2 focus:ring-[#0F5B57] focus:border-[#0F5B57]"
                required
              />
            </FormField>

            <div className="flex items-center justify-center gap-1.5 text-xs text-[#687775]" role="status">
              <Clock className="w-3.5 h-3.5" />
              {expired ? <span className="text-[#B42318] font-medium">This code has expired.</span> : <span>Expires in {formatMMSS(secondsLeft)}</span>}
            </div>

            <Button type="submit" fullWidth isLoading={isLoading} disabled={otp.length !== 6} icon={<ShieldCheck className="w-4 h-4" />}>
              Verify Code
            </Button>

            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || isResending}
                className="text-xs font-semibold text-[#0F5B57] hover:underline disabled:text-[#687775] disabled:no-underline disabled:cursor-not-allowed cursor-pointer"
              >
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : isResending ? 'Sending...' : 'Resend code'}
              </button>
            </div>

            <div className="text-center pt-2">
              <Link to="/forgot-password" className="text-xs text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1 font-semibold">
                <ArrowLeft className="w-3.5 h-3.5" /> Use a different email
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
