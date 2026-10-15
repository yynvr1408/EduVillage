import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AppHeader } from './AppHeader'
import { StudentSidebar } from './StudentSidebar'
import { MobileNavigation } from './MobileNavigation'
import { OfflineIndicator } from '../ui/OfflineIndicator'

export const StudentLayout: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAF7] text-[#202B2A]">
      <OfflineIndicator />
      <AppHeader />
      <div className="flex-1 flex">
        <StudentSidebar />
        <main className="flex-1 min-w-0 bg-[#F8FAF7]">
          <Outlet />
        </main>
      </div>
      <MobileNavigation />
    </div>
  )
}
