import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  BookOpen,
  Video,
  PlayCircle,
  FolderOpen,
  FileCheck,
  Sparkles,
  User,
} from 'lucide-react'

const navItems = [
  { to: '/teacher/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/teacher/courses', label: 'My Courses', icon: BookOpen },
  { to: '/teacher/classes', label: 'Classes', icon: Video },
  { to: '/teacher/recorded-lessons', label: 'Recorded Lessons', icon: PlayCircle },
  { to: '/teacher/materials', label: 'Teaching Resources', icon: FolderOpen },
  { to: '/teacher/assignments', label: 'Assignments', icon: FileCheck },
  { to: '/teacher/summaries', label: 'AI Summaries', icon: Sparkles },
  { to: '/teacher/profile', label: 'Profile', icon: User },
]

export const TeacherSidebar: React.FC = () => {
  return (
    <aside className="hidden lg:flex flex-col w-64 bg-[#F8FAF7] border-r border-[#E1E8E4] shrink-0 min-h-[calc(100vh-4rem)] p-4">
      <div className="text-xs font-bold text-[#687775] uppercase tracking-wider px-3 mb-2">
        Teacher Console
      </div>
      <nav className="flex flex-col gap-1.5" aria-label="Teacher Navigation">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/teacher/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#0F5B57] focus-visible:outline-offset-1 ${
                  isActive
                    ? 'bg-[#0F5B57] text-[#FFFFFF] shadow-xs'
                    : 'text-[#687775] hover:bg-[#DDF3EA] hover:text-[#123B39]'
                }`
              }
            >
              <Icon className="w-4.5 h-4.5 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
