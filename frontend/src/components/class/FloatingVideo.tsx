import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Minimize2, Move, Video } from 'lucide-react'

export type FloatSize = 'small' | 'large'

const DIMENSIONS: Record<FloatSize, { w: number; h: number }> = {
  small: { w: 188, h: 106 },
  large: { w: 384, h: 216 },
}
const HEADER = 30

/**
 * The teacher's camera as a small floating window (students see the teacher's; the teacher sees their own). It
 * can be dragged, enlarged, and tucked away into a chip. `children` is the video (or an audio-only placeholder).
 * `actions` are extra buttons (teacher: camera, microphone, blur).
 */
export const FloatingVideo: React.FC<{
  label: string
  size: FloatSize
  onSizeChange: (s: FloatSize) => void
  hidden: boolean
  onHiddenChange: (h: boolean) => void
  actions?: React.ReactNode
  /** Exposed as data-status for tests and diagnostics (for example whether blur is running). */
  status?: string
  children: React.ReactNode
}> = ({ label, size, onSizeChange, hidden, onHiddenChange, actions, status, children }) => {
  const boxRef = useRef<HTMLDivElement>(null)
  // null = default corner (bottom right); once dragged, an explicit position inside the stage
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const clamp = useCallback(
    (x: number, y: number) => {
      const parent = boxRef.current?.parentElement
      const { w, h } = DIMENSIONS[size]
      if (!parent) return { x, y }
      return {
        x: Math.max(4, Math.min(parent.clientWidth - w - 4, x)),
        y: Math.max(4, Math.min(parent.clientHeight - h - HEADER - 4, y)),
      }
    },
    [size],
  )

  // Keep it inside the stage when the window is resized or the video is enlarged.
  useEffect(() => {
    if (!pos) return
    const keep = () => setPos((p) => (p ? clamp(p.x, p.y) : p))
    keep()
    window.addEventListener('resize', keep)
    return () => window.removeEventListener('resize', keep)
  }, [size, clamp, pos === null]) // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (e: React.PointerEvent) => {
    const box = boxRef.current
    const parent = box?.parentElement
    if (!box || !parent) return
    const rect = box.getBoundingClientRect()
    const prect = parent.getBoundingClientRect()
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    setPos({ x: rect.left - prect.left, y: rect.top - prect.top })
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const prect = boxRef.current?.parentElement?.getBoundingClientRect()
    if (!prect) return
    setPos(clamp(e.clientX - prect.left - drag.current.dx, e.clientY - prect.top - drag.current.dy))
  }
  const onUp = () => {
    drag.current = null
  }

  const style: React.CSSProperties = pos ? { left: pos.x, top: pos.y } : { right: 12, bottom: 12 }

  if (hidden) {
    return (
      <div ref={boxRef} className="absolute z-20" style={style}>
        <button
          type="button"
          onClick={() => onHiddenChange(false)}
          className="flex items-center gap-2 px-3 py-2 rounded-full bg-[#121A19]/90 text-[#FFFFFF] border border-[#374947] text-xs font-semibold shadow-lg hover:bg-[#202B2A] cursor-pointer"
          aria-label={`Show ${label}`}
        >
          <Video className="w-4 h-4 text-[#DDF3EA]" /> Show video
        </button>
      </div>
    )
  }

  const { w, h } = DIMENSIONS[size]
  const iconBtn = 'p-1 rounded text-[#CBD7D1] hover:text-[#FFFFFF] hover:bg-[#374947] cursor-pointer'
  return (
    <div
      ref={boxRef}
      role="group"
      aria-label={label}
      className="absolute z-20 rounded-xl overflow-hidden border border-[#374947] bg-[#121A19] shadow-2xl"
      style={{ ...style, width: w }}
      data-testid="floating-video"
      data-size={size}
      data-status={status}
    >
      <div
        className="flex items-center gap-1 px-1.5 bg-[#202B2A] text-[#CBD7D1] select-none touch-none cursor-move"
        style={{ height: HEADER }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <Move className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0 truncate text-[11px] font-semibold">{label}</span>
        {/* buttons must not start a drag */}
        <span className="flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
          {actions}
          <button
            type="button"
            className={iconBtn}
            onClick={() => onSizeChange(size === 'small' ? 'large' : 'small')}
            aria-label={size === 'small' ? 'Enlarge video window' : 'Make video window smaller'}
          >
            {size === 'small' ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>
          <button type="button" className={iconBtn} onClick={() => onHiddenChange(true)} aria-label="Hide video window">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>
      <div style={{ height: h }} className="bg-[#000000] flex items-center justify-center overflow-hidden">
        {children}
      </div>
    </div>
  )
}
