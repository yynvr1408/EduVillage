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
        className={`w-full p-3 bg-[#FFFFFF] text-[#202B2A] placeholder:text-[#687775] text-sm rounded-lg border ${
          isError
            ? 'border-[#B42318] focus:border-[#B42318] focus:ring-1 focus:ring-[#B42318]'
            : 'border-[#CBD7D1] focus:border-[#0F5B57] focus:ring-1 focus:ring-[#0F5B57]'
        } focus:outline-none transition-colors disabled:bg-[#F1F5F2] disabled:cursor-not-allowed ${className}`}
        {...props}
      />
    )
  }
)

Textarea.displayName = 'Textarea'
