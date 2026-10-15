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
import { Logo } from '../ui/Logo'
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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [unsavedDrafts, setUnsavedDrafts] = useState<string[]>([])
  const navigate = useNavigate()

  const handleLogoutClick = async () => {
    const check = await checkUnsavedWork()
    if (check.hasUnsaved) {
      setUnsavedDrafts(check.draftTitles)
      setShowLogoutWarning(true)
      return
    }
    setShowLogoutConfirm(true) // always ask before signing out
  }

  const handleConfirmPlainLogout = async () => {
    setShowLogoutConfirm(false)
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
      <header className="sticky top-0 z-40 bg-[#FFFFFF] border-b border-[#E1E8E4] h-14 sm:h-16 px-4 sm:px-6 flex items-center justify-between shadow-[0_1px_2px_rgba(32,43,42,0.03)]">
        {/* Left: Menu toggle (mobile teacher) + Brand */}
        <div className="flex items-center gap-3">
          {onToggleMobileMenu && (
            <button
              type="button"
              onClick={onToggleMobileMenu}
              className="p-2 -ml-2 text-[#202B2A] hover:bg-[#DDF3EA] hover:text-[#0F5B57] rounded-lg lg:hidden transition-colors"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <Link
            to={isTeacher ? '/teacher/dashboard' : '/student/dashboard'}
            className="flex items-center gap-2.5 group"
          >
            <Logo size={32} />
            <span className="font-bold text-base sm:text-lg tracking-tight text-[#202B2A]">
              EduVillage
            </span>
          </Link>

          {user && (
            <Badge variant="secondary" size="sm" className="hidden sm:inline-flex uppercase text-xs tracking-wider">
              {user.role}
            </Badge>
          )}
        </div>

        {/* Right: Network status, Sync indicator, Profile & Logout */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Network Pill */}
          <div
            className={`hidden xs:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
              isOnline
                ? quality === 'poor'
                  ? 'border-[#8A5700]/30 text-[#8A5700] bg-[#FFF0CB]'
                  : 'border-[#247A4D]/30 text-[#247A4D] bg-[#E5F5EB]'
                : 'border-[#CBD7D1] text-[#8A5700] bg-[#FFF0CB]'
            }`}
            title={isOnline ? `Online (${quality} connectivity)` : 'Offline mode'}
          >
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            <span className="font-semibold text-xs">
              {isOnline ? (quality === 'poor' ? 'Low Bandwidth' : 'Online') : 'Offline'}
            </span>
          </div>

          {/* Sync Queue Trigger */}
          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 rounded-lg text-xs font-semibold text-[#202B2A] hover:bg-[#DDF3EA] hover:text-[#0F5B57] border border-[#CBD7D1] transition-colors cursor-pointer"
            title="View synchronization queue"
            aria-label="View synchronization queue"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pendingCount > 0 ? 'text-[#8A5700]' : 'text-[#687775]'}`} />
            <span className="hidden sm:inline">Sync</span>
            {pendingCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-[#0F5B57] text-[#FFFFFF] text-xs flex items-center justify-center font-bold">
                {pendingCount}
              </span>
            )}
          </button>

          {/* User Profile Info & Logout */}
          {user && (
            <div className="flex items-center gap-2 pl-1 sm:pl-2 border-l border-[#E1E8E4]">
              <div className="hidden md:flex flex-col text-right">
                <span className="text-xs font-semibold text-[#202B2A] leading-tight truncate max-w-52">
                  {user.full_name}
                </span>
              </div>

              {isSharedDevice && (
                <span
                  title="Shared Device Mode Active"
                  className="hidden lg:inline text-xs font-semibold bg-[#FFF0CB] text-[#8A5700] border border-[#8A5700]/30 px-2 py-0.5 rounded-md"
                >
                  Shared Device
                </span>
              )}

              <Link
                to={isTeacher ? '/teacher/profile' : '/student/profile'}
                className="w-8 h-8 rounded-full bg-[#F1F5F2] border border-[#E1E8E4] flex items-center justify-center text-[#687775] hover:text-[#0F5B57] hover:border-[#0F5B57] transition-colors"
                title="View Profile"
                aria-label="View Profile"
              >
                <UserIcon className="w-4 h-4" />
              </Link>

              <button
                type="button"
                onClick={handleLogoutClick}
                className="p-1.5 sm:p-2 text-[#687775] hover:text-[#B42318] hover:bg-[#FDE8E7] rounded-lg transition-colors cursor-pointer"
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

      {/* Sign-out confirmation */}
      <Dialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        title="Confirm sign out"
        description="Are you sure you want to log out of EduVillage?"
        maxWidth="sm"
      >
        <div className="flex items-center justify-end space-x-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setShowLogoutConfirm(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleConfirmPlainLogout}>
            Log out
          </Button>
        </div>
      </Dialog>

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
            <p className="font-semibold text-[#202B2A] mb-1.5">Unsaved / Pending Drafts:</p>
            <ul className="list-disc pl-5 space-y-1 text-xs text-[#687775]">
              {unsavedDrafts.map((title, i) => (
                <li key={i} className="font-medium text-[#202B2A]">
                  {title}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#E1E8E4]">
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
