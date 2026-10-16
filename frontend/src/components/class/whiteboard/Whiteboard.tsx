import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Eraser, PenLine, Trash2, Type, Undo2 } from 'lucide-react'
import { BOARD_H, BOARD_W, COLORS, draw, chunkSegment, type BoardState, type Message } from './protocol'

const WIDTHS = [
  { label: 'Thin', value: 30 },
  { label: 'Medium', value: 70 },
  { label: 'Thick', value: 140 },
] as const
const SIZES = [{ label: 'S', value: 380 }, { label: 'M', value: 560 }, { label: 'L', value: 800 }] as const
const ERASER_COLOR = '#FFFFFF'

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** The board itself. `onAction` is present only for the teacher (students get a read-only view they can save as an image). */
export const Whiteboard: React.FC<{
  board: BoardState
  /** Teacher only: apply + broadcast (undo, clear, text). */
  onAction?: (m: Message) => void
  /** Teacher only: apply to the local board without sending (stroke points, sent in batches via `send`). */
  applyLocal?: (m: Message) => void
  /** Teacher only: broadcast without applying. */
  send?: (m: Message) => void
}> = ({ board, onAction, applyLocal, send }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tool, setTool] = useState<'pen' | 'eraser' | 'text'>('pen')
  const [color, setColor] = useState<string>(COLORS[0])
  const [width, setWidth] = useState<number>(WIDTHS[1].value)
  const [size, setSize] = useState<number>(SIZES[1].value)
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  const stroke = useRef<{ id: string; pending: number[]; color: string; width: number; timer: ReturnType<typeof setTimeout> | null } | null>(null)
  const editable = Boolean(onAction)

  const render = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssW = wrap.clientWidth
    const cssH = Math.round(cssW * (BOARD_H / BOARD_W))
    canvas.style.height = `${cssH}px`
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (ctx) draw(ctx, board.items, canvas.width, canvas.height)
  }, [board.items])

  useEffect(() => {
    render()
  }, [render])
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(render)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [render])

  const toBoard = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(BOARD_W, Math.round(((e.clientX - rect.left) / rect.width) * BOARD_W))),
      y: Math.max(0, Math.min(BOARD_H, Math.round(((e.clientY - rect.top) / rect.height) * BOARD_H))),
    }
  }

  /** Strokes are drawn locally on every move but sent in small batches (about 16 packets a second at most). */
  const flush = () => {
    const st = stroke.current
    if (!st) return
    if (st.timer) clearTimeout(st.timer)
    st.timer = null
    if (st.pending.length) {
      for (const m of chunkSegment(st.id, st.color, st.width, st.pending)) send?.(m)
      st.pending = []
    }
  }

  const addPoint = (x: number, y: number) => {
    const st = stroke.current
    if (!st) return
    const m: Message = { t: 'seg', id: st.id, c: st.color, w: st.width, p: [x, y] }
    applyLocal?.(m)
    st.pending.push(x, y)
    if (!st.timer) st.timer = setTimeout(flush, 60)
  }

  const onDown = (e: React.PointerEvent) => {
    if (!editable) return
    const p = toBoard(e)
    if (tool === 'text') {
      // Without this, the browser moves focus away from the new text box on the same click and it closes at once.
      e.preventDefault()
      setTextAt(p)
      setTextValue('')
      return
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const c = tool === 'eraser' ? ERASER_COLOR : color
    const w = tool === 'eraser' ? Math.max(width * 2, 120) : width
    stroke.current = { id: newId(), pending: [], color: c, width: w, timer: null }
    addPoint(p.x, p.y) // a single tap leaves a dot
  }

  const onMove = (e: React.PointerEvent) => {
    const st = stroke.current
    if (!st || !editable) return
    const p = toBoard(e)
    addPoint(p.x, p.y)
  }

  const onUp = () => {
    flush()
    stroke.current = null
  }

  const commitText = () => {
    if (textAt && textValue.trim() && onAction) {
      onAction({ t: 'txt', id: newId(), x: textAt.x, y: textAt.y, s: textValue.trim().slice(0, 500), c: color, z: size })
    }
    setTextAt(null)
    setTextValue('')
  }

  const savePng = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'eduvillage-whiteboard.png'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    })
  }

  const toolBtn = (active: boolean) =>
    `p-2 rounded-lg border cursor-pointer ${active ? 'bg-[#0F5B57] border-[#0F5B57] text-[#FFFFFF]' : 'bg-[#FFFFFF] border-[#CBD7D1] text-[#202B2A] hover:bg-[#DDF3EA]'}`

  return (
    <div className="w-full flex flex-col gap-2" data-testid="whiteboard">
      {editable && (
        <div className="flex flex-wrap items-center gap-2 bg-[#F8FAF7] border border-[#E1E8E4] rounded-xl p-2 text-[#202B2A]" role="toolbar" aria-label="Whiteboard tools">
          <button type="button" className={toolBtn(tool === 'pen')} onClick={() => setTool('pen')} aria-label="Pen" aria-pressed={tool === 'pen'}>
            <PenLine className="w-4 h-4" />
          </button>
          <button type="button" className={toolBtn(tool === 'text')} onClick={() => setTool('text')} aria-label="Text" aria-pressed={tool === 'text'}>
            <Type className="w-4 h-4" />
          </button>
          <button type="button" className={toolBtn(tool === 'eraser')} onClick={() => setTool('eraser')} aria-label="Eraser" aria-pressed={tool === 'eraser'}>
            <Eraser className="w-4 h-4" />
          </button>
          <span className="w-px h-6 bg-[#E1E8E4]" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setColor(c)
                if (tool === 'eraser') setTool('pen')
              }}
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              className={`w-6 h-6 rounded-full border-2 cursor-pointer ${color === c && tool !== 'eraser' ? 'border-[#0F5B57] ring-2 ring-[#DDF3EA]' : 'border-[#FFFFFF] shadow'}`}
              style={{ background: c }}
            />
          ))}
          <span className="w-px h-6 bg-[#E1E8E4]" />
          {tool === 'text'
            ? SIZES.map((s) => (
                <button key={s.label} type="button" className={`${toolBtn(size === s.value)} text-xs font-bold px-3`} onClick={() => setSize(s.value)} aria-label={`Text size ${s.label}`}>
                  {s.label}
                </button>
              ))
            : WIDTHS.map((w) => (
                <button key={w.label} type="button" className={`${toolBtn(width === w.value)} text-xs font-semibold px-3`} onClick={() => setWidth(w.value)} aria-label={`${w.label} line`}>
                  {w.label}
                </button>
              ))}
          <span className="flex-1" />
          <button type="button" className={toolBtn(false)} onClick={() => onAction!({ t: 'undo' })} aria-label="Undo">
            <Undo2 className="w-4 h-4" />
          </button>
          <button type="button" className={toolBtn(false)} onClick={() => onAction!({ t: 'clear' })} aria-label="Clear board">
            <Trash2 className="w-4 h-4" />
          </button>
          <button type="button" className={toolBtn(false)} onClick={savePng} aria-label="Save board as image">
            <Download className="w-4 h-4" />
          </button>
        </div>
      )}

      <div ref={wrapRef} className="relative w-full rounded-xl overflow-hidden border border-[#CBD7D1] bg-[#FFFFFF] shadow-xl">
        <canvas
          ref={canvasRef}
          className={`block w-full touch-none ${editable ? (tool === 'text' ? 'cursor-text' : 'cursor-crosshair') : ''}`}
          onPointerDown={onDown}
          onMouseDown={(e) => tool === 'text' && e.preventDefault()}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label={editable ? 'Whiteboard: draw or type for your students' : 'Teacher whiteboard (view only)'}
          role="img"
        />
        {textAt && editable && (
          <textarea
            autoFocus
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setTextAt(null)
                setTextValue('')
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commitText()
              }
            }}
            aria-label="Type text for the board"
            placeholder="Type, then press Enter"
            className="absolute bg-[#FFFFFF]/90 border border-[#0F5B57] rounded px-1 text-[#202B2A] outline-none resize-none"
            style={{ left: `${(textAt.x / BOARD_W) * 100}%`, top: `${(textAt.y / BOARD_H) * 100}%`, width: '40%', minHeight: '2.5rem' }}
          />
        )}
        {board.items.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-[#687775] pointer-events-none">
            {editable ? 'Write or type here: your students see it live.' : 'The teacher has not written anything yet.'}
          </p>
        )}
      </div>
      {!editable && (
        <button type="button" onClick={savePng} className="self-end inline-flex items-center gap-2 text-xs font-semibold text-[#DDF3EA] hover:text-[#FFFFFF] cursor-pointer">
          <Download className="w-4 h-4" /> Save board as image
        </button>
      )}
    </div>
  )
}
