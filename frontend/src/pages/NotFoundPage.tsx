import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileQuestion } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useAuth } from '../context/AuthContext'

export const NotFoundPage: React.FC = () => {
  const { user, isTeacher } = useAuth()
  const homeLink = user ? (isTeacher ? '/teacher/dashboard' : '/student/dashboard') : '/login'

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-[#F5F5F5] border border-[#E5E5E5] flex items-center justify-center text-[#111111] mb-4">
        <FileQuestion className="w-8 h-8" />
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-[#111111] mb-2">Page Not Found</h1>
      <p className="text-sm text-[#666666] max-w-sm mb-6">
        The destination you are looking for does not exist or has been moved.
      </p>
      <Link to={homeLink}>
        <Button variant="primary" icon={<ArrowLeft className="w-4 h-4" />}>
          Return to Portal
        </Button>
      </Link>
    </div>
  )
}
