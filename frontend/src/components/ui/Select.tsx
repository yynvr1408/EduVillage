import React, { forwardRef } from 'react'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[]
  isError?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, isError, className = '', ...props }, ref) => {
    return (
      <div className="relative w-full">
        <select
          ref={ref}
          className={`w-full h-11 px-3.5 bg-[#FFFFFF] text-[#111111] text-sm rounded-md border ${
            isError ? 'border-[#B42318] focus:border-[#B42318]' : 'border-[#E5E5E5] focus:border-[#111111]'
          } focus:outline-none transition-colors appearance-none disabled:bg-[#F5F5F5] disabled:cursor-not-allowed cursor-pointer ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-[#666666]">
          <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
            <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
          </svg>
        </div>
      </div>
    )
  }
)

Select.displayName = 'Select'
