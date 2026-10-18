import React from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  BookOpen,
  Video,
  PlayCircle,
  FileText,
  DownloadCloud,
  X,
  Sparkles,
  FolderOpen,
  FileCheck,
  User,
  Building2,
} from 'lucide-react'
import { Sheet } from '../ui/Sheet'
import { useAuth } from '../../context/AuthContext'
import { useIsInstitutionAdmin } from '../../hooks/useIsInstitutionAdmin'

const studentMobileNav = [
  { to: '/student/dashboard', labelKey: 'nav.home', icon: LayoutDashboard },
  { to: '/student/classes', labelKey: 'nav.classes', icon: Video },
  { to: '/student/recorded-lessons', labelKey: 'navMobile.recorded', icon: PlayCircle },
  { to: '/student/assignments', labelKey: 'navMobile.tasks', icon: FileText },
  { to: '/student/downloads', labelKey: 'navMobile.offline', icon: DownloadCloud },
] as const

const teacherNavItems = [
  { to: '/teacher/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/teacher/courses', labelKey: 'nav.myCourses', icon: BookOpen },
  { to: '/teacher/classes', labelKey: 'nav.classes', icon: Video },
  { to: '/teacher/recorded-lessons', labelKey: 'nav.recordedLessons', icon: PlayCircle },
  { to: '/teacher/materials', labelKey: 'nav.teachingResources', icon: FolderOpen },
  { to: '/teacher/assignments', labelKey: 'nav.assignments', icon: FileCheck },
  { to: '/teacher/summaries', labelKey: 'nav.aiSummaries', icon: Sparkles },
  { to: '/teacher/profile', labelKey: 'nav.profile', icon: User },
] as const

export const MobileNavigation: React.FC<{
  isTeacherMenuOpen?: boolean
  onCloseTeacherMenu?: () => void
}> = ({ isTeacherMenuOpen = false, onCloseTeacherMenu }) => {
  const { t } = useTranslation()
  const { isStudent, isTeacher } = useAuth()
  const isInstitutionAdmin = useIsInstitutionAdmin()
  const teacherItems = isInstitutionAdmin
    ? [
        ...teacherNavItems.slice(0, -1),
        { to: '/teacher/institution', labelKey: 'nav.institutionAdmin', icon: Building2 } as const,
        teacherNavItems[teacherNavItems.length - 1],
      ]
    : teacherNavItems

  if (isStudent) {
    return (
      <nav
        aria-label="Mobile Navigation"
        className="fixed bottom-0 inset-x-0 z-40 bg-[#FFFFFF] border-t border-[#E1E8E4] lg:hidden safe-bottom shadow-[0_-2px_6px_rgba(32,43,42,0.03)]"
      >
        <div className="flex items-center justify-around h-14">
          {studentMobileNav.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/student/dashboard'}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center flex-1 h-full touch-target transition-colors select-none ${
                    isActive ? 'text-[#0F5B57] font-bold' : 'text-[#687775] hover:text-[#0F5B57]'
                  }`
                }
              >
                <Icon className="w-5 h-5 mb-0.5" />
                <span className="text-xs leading-tight">{t(item.labelKey)}</span>
              </NavLink>
            )
          })}
        </div>
      </nav>
    )
  }

  if (isTeacher && isTeacherMenuOpen && onCloseTeacherMenu) {
    return (
      <Sheet
        isOpen={isTeacherMenuOpen}
        onClose={onCloseTeacherMenu}
        title="Teacher Navigation"
        position="bottom"
      >
        <div className="flex flex-col gap-1.5 pb-4">
          {teacherItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/teacher/dashboard'}
                onClick={onCloseTeacherMenu}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold touch-target transition-colors ${
                    isActive
                      ? 'bg-[#0F5B57] text-[#FFFFFF] shadow-xs'
                      : 'text-[#687775] hover:bg-[#DDF3EA] hover:text-[#123B39]'
                  }`
                }
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            )
          })}
        </div>
      </Sheet>
    )
  }

  return null
}
