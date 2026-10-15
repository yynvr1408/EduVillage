import React from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from './Button'

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 sm:p-12 text-center border border-dashed border-[#CBD7D1] rounded-2xl bg-[#F8FAF7] ${className}`}
    >
      <div className="w-12 h-12 rounded-full bg-[#DDF3EA] border border-[#CBD7D1] flex items-center justify-center text-[#0F5B57] mb-4">
        {icon || <FolderOpen className="w-6 h-6" />}
      </div>
      <h3 className="text-base font-semibold text-[#202B2A]">{title}</h3>
      {description && <p className="text-sm text-[#687775] max-w-sm mt-1 mb-5 leading-relaxed">{description}</p>}
      {actionLabel && onAction && (
        <Button onClick={onAction} size="sm" variant="secondary">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}

