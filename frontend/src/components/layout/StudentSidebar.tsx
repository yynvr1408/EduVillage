import React from 'react'
import { NavLink } from 'react-router-dom'
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
  { to: '/student/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/student/classes', label: 'Classes', icon: Video },
  { to: '/student/recorded-lessons', label: 'Recorded Lessons', icon: PlayCircle },
  { to: '/student/courses', label: 'Courses & Lessons', icon: BookOpen },
  { to: '/student/assignments', label: 'Assignments', icon: FileText },
  { to: '/student/downloads', label: 'Downloads', icon: DownloadCloud },
  { to: '/student/profile', label: 'Profile', icon: User },
]

export const StudentSidebar: React.FC = () => {
  return (
    <aside className="hidden lg:flex flex-col w-64 bg-[#F8FAF7] border-r border-[#E1E8E4] shrink-0 min-h-[calc(100vh-4rem)] p-4">
      <div className="text-[11px] font-bold text-[#687775] uppercase tracking-wider px-3 mb-2">
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
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-[#E1E8E4] text-xs text-[#687775] px-3">
        <p className="font-semibold text-[#202B2A]">Offline-Ready</p>
        <p className="text-[11px] mt-0.5 leading-relaxed">Classes & assignments auto-save locally to IndexedDB.</p>
      </div>
    </aside>
  )
}
