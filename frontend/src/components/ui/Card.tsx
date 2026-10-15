import React from 'react'

export interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  hoverable?: boolean
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  onClick,
  hoverable = false,
}) => {
  return (
    <div
      onClick={onClick}
      className={`bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl overflow-hidden transition-all shadow-[0_1px_3px_rgba(32,43,42,0.04)] ${
        hoverable ? 'hover:border-[#CBD7D1] hover:shadow-[0_4px_12px_rgba(32,43,42,0.06)] cursor-pointer' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

export const CardHeader: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`p-4 sm:p-5 border-b border-[#E1E8E4] ${className}`}>{children}</div>

export const CardContent: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`p-4 sm:p-5 ${className}`}>{children}</div>

export const CardFooter: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`p-4 sm:p-5 bg-[#F1F5F2] border-t border-[#E1E8E4] flex items-center justify-between ${className}`}>
    {children}
  </div>
)
