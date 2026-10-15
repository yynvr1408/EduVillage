import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AppHeader } from './AppHeader'
import { TeacherSidebar } from './TeacherSidebar'
import { MobileNavigation } from './MobileNavigation'
import { OfflineIndicator } from '../ui/OfflineIndicator'

export const TeacherLayout: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col bg-[#FFFFFF] text-[#111111]">
      <OfflineIndicator />
      <AppHeader onToggleMobileMenu={() => setIsMobileMenuOpen(true)} />
      <div className="flex-1 flex">
        <TeacherSidebar />
        <main className="flex-1 min-w-0 bg-[#FFFFFF]">
          <Outlet />
        </main>
      </div>
      <MobileNavigation
        isTeacherMenuOpen={isMobileMenuOpen}
        onCloseTeacherMenu={() => setIsMobileMenuOpen(false)}
      />
    </div>
  )
}
