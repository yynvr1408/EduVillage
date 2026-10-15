import React from 'react'

export interface LogoMarkProps {
  className?: string
}

/**
 * Open book + a broadcast arc reaching it: education transmitted across distance, for places
 * where the connection is weak or intermittent — the actual premise of EduVillage. Single
 * currentColor stroke so it drops into any colored badge (the teal app icon, a header mark, etc.)
 * without extra props.
 */
export const LogoMark: React.FC<LogoMarkProps> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
    <path
      d="M12 8.5c-1.4-1.3-3.6-1.8-7-1.8v11c3.4 0 5.6.5 7 1.8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 8.5c1.4-1.3 3.6-1.8 7-1.8v11c-3.4 0-5.6.5-7 1.8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M12 8.5v11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M8.8 4.6a4.6 4.6 0 0 1 6.4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

export interface LogoProps {
  /** Pixel size of the square badge. */
  size?: number
  className?: string
}

/** The rounded teal badge used across auth pages and the app header — the icon mark inside it. */
export const Logo: React.FC<LogoProps> = ({ size = 48, className = '' }) => (
  <div
    className={`rounded-xl bg-[#0F5B57] text-white flex items-center justify-center shadow-sm shrink-0 ${className}`}
    style={{ width: size, height: size }}
  >
    <LogoMark className="w-[58%] h-[58%]" />
  </div>
)
