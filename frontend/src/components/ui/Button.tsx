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
      'inline-flex items-center justify-center font-semibold transition-colors select-none rounded-lg touch-target disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-[#0F5B57] focus-visible:outline-offset-2'

    const sizeStyles = {
      sm: 'text-xs px-3 py-1.5 h-9 gap-1.5 font-semibold',
      md: 'text-sm px-4 py-2.5 h-10 gap-2 font-semibold',
      lg: 'text-base px-6 py-3 h-12 gap-2.5 font-semibold',
    }

    const variantStyles = {
      primary: 'bg-[#0F5B57] text-[#FFFFFF] hover:bg-[#123B39] active:bg-[#0A413E]',
      secondary: 'bg-[#FFFFFF] text-[#0F5B57] hover:bg-[#DDF3EA] active:bg-[#C8EADF] border border-[#CBD7D1]',
      outline: 'bg-transparent text-[#0F5B57] border border-[#CBD7D1] hover:bg-[#DDF3EA] hover:border-[#0F5B57] active:bg-[#C8EADF]',
      ghost: 'bg-transparent text-[#202B2A] hover:bg-[#DDF3EA] hover:text-[#0F5B57] active:bg-[#C8EADF]',
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
