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
    // The two wide variants are fluid: they fill the space beside the sidebar and only stop growing on
    // ultra-wide monitors, where lines of cards would become hard to scan. Narrow variants (sm-lg) stay
    // intentionally narrow for reading and forms.
    xl: 'max-w-[110rem]',
    '2xl': 'max-w-[110rem]',
    full: 'max-w-full',
  }

  return (
    <div className={`w-full ${maxWidthStyles[maxWidth]} mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-20 lg:pb-8 ${className}`}>
      {(title || action) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#E1E8E4]">
          <div>
            {title && <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#202B2A]">{title}</h1>}
            {subtitle && <p className="text-xs sm:text-sm text-[#687775] mt-1">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
