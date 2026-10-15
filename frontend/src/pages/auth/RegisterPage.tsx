import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, UserPlus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import type { Role } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'
import { Select } from '../../components/ui/Select'

export const RegisterPage: React.FC = () => {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<Role>('student')
  const [inviteCode, setInviteCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!fullName.trim() || !email.trim() || !password) {
      setError('Please fill in all required fields.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const user = await register(email, fullName, password, role, inviteCode)
      navigate(user.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard', {
        replace: true,
      })
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please check your information.')
    } finally {
      setIsLoading(false)
    }
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
            Create EduVillage Account
          </h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
            Join low-bandwidth classrooms and access downloadable offline curricula.
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
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
            <FormField label="Full Name" htmlFor="fullName" required>
              <Input
                id="fullName"
                type="text"
                autoComplete="name"
                placeholder="e.g. Amina Diallo"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </FormField>

            <FormField label="Email Address" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="amina@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>

            <FormField label="Role Selection" htmlFor="role" required hint="Choose your primary portal role">
              <Select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                options={[
                  { value: 'student', label: 'Student (Access courses, classes, offline downloads)' },
                  { value: 'teacher', label: 'Teacher (Schedule classes, manage materials & assignments)' },
                ]}
              />
            </FormField>

            {role === 'teacher' && (
              <FormField
                label="Teacher Invite Code"
                htmlFor="inviteCode"
                required
                hint="Teacher accounts are issued by your institution. Ask your administrator for the code."
              >
                <Input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  autoComplete="off"
                  required
                />
              </FormField>
            )}

            <FormField label="Password" htmlFor="password" required hint="Min. 6 characters">
              <Input
                id="password"
                type="password"
                isPassword
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>

            <FormField label="Confirm Password" htmlFor="confirmPassword" required>
              <Input
                id="confirmPassword"
                type="password"
                isPassword
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </FormField>

            <Button
              type="submit"
              fullWidth
              isLoading={isLoading}
              icon={<UserPlus className="w-4 h-4" />}
              className="mt-3"
            >
              Register & Begin Learning
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-[#687775] mt-6">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-[#0F5B57] hover:underline">
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  )
}
