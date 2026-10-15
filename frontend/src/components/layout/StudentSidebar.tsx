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
    <aside className="hidden lg:flex flex-col w-64 bg-[#FFFFFF] border-r border-[#E5E5E5] shrink-0 min-h-[calc(100vh-4rem)] p-4">
      <div className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider px-3 mb-2">
        Student Portal
      </div>
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/student/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#111111] text-[#FFFFFF]'
                    : 'text-[#666666] hover:bg-[#F5F5F5] hover:text-[#111111]'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-[#E5E5E5] text-xs text-[#666666] px-3">
        <p className="font-semibold text-[#111111]">Offline-Ready</p>
        <p className="text-[11px] mt-0.5">Classes & assignments auto-save locally to IndexedDB.</p>
      </div>
    </aside>
  )
}
