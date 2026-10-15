import React, { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { AlertCircle, LogIn, ArrowRight } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'

export const LoginPage: React.FC = () => {
  const { login, isSharedDevice, setSharedDevice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = (location.state as any)?.from?.pathname || '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Please provide both email and password.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const user = await login(email, password)
      if (from && from !== '/') {
        navigate(from, { replace: true })
      } else {
        navigate(user.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard', {
          replace: true,
        })
      }
    } catch (err: any) {
      setError(err.message || 'Invalid credentials or connection error.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDemoFill = (role: 'student' | 'teacher') => {
    if (role === 'student') {
      setEmail('student@eduvillage.org')
      setPassword('student123')
    } else {
      setEmail('teacher@eduvillage.org')
      setPassword('teacher123')
    }
    setError(null)
  }

  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#0F5B57] text-[#FFFFFF] flex items-center justify-center font-bold text-xl mb-3 shadow-sm">
            EV
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">
            EduVillage
          </h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
            Offline-first educational learning platform for reliable learning in low-bandwidth regions.
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
          <h2 className="text-lg font-bold text-[#202B2A] mb-5">Sign In to Your Account</h2>

          {error && (
            <div
              className="mb-5 p-3 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-[#B42318] text-xs flex items-center gap-2"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <FormField label="Email Address" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>

            <FormField label="Password" htmlFor="password" required>
              <Input
                id="password"
                type="password"
                isPassword
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>

            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-[#687775] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isSharedDevice}
                  onChange={(e) => setSharedDevice(e.target.checked)}
                  className="rounded border-[#CBD7D1] text-[#0F5B57] focus:ring-[#0F5B57]"
                />
                <span className="font-medium text-[#202B2A]">Using a shared community / school device?</span>
              </label>

              {isSharedDevice && (
                <div className="text-[11px] text-[#8A5700] bg-[#FFF0CB] p-2.5 rounded-lg border border-[#8A5700]/30 leading-relaxed">
                  <strong>Shared Device Protection:</strong> Credentials will not be remembered on this browser, and private assignment drafts will be cleared upon sign-out to prevent access by subsequent learners.
                </div>
              )}

              <div className="flex justify-end text-xs pt-1">
                <Link
                  to="/forgot-password"
                  className="text-[#0F5B57] hover:underline font-semibold"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <Button
              type="submit"
              fullWidth
              isLoading={isLoading}
              icon={<LogIn className="w-4 h-4" />}
              className="mt-2"
            >
              Sign In
            </Button>
          </form>

          {/* Quick Demo Fill Buttons */}
          <div className="mt-6 pt-5 border-t border-[#E1E8E4]">
            <p className="text-[11px] font-bold text-[#687775] uppercase tracking-wider mb-2.5 text-center">
              Quick Demo Accounts
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleDemoFill('student')}
                className="px-3 py-2 text-xs border border-[#CBD7D1] hover:border-[#0F5B57] hover:bg-[#DDF3EA] bg-[#F1F5F2] rounded-lg text-[#202B2A] text-left transition-colors cursor-pointer"
              >
                <strong className="block text-[#0F5B57]">Student Demo</strong>
                <span className="text-[10px] text-[#687775]">Amina Diallo</span>
              </button>
              <button
                type="button"
                onClick={() => handleDemoFill('teacher')}
                className="px-3 py-2 text-xs border border-[#CBD7D1] hover:border-[#0F5B57] hover:bg-[#DDF3EA] bg-[#F1F5F2] rounded-lg text-[#202B2A] text-left transition-colors cursor-pointer"
              >
                <strong className="block text-[#0F5B57]">Teacher Demo</strong>
                <span className="text-[10px] text-[#687775]">Dr. Elena Rostova</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Link */}
        <p className="text-center text-xs text-[#687775] mt-6">
          Don't have an account yet?{' '}
          <Link to="/register" className="font-semibold text-[#0F5B57] hover:underline">
            Register here
          </Link>
        </p>
      </div>
    </div>
  )
}
