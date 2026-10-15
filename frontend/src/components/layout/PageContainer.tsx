import React from 'react'

export interface PageContainerProps {
  title?: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
}

export const PageContainer: React.FC<PageContainerProps> = ({
  title,
  subtitle,
  action,
  children,
  className = '',
  maxWidth = 'xl',
}) => {
  const maxWidthStyles = {
    sm: 'max-w-2xl',
    md: 'max-w-4xl',
    lg: 'max-w-5xl',
    xl: 'max-w-6xl',
    '2xl': 'max-w-7xl',
    full: 'max-w-full',
  }

  return (
    <div className={`w-full ${maxWidthStyles[maxWidth]} mx-auto px-4 sm:px-6 py-6 pb-20 lg:pb-8 ${className}`}>
      {(title || action) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#E5E5E5]">
          <div>
            {title && <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#111111]">{title}</h1>}
            {subtitle && <p className="text-xs sm:text-sm text-[#666666] mt-1">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
