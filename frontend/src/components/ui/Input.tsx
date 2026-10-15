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
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#666666]">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          type={inputType}
          className={`w-full h-11 px-3.5 ${leftIcon ? 'pl-10' : ''} ${
            isPassword ? 'pr-11' : ''
          } bg-[#FFFFFF] text-[#111111] placeholder:text-[#888888] text-sm rounded-md border ${
            isError ? 'border-[#B42318] focus:border-[#B42318]' : 'border-[#E5E5E5] focus:border-[#111111]'
          } focus:outline-none transition-colors disabled:bg-[#F5F5F5] disabled:cursor-not-allowed ${className}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#666666] hover:text-[#111111] focus:outline-none"
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
