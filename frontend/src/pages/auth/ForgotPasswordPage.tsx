import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'
import { Logo } from '../../components/ui/Logo'

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email.trim()) {
      setSubmitted(true)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={48} className="mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">
            Password Recovery
          </h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
            Enter your registered email to receive access recovery instructions.
          </p>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
          {submitted ? (
            <div className="text-center py-4 flex flex-col items-center">
              <CheckCircle2 className="w-12 h-12 text-[#247A4D] mb-3" />
              <h2 className="text-base font-bold text-[#202B2A] mb-1">Recovery Instructions Sent</h2>
              <p className="text-xs text-[#687775] mb-6 leading-relaxed">
                If an account exists for <strong className="text-[#202B2A]">{email}</strong>, you will receive password reset instructions.
              </p>
              <Link to="/login" className="w-full">
                <Button fullWidth variant="outline" icon={<ArrowLeft className="w-4 h-4" />}>
                  Back to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <FormField label="Email Address" htmlFor="email" required>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  leftIcon={<Mail className="w-4 h-4" />}
                  required
                />
              </FormField>

              <Button type="submit" fullWidth className="mt-2">
                Send Recovery Instructions
              </Button>

              <div className="text-center pt-2">
                <Link
                  to="/login"
                  className="text-xs text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1 font-semibold"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
