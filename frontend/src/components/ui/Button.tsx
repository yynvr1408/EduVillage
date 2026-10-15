import React, { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
  fullWidth?: boolean
  icon?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      fullWidth = false,
      icon,
      disabled,
      className = '',
      type = 'button',
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-colors select-none rounded-md touch-target disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-[#111111] focus-visible:outline-offset-2'

    const sizeStyles = {
      sm: 'text-xs px-3 py-1.5 h-9 gap-1.5',
      md: 'text-sm px-4 py-2.5 h-11 gap-2',
      lg: 'text-base px-6 py-3 h-12 gap-2.5',
    }

    const variantStyles = {
      primary: 'bg-[#111111] text-[#FFFFFF] hover:bg-[#262626] active:bg-[#000000]',
      secondary: 'bg-[#F5F5F5] text-[#111111] hover:bg-[#EAEAEA] active:bg-[#E0E0E0] border border-[#E5E5E5]',
      outline: 'bg-transparent text-[#111111] border border-[#111111] hover:bg-[#F5F5F5] active:bg-[#EAEAEA]',
      ghost: 'bg-transparent text-[#111111] hover:bg-[#F5F5F5] active:bg-[#EAEAEA]',
      destructive: 'bg-[#B42318] text-[#FFFFFF] hover:bg-[#911C13] active:bg-[#73160F]',
    }

    const widthStyle = fullWidth ? 'w-full' : ''

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${widthStyle} ${className}`}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        <span>{children}</span>
      </button>
    )
  }
)

Button.displayName = 'Button'
