import React from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from './Button'

export interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message,
  onRetry,
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div
      className={`p-6 sm:p-8 border border-[#E1E8E4] rounded-2xl bg-[#FFFFFF] flex flex-col items-center text-center max-w-md mx-auto shadow-xs ${className}`}
      role="alert"
    >
      <div className="w-12 h-12 rounded-full bg-[#FDE8E7] text-[#B42318] flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-[#202B2A]">{title}</h3>
      <p className="text-xs sm:text-sm text-[#687775] mt-1 mb-5 leading-relaxed">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} size="sm" variant="outline" icon={<RefreshCw className="w-4 h-4" />}>
          Try Again
        </Button>
      )}
      {onAction && actionLabel && (
        <Button onClick={onAction} size="sm" variant="outline">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
