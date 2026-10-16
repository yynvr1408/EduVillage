import React from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap, BookOpen, ArrowRight } from 'lucide-react'
import { Logo } from '../../components/ui/Logo'

/**
 * Landing step before either role's login form. Keeps /login/student and /login/teacher as
 * genuinely separate pages (distinct copy, distinct demo account, and a role check on submit)
 * rather than a single generic form that happens to work for both roles.
 */
export const LoginChoicePage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg px-4">
        <div className="flex flex-col items-center text-center mb-8">
          <Logo size={48} className="mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">EduVillage</h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
            Offline-first educational learning platform for reliable learning in low-bandwidth regions.
          </p>
        </div>

        <p className="text-center text-sm font-semibold text-[#202B2A] mb-4">How are you signing in?</p>

        <div className="flex flex-col gap-3">
          <Link
            to="/login/student"
            className="group bg-[#FFFFFF] border border-[#E1E8E4] hover:border-[#0F5B57] rounded-2xl p-5 flex items-center gap-4 shadow-xs transition-colors"
          >
            <div className="w-11 h-11 shrink-0 rounded-xl bg-[#DDF3EA] text-[#0F5B57] flex items-center justify-center">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div className="flex-1 text-left">
              <h2 className="text-sm font-bold text-[#202B2A]">Student Portal</h2>
              <p className="text-xs text-[#687775]">Attend classes, catch up offline, submit assignments</p>
            </div>
            <ArrowRight className="w-4 h-4 text-[#CBD7D1] group-hover:text-[#0F5B57] transition-colors shrink-0" />
          </Link>

          <Link
            to="/login/teacher"
            className="group bg-[#FFFFFF] border border-[#E1E8E4] hover:border-[#0F5B57] rounded-2xl p-5 flex items-center gap-4 shadow-xs transition-colors"
          >
            <div className="w-11 h-11 shrink-0 rounded-xl bg-[#DDF3EA] text-[#0F5B57] flex items-center justify-center">
              <BookOpen className="w-6 h-6" />
            </div>
            <div className="flex-1 text-left">
              <h2 className="text-sm font-bold text-[#202B2A]">Teacher Portal</h2>
              <p className="text-xs text-[#687775]">Schedule classes, manage courses, review AI summaries</p>
            </div>
            <ArrowRight className="w-4 h-4 text-[#CBD7D1] group-hover:text-[#0F5B57] transition-colors shrink-0" />
          </Link>
        </div>
      </div>
    </div>
  )
}
