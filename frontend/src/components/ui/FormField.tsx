import React from 'react'

export interface FormFieldProps {
  label: string
  htmlFor?: string
  error?: string
  hint?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  error,
  hint,
  required = false,
  children,
  className = '',
}) => {
  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      <div className="flex justify-between items-baseline">
        <label htmlFor={htmlFor} className="text-xs font-semibold text-[#202B2A] tracking-wide">
          {label} {required && <span className="text-[#B42318]">*</span>}
        </label>
        {hint && !error && <span className="text-xs text-[#687775]">{hint}</span>}
      </div>
      {children}
      {error && (
        <span className="text-xs font-medium text-[#B42318] flex items-center gap-1" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
