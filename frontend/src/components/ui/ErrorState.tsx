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
      className={`p-6 border border-[#E5E5E5] rounded-xl bg-[#FFFFFF] flex flex-col items-center text-center max-w-md mx-auto ${className}`}
      role="alert"
    >
      <div className="w-12 h-12 rounded-full bg-[#B42318]/10 text-[#B42318] flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-[#111111]">{title}</h3>
      <p className="text-xs sm:text-sm text-[#666666] mt-1 mb-5">{message}</p>
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
