import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { authService } from '../../services/authService'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'
import { Logo } from '../../components/ui/Logo'

export const ForgotPasswordPage: React.FC = () => {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    setError(null)
    setFieldError(null)
    if (!email.trim()) {
      setFieldError('Enter your email address.')
      return
    }

    setIsLoading(true)
    try {
      // The response is the same generic message whether or not the account exists — we only
      // ever move forward to the OTP screen, never reveal account-existence information here.
      await authService.requestPasswordResetOtp(email.trim())
      navigate('/verify-otp', { state: { email: email.trim() }, replace: true })
    } catch (err: any) {
      // A real network/server failure, not an account-existence signal (those never surface as errors).
      setError(err?.isNetworkError ? 'Cannot reach the server. Check your connection and try again.' : 'Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={48} className="mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">Forgot Your Password?</h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
            Enter the email address associated with your LanternEd account.
          </p>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-[#B42318] text-xs" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <FormField label="Email Address" htmlFor="email" required error={fieldError || undefined}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                isError={!!fieldError}
                required
              />
            </FormField>

            <Button type="submit" fullWidth isLoading={isLoading} className="mt-2">
              Send Verification Code
            </Button>

            <div className="text-center pt-2">
              <Link to="/login" className="text-xs text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1 font-semibold">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
