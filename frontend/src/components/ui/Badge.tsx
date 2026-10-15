import React from 'react'

export interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'error' | 'live' | 'info'
  size?: 'sm' | 'md'
  className?: string
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className = '',
}) => {
  const sizeStyles = {
    sm: 'text-[10px] px-2 py-0.5 font-semibold',
    md: 'text-xs px-2.5 py-0.5 font-semibold',
  }

  const variantStyles = {
    default: 'bg-[#0F5B57] text-[#FFFFFF]',
    secondary: 'bg-[#F1F5F2] text-[#202B2A] border border-[#E1E8E4]',
    outline: 'bg-transparent text-[#0F5B57] border border-[#CBD7D1]',
    success: 'bg-[#E5F5EB] text-[#247A4D] border border-[#247A4D]/30',
    warning: 'bg-[#FFF0CB] text-[#8A5700] border border-[#8A5700]/30',
    error: 'bg-[#FDE8E7] text-[#B42318] border border-[#B42318]/30',
    live: 'bg-[#E5F5EB] text-[#247A4D] border border-[#247A4D] font-bold tracking-wider uppercase',
    info: 'bg-[#E8F3FC] text-[#2364AA] border border-[#2364AA]/30',
  }

  return (
    <span
      className={`inline-flex items-center justify-center font-medium rounded-full ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
    >
      {variant === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-[#247A4D] animate-ping mr-1.5" />}
      {children}
    </span>
  )
}
