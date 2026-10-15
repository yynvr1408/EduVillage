import React from 'react'
import { NavLink } from 'react-router-dom'
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
} from 'lucide-react'
import { Sheet } from '../ui/Sheet'
import { useAuth } from '../../context/AuthContext'

const studentMobileNav = [
  { to: '/student/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/student/classes', label: 'Classes', icon: Video },
  { to: '/student/recorded-lessons', label: 'Recorded', icon: PlayCircle },
  { to: '/student/assignments', label: 'Tasks', icon: FileText },
  { to: '/student/downloads', label: 'Offline', icon: DownloadCloud },
]

const teacherNavItems = [
  { to: '/teacher/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/teacher/courses', label: 'My Courses', icon: BookOpen },
  { to: '/teacher/classes', label: 'Classes', icon: Video },
  { to: '/teacher/recorded-lessons', label: 'Recorded Lessons', icon: PlayCircle },
  { to: '/teacher/materials', label: 'Teaching Resources', icon: FolderOpen },
  { to: '/teacher/assignments', label: 'Assignments', icon: FileCheck },
  { to: '/teacher/summaries', label: 'AI Summaries', icon: Sparkles },
  { to: '/teacher/profile', label: 'Profile', icon: User },
]

export const MobileNavigation: React.FC<{
  isTeacherMenuOpen?: boolean
  onCloseTeacherMenu?: () => void
}> = ({ isTeacherMenuOpen = false, onCloseTeacherMenu }) => {
  const { isStudent, isTeacher } = useAuth()

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
                <span className="text-[10px] leading-tight">{item.label}</span>
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
          {teacherNavItems.map((item) => {
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
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </div>
      </Sheet>
    )
  }

  return null
}
