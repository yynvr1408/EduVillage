import React, { forwardRef } from 'react'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  isError?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ isError, className = '', rows = 4, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={`w-full p-3 bg-[#FFFFFF] text-[#111111] placeholder:text-[#888888] text-sm rounded-md border ${
          isError ? 'border-[#B42318] focus:border-[#B42318]' : 'border-[#E5E5E5] focus:border-[#111111]'
        } focus:outline-none transition-colors disabled:bg-[#F5F5F5] disabled:cursor-not-allowed ${className}`}
        {...props}
      />
    )
  }
)

Textarea.displayName = 'Textarea'
