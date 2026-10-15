import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'

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
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#111111] text-[#FFFFFF] flex items-center justify-center font-bold text-xl mb-3 shadow-sm">
            EV
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">
            Password Recovery
          </h1>
          <p className="text-xs text-[#666666] mt-1 max-w-xs">
            Enter your registered email to receive access recovery instructions.
          </p>
        </div>

        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-6 sm:p-8 shadow-xs">
          {submitted ? (
            <div className="text-center py-4 flex flex-col items-center">
              <CheckCircle2 className="w-12 h-12 text-[#166534] mb-3" />
              <h2 className="text-base font-bold text-[#111111] mb-1">Recovery Instructions Sent</h2>
              <p className="text-xs text-[#666666] mb-6">
                If an account exists for <strong className="text-[#111111]">{email}</strong>, you will receive password reset instructions.
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
                  className="text-xs text-[#666666] hover:text-[#111111] inline-flex items-center gap-1 font-medium"
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
