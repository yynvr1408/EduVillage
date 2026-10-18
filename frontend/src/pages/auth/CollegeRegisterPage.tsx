import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Building2, Clock, Mail, ShieldCheck } from 'lucide-react'
import { authService } from '../../services/authService'
import { registrationApi } from '../../services/registrationApi'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'
import { Logo } from '../../components/ui/Logo'
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher'

const OTP_TTL_SECONDS = 5 * 60
const RESEND_COOLDOWN_SECONDS = 60
const formatMMSS = (totalSeconds: number) => {
  const s = Math.max(0, totalSeconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type FieldKey = 'collegeName' | 'adminFullName' | 'adminEmail' | 'adminPassword' | 'confirmPassword'
type FieldErrors = Partial<Record<FieldKey, string>>

/**
 * Self-service college registration: the submitting person becomes the college's founding
 * administrator once a platform admin approves the request (see college_service.approve_college_request).
 * Mirrors RegisterPage's inline form -> OTP -> done step pattern, reusing the exact same
 * email-verification endpoints — just for the founding admin's own email, not a student/teacher's.
 */
export const CollegeRegisterPage: React.FC = () => {
  const [collegeName, setCollegeName] = useState('')
  const [location, setLocation] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [adminFullName, setAdminFullName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [step, setStep] = useState<'form' | 'otp' | 'submitted'>('form')
  const [otp, setOtp] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
  const [isResendingOtp, setIsResendingOtp] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(OTP_TTL_SECONDS)
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS)
  const otpInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step !== 'otp') return
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [step])

  useEffect(() => {
    if (step !== 'otp' || resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [step, resendCooldown])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return

    const errs: FieldErrors = {}
    if (!collegeName.trim()) errs.collegeName = 'Enter the institution name.'
    if (!adminFullName.trim()) errs.adminFullName = 'Enter your full name.'
    if (!adminEmail.trim()) errs.adminEmail = 'Enter your email address.'
    if (!adminPassword) errs.adminPassword = 'Enter a password.'
    else if (adminPassword.length < 8) errs.adminPassword = 'Password must be at least 8 characters long.'
    if (adminPassword && confirmPassword !== adminPassword) errs.confirmPassword = 'Passwords do not match.'
    setFieldErrors(errs)
    setError(null)
    if (Object.keys(errs).length > 0) return

    setIsLoading(true)
    try {
      await authService.requestRegistrationOtp(adminEmail.trim())
      setSecondsLeft(OTP_TTL_SECONDS)
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setOtp('')
      setOtpError(null)
      setStep('otp')
    } catch (err: any) {
      setError(
        err?.isNetworkError ? 'Cannot reach the server. Check your connection and try again.' : err?.message || 'Could not send a verification code. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isVerifyingOtp) return
    if (otp.length !== 6) {
      setOtpError('Enter the full 6-digit code.')
      return
    }
    setIsVerifyingOtp(true)
    setOtpError(null)
    try {
      const { verification_token: verificationToken } = await authService.verifyRegistrationOtp(adminEmail.trim(), otp)
      await registrationApi.requestCollegeRegistration({
        collegeName: collegeName.trim(),
        location: location.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        adminFullName: adminFullName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
        verificationToken,
      })
      setStep('submitted')
    } catch (err: any) {
      if (err?.code === 'EMAIL_TAKEN') {
        setStep('form')
        setFieldErrors({ adminEmail: err.message })
      } else {
        setOtpError(
          err?.isNetworkError ? 'Cannot reach the server. Check your connection and try again.' : err?.message || 'That code is incorrect or has expired.'
        )
        setOtp('')
        otpInputRef.current?.focus()
      }
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || isResendingOtp) return
    setIsResendingOtp(true)
    setOtpError(null)
    try {
      await authService.requestRegistrationOtp(adminEmail.trim())
      setSecondsLeft(OTP_TTL_SECONDS)
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setOtp('')
    } catch (err: any) {
      setOtpError(err?.isNetworkError ? 'Cannot reach the server. Check your connection and try again.' : 'Could not resend the code. Please try again.')
    } finally {
      setIsResendingOtp(false)
    }
  }

  if (step === 'submitted') {
    return (
      <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
          <div className="flex justify-end mb-3">
            <LanguageSwitcher />
          </div>
          <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs text-center">
            <div className="w-12 h-12 rounded-full bg-[#DDF3EA] border border-[#CBD7D1] flex items-center justify-center text-[#0F5B57] mx-auto mb-4">
              <Mail className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#202B2A] mb-2">Request Submitted</h1>
            <p className="text-xs sm:text-sm text-[#687775] leading-relaxed">
              Your institution's registration request has been submitted and is awaiting approval from the
              platform administrator. You'll be able to sign in as the institution administrator once it's approved.
            </p>
            <Link to="/login" className="mt-6 inline-block text-xs font-semibold text-[#0F5B57] hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'otp') {
    const expired = secondsLeft <= 0
    return (
      <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
          <div className="flex justify-end mb-3">
            <LanguageSwitcher />
          </div>
          <div className="flex flex-col items-center text-center mb-6">
            <Logo size={48} className="mb-3" />
            <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">Verify Your Email</h1>
            <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
              We sent a 6-digit code to <strong className="text-[#202B2A]">{adminEmail}</strong>.
            </p>
          </div>

          <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
            {otpError && (
              <div className="mb-4 p-3 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-[#B42318] text-xs" role="alert">
                {otpError}
              </div>
            )}

            <form onSubmit={handleVerifyAndSubmit} className="flex flex-col gap-4" noValidate>
              <FormField label="Verification Code" htmlFor="collegeRegisterOtp" required>
                <input
                  ref={otpInputRef}
                  id="collegeRegisterOtp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
                    setOtpError(null)
                  }}
                  maxLength={6}
                  className="w-full text-center text-2xl font-mono tracking-[0.5em] pl-[0.5em] py-3 rounded-lg border border-[#CBD7D1] bg-[#FFFFFF] text-[#202B2A] focus:outline-none focus:ring-2 focus:ring-[#0F5B57] focus:border-[#0F5B57]"
                  required
                />
              </FormField>

              <div className="flex items-center justify-center gap-1.5 text-xs text-[#687775]" role="status">
                <Clock className="w-3.5 h-3.5" />
                {expired ? <span className="text-[#B42318] font-medium">This code has expired.</span> : <span>Expires in {formatMMSS(secondsLeft)}</span>}
              </div>

              <Button type="submit" fullWidth isLoading={isVerifyingOtp} disabled={otp.length !== 6} icon={<ShieldCheck className="w-4 h-4" />}>
                Verify & Submit Request
              </Button>

              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendCooldown > 0 || isResendingOtp}
                  className="text-xs font-semibold text-[#0F5B57] hover:underline disabled:text-[#687775] disabled:no-underline disabled:cursor-not-allowed cursor-pointer"
                >
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : isResendingOtp ? 'Sending...' : 'Resend code'}
                </button>
              </div>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  className="text-xs text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Edit request details
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="flex justify-end mb-3">
          <LanguageSwitcher />
        </div>
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={48} className="mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">Register Your Institution</h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
            Submitted requests are reviewed by the platform administrator. Once approved, you'll be able to sign in
            as this institution's administrator and set up its branches and sections.
          </p>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-[#B42318] text-xs flex items-center gap-2" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <p className="text-xs font-bold text-[#687775] uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> Institution Details
            </p>
            <FormField label="Institution Name" htmlFor="collegeName" required error={fieldErrors.collegeName}>
              <Input
                id="collegeName"
                value={collegeName}
                onChange={(e) => setCollegeName(e.target.value)}
                placeholder="e.g. Riverside College"
                isError={!!fieldErrors.collegeName}
                required
              />
            </FormField>
            <FormField label="Location" htmlFor="collegeLocation" hint="Optional">
              <Input id="collegeLocation" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, country" />
            </FormField>
            <FormField label="Contact Email" htmlFor="contactEmail" hint="Optional — used for institution-wide notices, e.g. account-deletion confirmation">
              <Input
                id="contactEmail"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="registrar@institution.edu"
              />
            </FormField>
            <FormField label="Contact Phone" htmlFor="contactPhone" hint="Optional">
              <Input id="contactPhone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </FormField>

            <p className="text-xs font-bold text-[#687775] uppercase tracking-wider pt-2">Your Account (Institution Administrator)</p>
            <FormField label="Full Name" htmlFor="adminFullName" required error={fieldErrors.adminFullName}>
              <Input
                id="adminFullName"
                value={adminFullName}
                onChange={(e) => setAdminFullName(e.target.value)}
                isError={!!fieldErrors.adminFullName}
                required
              />
            </FormField>
            <FormField label="Email Address" htmlFor="adminEmail" required error={fieldErrors.adminEmail}>
              <Input
                id="adminEmail"
                type="email"
                autoComplete="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                isError={!!fieldErrors.adminEmail}
                required
              />
            </FormField>
            <FormField label="Password" htmlFor="adminPassword" required hint="Min. 8 characters" error={fieldErrors.adminPassword}>
              <Input
                id="adminPassword"
                type="password"
                isPassword
                autoComplete="new-password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                isError={!!fieldErrors.adminPassword}
                required
              />
            </FormField>
            <FormField label="Confirm Password" htmlFor="confirmPassword" required error={fieldErrors.confirmPassword}>
              <Input
                id="confirmPassword"
                type="password"
                isPassword
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                isError={!!fieldErrors.confirmPassword}
                required
              />
            </FormField>

            <Button type="submit" fullWidth isLoading={isLoading} icon={<Building2 className="w-4 h-4" />} className="mt-3">
              Send Verification Code
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-[#687775] mt-6">
          Already registered? <Link to="/login" className="font-semibold text-[#0F5B57] hover:underline">Sign in here</Link>
        </p>
      </div>
    </div>
  )
}
