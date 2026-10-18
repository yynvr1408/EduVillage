import React from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GraduationCap, BookOpen, Building2, ArrowRight } from 'lucide-react'
import { Logo } from '../../components/ui/Logo'
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher'

/**
 * Landing step before either role's registration form. Keeps /register/student and
 * /register/teacher as genuinely separate pages (no role dropdown, role fixed by the route)
 * rather than a single generic form with a role picker.
 */
export const RegisterChoicePage: React.FC = () => {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg px-4">
        <div className="flex justify-end mb-4">
          <LanguageSwitcher />
        </div>
        <div className="flex flex-col items-center text-center mb-8">
          <Logo size={48} className="mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">LanternEd</h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">{t('auth.tagline')}</p>
        </div>

        <p className="text-center text-sm font-semibold text-[#202B2A] mb-4">{t('auth.whatAccount')}</p>

        <div className="flex flex-col gap-3">
          <Link
            to="/register/student"
            className="group bg-[#FFFFFF] border border-[#E1E8E4] hover:border-[#0F5B57] rounded-2xl p-5 flex items-center gap-4 shadow-xs transition-colors"
          >
            <div className="w-11 h-11 shrink-0 rounded-xl bg-[#DDF3EA] text-[#0F5B57] flex items-center justify-center">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div className="flex-1 text-left">
              <h2 className="text-sm font-bold text-[#202B2A]">{t('auth.studentAccount')}</h2>
              <p className="text-xs text-[#687775]">{t('auth.studentAccountDesc')}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-[#CBD7D1] group-hover:text-[#0F5B57] transition-colors shrink-0" />
          </Link>

          <Link
            to="/register/teacher"
            className="group bg-[#FFFFFF] border border-[#E1E8E4] hover:border-[#0F5B57] rounded-2xl p-5 flex items-center gap-4 shadow-xs transition-colors"
          >
            <div className="w-11 h-11 shrink-0 rounded-xl bg-[#DDF3EA] text-[#0F5B57] flex items-center justify-center">
              <BookOpen className="w-6 h-6" />
            </div>
            <div className="flex-1 text-left">
              <h2 className="text-sm font-bold text-[#202B2A]">{t('auth.teacherAccount')}</h2>
              <p className="text-xs text-[#687775]">{t('auth.teacherAccountDesc')}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-[#CBD7D1] group-hover:text-[#0F5B57] transition-colors shrink-0" />
          </Link>

          <Link
            to="/register/college"
            className="group bg-[#FFFFFF] border border-[#E1E8E4] hover:border-[#0F5B57] rounded-2xl p-5 flex items-center gap-4 shadow-xs transition-colors"
          >
            <div className="w-11 h-11 shrink-0 rounded-xl bg-[#DDF3EA] text-[#0F5B57] flex items-center justify-center">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="flex-1 text-left">
              <h2 className="text-sm font-bold text-[#202B2A]">{t('auth.institutionAccount')}</h2>
              <p className="text-xs text-[#687775]">{t('auth.institutionAccountDesc')}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-[#CBD7D1] group-hover:text-[#0F5B57] transition-colors shrink-0" />
          </Link>
        </div>

        <p className="text-center text-xs text-[#687775] mt-6">
          {t('auth.alreadyRegistered')}{' '}
          <Link to="/login" className="font-semibold text-[#0F5B57] hover:underline">
            {t('auth.signInHere')}
          </Link>
        </p>
      </div>
    </div>
  )
}
