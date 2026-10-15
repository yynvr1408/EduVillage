import React, { useState } from 'react'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import { Button, FormField, Input, Logo } from '../../components/ui'
import { adminApi } from '../../services/adminApi'

export const AdminLoginPage: React.FC<{ onSignedIn: (username: string) => void }> = ({ onSignedIn }) => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const admin = await adminApi.login(username.trim(), password)
      setPassword('')
      onSignedIn(admin.username)
    } catch (err: any) {
      setError(err.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : err.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 px-4">
      <div className="mx-auto w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={48} className="mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">EduVillage Administration</h1>
        </div>
        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
          <h2 className="text-lg font-bold text-[#202B2A] mb-5 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#0F5B57]" aria-hidden="true" /> Admin Sign In
          </h2>
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-[#B42318] text-xs flex items-center gap-2" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off">
            <FormField label="Username" htmlFor="admin-username" required>
              <Input id="admin-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </FormField>
            <FormField label="Password" htmlFor="admin-password" required>
              <Input id="admin-password" type="password" isPassword autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            <Button type="submit" fullWidth isLoading={isLoading} className="mt-2">
              Sign In
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
