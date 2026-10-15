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
      className={`bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg overflow-hidden transition-all ${
        hoverable ? 'hover:border-[#111111] cursor-pointer' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

export const CardHeader: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`p-4 sm:p-5 border-b border-[#E5E5E5] ${className}`}>{children}</div>

export const CardContent: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`p-4 sm:p-5 ${className}`}>{children}</div>

export const CardFooter: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`p-4 sm:p-5 bg-[#F5F5F5] border-t border-[#E5E5E5] flex items-center justify-between ${className}`}>
    {children}
  </div>
)
