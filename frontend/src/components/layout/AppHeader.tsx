import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Wifi, WifiOff, RefreshCw, LogOut, User as UserIcon, Menu } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useNetworkStatus } from '../../context/NetworkContext'
import { useSync } from '../../context/SyncContext'
import { SyncStatusModal } from '../ui/SyncStatusModal'
import { Badge } from '../ui/Badge'

import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { AlertCircle, Users } from 'lucide-react'

export interface AppHeaderProps {
  onToggleMobileMenu?: () => void
}

export const AppHeader: React.FC<AppHeaderProps> = ({ onToggleMobileMenu }) => {
  const { user, logout, switchUser, checkUnsavedWork, isTeacher, isSharedDevice } = useAuth()
  const { isOnline, quality } = useNetworkStatus()
  const { pendingCount } = useSync()
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [showLogoutWarning, setShowLogoutWarning] = useState(false)
  const [unsavedDrafts, setUnsavedDrafts] = useState<string[]>([])
  const navigate = useNavigate()

  const handleLogoutClick = async () => {
    const check = await checkUnsavedWork()
    if (check.hasUnsaved) {
      setUnsavedDrafts(check.draftTitles)
      setShowLogoutWarning(true)
      return
    }
    await logout()
    navigate('/login')
  }

  const handleConfirmLogout = async () => {
    setShowLogoutWarning(false)
    await logout()
    navigate('/login')
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#FFFFFF] border-b border-[#E5E5E5] h-14 sm:h-16 px-4 sm:px-6 flex items-center justify-between">
        {/* Left: Menu toggle (mobile teacher) + Brand */}
        <div className="flex items-center gap-3">
          {onToggleMobileMenu && (
            <button
              type="button"
              onClick={onToggleMobileMenu}
              className="p-2 -ml-2 text-[#111111] hover:bg-[#F5F5F5] rounded-md lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <Link
            to={isTeacher ? '/teacher/dashboard' : '/student/dashboard'}
            className="flex items-center gap-2 group"
          >
            <div className="w-8 h-8 rounded-md bg-[#111111] text-[#FFFFFF] flex items-center justify-center font-bold text-sm tracking-tighter">
              EV
            </div>
            <span className="font-bold text-base sm:text-lg tracking-tight text-[#111111]">
              EduVillage
            </span>
          </Link>

          {user && (
            <Badge variant="secondary" size="sm" className="hidden sm:inline-flex uppercase text-[10px] tracking-wider">
              {user.role}
            </Badge>
          )}
        </div>

        {/* Right: Network status, Sync indicator, Profile & Logout */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Network Pill */}
          <div
            className={`hidden xs:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
              isOnline
                ? quality === 'poor'
                  ? 'border-[#854D0E] text-[#854D0E] bg-[#854D0E]/5'
                  : 'border-[#166534] text-[#166534] bg-[#166534]/5'
                : 'border-[#111111] text-[#111111] bg-[#F5F5F5]'
            }`}
            title={isOnline ? `Online (${quality} connectivity)` : 'Offline mode'}
          >
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            <span className="font-medium text-[11px]">
              {isOnline ? (quality === 'poor' ? 'Low Bandwidth' : 'Online') : 'Offline'}
            </span>
          </div>

          {/* Sync Queue Trigger */}
          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 rounded-md text-xs font-medium text-[#111111] hover:bg-[#F5F5F5] border border-[#E5E5E5] transition-colors cursor-pointer"
            title="View synchronization queue"
            aria-label="View synchronization queue"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pendingCount > 0 ? 'text-[#854D0E]' : 'text-[#666666]'}`} />
            <span className="hidden sm:inline">Sync</span>
            {pendingCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-[#111111] text-[#FFFFFF] text-[10px] flex items-center justify-center font-bold">
                {pendingCount}
              </span>
            )}
          </button>

          {/* User Profile Info & Logout */}
          {user && (
            <div className="flex items-center gap-2 pl-1 sm:pl-2 border-l border-[#E5E5E5]">
              <div className="hidden md:flex flex-col text-right">
                <span className="text-xs font-semibold text-[#111111] leading-tight truncate max-w-30">
                  {user.full_name}
                </span>
                <span className="text-[10px] text-[#666666] leading-tight truncate max-w-30">
                  {user.email}
                </span>
              </div>

              {isSharedDevice && (
                <span
                  title="Shared Device Mode Active"
                  className="hidden lg:inline text-[10px] font-medium bg-[#854D0E]/10 text-[#854D0E] border border-[#854D0E]/20 px-2 py-0.5 rounded"
                >
                  Shared Device
                </span>
              )}

              <Link
                to={isTeacher ? '/teacher/profile' : '/student/profile'}
                className="w-8 h-8 rounded-full bg-[#F5F5F5] border border-[#E5E5E5] flex items-center justify-center text-[#111111] hover:border-[#111111] transition-colors"
                title="View Profile"
                aria-label="View Profile"
              >
                <UserIcon className="w-4 h-4" />
              </Link>

              <button
                type="button"
                onClick={handleLogoutClick}
                className="p-1.5 sm:p-2 text-[#666666] hover:text-[#111111] hover:bg-[#F5F5F5] rounded-md transition-colors"
                title="Log out or switch user"
                aria-label="Log out or switch user"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      <SyncStatusModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
      />

      {/* Unsynchronized Draft Warning Dialog */}
      <Dialog
        isOpen={showLogoutWarning}
        onClose={() => setShowLogoutWarning(false)}
        title="Unsynchronized Work on Device"
      >
        <div className="space-y-4 text-xs sm:text-sm">
          <div className="p-3 bg-[#854D0E]/10 rounded border border-[#854D0E]/20 text-[#854D0E] flex items-start space-x-2.5">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              You have an assignment waiting to sync. If you sign out now, your saved work will remain on this device only if this application and device policy permit it.
            </p>
          </div>

          <div>
            <p className="font-semibold text-[#111111] mb-1.5">Unsaved / Pending Drafts:</p>
            <ul className="list-disc pl-5 space-y-1 text-xs text-[#666666]">
              {unsavedDrafts.map((title, i) => (
                <li key={i} className="font-medium text-[#111111]">
                  {title}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#E5E5E5]">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowLogoutWarning(false)
                navigate('/student/assignments')
              }}
            >
              Review Saved Draft
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="bg-[#B42318] hover:bg-[#991B1B] text-white border-none"
              onClick={handleConfirmLogout}
            >
              Proceed to Sign Out
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
