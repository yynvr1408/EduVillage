import React from 'react'

export interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'error' | 'live'
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
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2.5 py-0.5',
  }

  const variantStyles = {
    default: 'bg-[#111111] text-[#FFFFFF]',
    secondary: 'bg-[#F5F5F5] text-[#111111] border border-[#E5E5E5]',
    outline: 'bg-transparent text-[#111111] border border-[#111111]',
    success: 'bg-[#166534] text-[#FFFFFF]',
    warning: 'bg-[#854D0E] text-[#FFFFFF]',
    error: 'bg-[#B42318] text-[#FFFFFF]',
    live: 'bg-[#B42318] text-[#FFFFFF] animate-pulse font-bold tracking-wider uppercase',
  }

  return (
    <span
      className={`inline-flex items-center justify-center font-medium rounded-full ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
    >
      {variant === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-white mr-1.5" />}
      {children}
    </span>
  )
}
