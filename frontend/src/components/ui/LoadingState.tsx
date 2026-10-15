import React from 'react'
import { Loader2 } from 'lucide-react'

export const LoadingState: React.FC<{ message?: string; className?: string }> = ({
  message = 'Loading...',
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-center justify-center p-12 text-center ${className}`}>
      <Loader2 className="w-8 h-8 animate-spin text-[#0F5B57] mb-3" />
      <p className="text-xs sm:text-sm text-[#687775] font-medium">{message}</p>
    </div>
  )
}
