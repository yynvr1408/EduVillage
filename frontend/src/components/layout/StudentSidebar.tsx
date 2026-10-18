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
  User,
} from 'lucide-react'

const navItems = [
  { to: '/student/dashboard', labelKey: 'nav.home', icon: LayoutDashboard },
  { to: '/student/classes', labelKey: 'nav.classes', icon: Video },
  { to: '/student/recorded-lessons', labelKey: 'nav.recordedLessons', icon: PlayCircle },
  { to: '/student/courses', labelKey: 'nav.coursesAndLessons', icon: BookOpen },
  { to: '/student/assignments', labelKey: 'nav.assignments', icon: FileText },
  { to: '/student/downloads', labelKey: 'nav.downloads', icon: DownloadCloud },
  { to: '/student/profile', labelKey: 'nav.profile', icon: User },
] as const

export const StudentSidebar: React.FC = () => {
  const { t } = useTranslation()
  return (
    <aside className="hidden lg:flex flex-col w-64 bg-[#F8FAF7] border-r border-[#E1E8E4] shrink-0 min-h-[calc(100vh-4rem)] p-4">
      <div className="text-xs font-bold text-[#687775] uppercase tracking-wider px-3 mb-2">
        Student Portal
      </div>
      <nav className="flex flex-col gap-1.5" aria-label="Student Navigation">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/student/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#0F5B57] focus-visible:outline-offset-1 ${
                  isActive
                    ? 'bg-[#0F5B57] text-[#FFFFFF] shadow-xs'
                    : 'text-[#687775] hover:bg-[#DDF3EA] hover:text-[#123B39]'
                }`
              }
            >
              <Icon className="w-4.5 h-4.5 shrink-0" />
              <span>{t(item.labelKey)}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-[#E1E8E4] text-xs text-[#687775] px-3">
        <p className="font-semibold text-[#202B2A]">Offline-Ready</p>
        <p className="text-xs mt-0.5 leading-relaxed">Classes & assignments auto-save locally to IndexedDB.</p>
      </div>
    </aside>
  )
}
