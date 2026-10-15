import React, { useEffect } from 'react'
import { X } from 'lucide-react'

export interface SheetProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  position?: 'bottom' | 'right'
}

export const Sheet: React.FC<SheetProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  position = 'bottom',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
      <div
        className="fixed inset-0 bg-black/50 transition-opacity backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-0 pointer-events-none flex">
        {position === 'bottom' ? (
          <div className="mt-auto w-full max-h-[85vh] bg-[#FFFFFF] border-t border-[#E5E5E5] rounded-t-2xl pointer-events-auto flex flex-col shadow-2xl safe-bottom">
            <div className="w-12 h-1.5 bg-[#E5E5E5] rounded-full mx-auto mt-3 mb-1 shrink-0" />
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E5E5]">
              <div>
                {title && <h3 className="font-semibold text-base text-[#111111]">{title}</h3>}
                {description && <p className="text-xs text-[#666666] mt-0.5">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-[#666666] hover:text-[#111111] rounded-md hover:bg-[#F5F5F5]"
                aria-label="Close sheet"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">{children}</div>
          </div>
        ) : (
          <div className="ml-auto w-full max-w-md h-full bg-[#FFFFFF] border-l border-[#E5E5E5] pointer-events-auto flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E5]">
              <div>
                {title && <h3 className="font-semibold text-base text-[#111111]">{title}</h3>}
                {description && <p className="text-xs text-[#666666] mt-0.5">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-[#666666] hover:text-[#111111] rounded-md hover:bg-[#F5F5F5]"
                aria-label="Close sheet"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">{children}</div>
          </div>
        )}
      </div>
    </div>
  )
}
