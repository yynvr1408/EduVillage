import React, { forwardRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  isError?: boolean
  isPassword?: boolean
  leftIcon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ isError, isPassword, leftIcon, className = '', type = 'text', ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false)

    const inputType = isPassword ? (showPassword ? 'text' : 'password') : type

    return (
      <div className="relative w-full">
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#687775]">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          type={inputType}
          className={`w-full h-11 px-3.5 ${leftIcon ? 'pl-10' : ''} ${
            isPassword ? 'pr-11' : ''
          } bg-[#FFFFFF] text-[#202B2A] placeholder:text-[#687775] text-sm rounded-lg border ${
            isError
              ? 'border-[#B42318] focus:border-[#B42318] focus:ring-1 focus:ring-[#B42318]'
              : 'border-[#CBD7D1] focus:border-[#0F5B57] focus:ring-1 focus:ring-[#0F5B57]'
          } focus:outline-none transition-colors disabled:bg-[#F1F5F2] disabled:cursor-not-allowed ${className}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#687775] hover:text-[#0F5B57] focus:outline-none"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
