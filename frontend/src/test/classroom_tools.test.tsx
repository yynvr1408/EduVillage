import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { apply, chunkSegment, decode, emptyBoard, encode, snapshot, type BoardState, type Message } from '../components/class/whiteboard/protocol'
import { Whiteboard } from '../components/class/whiteboard/Whiteboard'
import { FloatingVideo } from '../components/class/FloatingVideo'
import { ClassroomControls } from '../components/class/ClassroomControls'

const run = (messages: Message[], from: BoardState = emptyBoard()) => messages.reduce(apply, from)

describe('whiteboard protocol', () => {
  it('round-trips every message type and rejects malformed or oversized data', () => {
    const messages: Message[] = [
      { t: 'open', open: true },
      { t: 'seg', id: 'a', c: '#202B2A', w: 70, p: [1, 2, 3, 4] },
      { t: 'txt', id: 'b', x: 10, y: 20, s: 'Hello', c: '#B42318', z: 560 },
      { t: 'undo' },
      { t: 'clear' },
    ]
    for (const m of messages) expect(decode(encode(m))).toEqual(m)
    const bad = (v: unknown) => decode(new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)))
    expect(bad('not json')).toBeNull()
    expect(bad({ t: 'seg', id: 'a', c: 'x', w: 1, p: ['1'] })).toBeNull()
    expect(bad({ t: 'seg', id: 'a', c: 'x', w: 1, p: new Array(5000).fill(1) })).toBeNull()
    expect(bad({ t: 'txt', id: 'a', x: 1, y: 1, s: 'x'.repeat(600), c: 'x', z: 1 })).toBeNull()
    expect(bad({ t: 'nope' })).toBeNull()
    expect(bad(null)).toBeNull()
  })

  it('builds a stroke from segments, supports text, undo and clear', () => {
    let b = run([
      { t: 'seg', id: 's1', c: '#000', w: 70, p: [0, 0] },
      { t: 'seg', id: 's1', c: '#000', w: 70, p: [10, 10, 20, 20] },
      { t: 'txt', id: 't1', x: 5, y: 5, s: 'Note', c: '#000', z: 560 },
    ])
    expect(b.items).toHaveLength(2)
    expect(b.items[0]).toMatchObject({ kind: 'stroke', points: [0, 0, 10, 10, 20, 20] })
    b = apply(b, { t: 'txt', id: 't1', x: 5, y: 5, s: 'Note', c: '#000', z: 560 }) // a repeated message is not applied twice
    expect(b.items).toHaveLength(2)
    expect(apply(b, { t: 'undo' }).items).toHaveLength(1)
    expect(apply(b, { t: 'clear' }).items).toHaveLength(0)
  })

  it('a snapshot rebuilds the same board for a student who joins late', () => {
    const teacher = run([
      { t: 'open', open: true },
      { t: 'seg', id: 's1', c: '#000', w: 70, p: Array.from({ length: 1200 }, (_, i) => i) }, // longer than one packet
      { t: 'txt', id: 't1', x: 5, y: 5, s: 'Photosynthesis', c: '#B42318', z: 560 },
    ])
    const late = run(snapshot(teacher), run([{ t: 'seg', id: 'stale', c: '#000', w: 1, p: [1, 1] }]))
    expect(late).toEqual(teacher)
    expect(chunkSegment('x', '#000', 1, new Array(2000).fill(1)).length).toBeGreaterThan(1)
  })

  it('caps the number of items so a long lesson cannot grow without limit', () => {
    let b = emptyBoard()
    for (let i = 0; i < 700; i++) b = apply(b, { t: 'txt', id: `t${i}`, x: 0, y: 0, s: 'x', c: '#000', z: 1 })
    expect(b.items.length).toBeLessThanOrEqual(600)
  })
})

describe('Whiteboard component', () => {
  const board = run([{ t: 'txt', id: 't', x: 0, y: 0, s: 'Hi', c: '#000', z: 560 }])

  it('students get a read-only board they can save, with no drawing tools', () => {
    render(<Whiteboard board={board} />)
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /view only/i })).toBeInTheDocument()
    expect(screen.getByText('Save board as image')).toBeInTheDocument()
  })

  it('the teacher gets tools; undo and clear are broadcast, and the empty board invites writing', () => {
    const onAction = vi.fn()
    render(<Whiteboard board={emptyBoard()} onAction={onAction} applyLocal={vi.fn()} send={vi.fn()} />)
    expect(screen.getByText(/Write or type here/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear board' }))
    expect(onAction).toHaveBeenNthCalledWith(1, { t: 'undo' })
    expect(onAction).toHaveBeenNthCalledWith(2, { t: 'clear' })
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Colour #B42318' }))
    expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true') // choosing a colour leaves the eraser
  })

  it('typing text on the board sends a text item', () => {
    const onAction = vi.fn()
    render(<Whiteboard board={emptyBoard()} onAction={onAction} applyLocal={vi.fn()} send={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    const canvas = screen.getByRole('img', { name: /draw or type/i })
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 562, right: 1000, bottom: 562, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.pointerDown(canvas, { clientX: 500, clientY: 281 })
    const box = screen.getByLabelText('Type text for the board')
    fireEvent.change(box, { target: { value: 'Newton: F = ma' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ t: 'txt', s: 'Newton: F = ma', x: 5000 }))
  })
})

describe('FloatingVideo', () => {
  const setup = (over: Partial<React.ComponentProps<typeof FloatingVideo>> = {}) => {
    const onSizeChange = vi.fn()
    const onHiddenChange = vi.fn()
    const utils = render(
      <div style={{ position: 'relative', width: 800, height: 600 }}>
        <FloatingVideo label="Ms Rao" size="small" onSizeChange={onSizeChange} hidden={false} onHiddenChange={onHiddenChange} {...over}>
          <video data-testid="v" />
        </FloatingVideo>
      </div>,
    )
    return { onSizeChange, onHiddenChange, ...utils }
  }

  it('is small by default, can be enlarged and hidden, and shows its own action buttons', () => {
    const { onSizeChange, onHiddenChange } = setup({ actions: <button aria-label="Blur background">b</button> })
    const box = screen.getByTestId('floating-video')
    expect(box).toHaveAttribute('data-size', 'small')
    expect(box).toHaveStyle({ width: '188px' })
    expect(screen.getByLabelText('Blur background')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge video window' }))
    expect(onSizeChange).toHaveBeenCalledWith('large')
    fireEvent.click(screen.getByRole('button', { name: 'Hide video window' }))
    expect(onHiddenChange).toHaveBeenCalledWith(true)
  })

  it('large size is bigger, and a hidden window leaves only a Show video chip', () => {
    const { rerender } = setup({ size: 'large' })
    expect(screen.getByTestId('floating-video')).toHaveStyle({ width: '384px' })
    rerender(
      <div style={{ position: 'relative' }}>
        <FloatingVideo label="Ms Rao" size="large" onSizeChange={() => {}} hidden onHiddenChange={() => {}}>
          <video />
        </FloatingVideo>
      </div>,
    )
    expect(screen.queryByTestId('floating-video')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Ms Rao' })).toBeInTheDocument()
  })
})

describe('ClassroomControls teacher tools', () => {
  const base = {
    isMicEnabled: true, onToggleMic: () => {}, isCameraEnabled: true, onToggleCamera: () => {}, canPublishVideo: true,
    isAudioOnly: false, onToggleAudioOnly: () => {}, isAdaptiveActive: false, onToggleSummary: () => {}, isSummaryOpen: false,
    onLeave: () => {}, connectionState: 'connected',
  }

  it('students do not get screen sharing, whiteboard or blur', () => {
    render(<ClassroomControls {...base} canPublishVideo={false} />)
    expect(screen.queryByRole('button', { name: 'Whiteboard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Share screen/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Blur background' })).not.toBeInTheDocument()
  })

  it('teachers can share a screen (and add more), toggle the whiteboard and the blur', () => {
    const t = { canShareScreen: true, isSharingScreen: false, onAddScreen: vi.fn(), isBoardOpen: false, onToggleBoard: vi.fn(), blurOn: true, blurSupported: true, onToggleBlur: vi.fn() }
    const { rerender } = render(<ClassroomControls {...base} teacherTools={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Whiteboard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Blur background' }))
    expect(t.onAddScreen).toHaveBeenCalled()
    expect(t.onToggleBoard).toHaveBeenCalled()
    expect(t.onToggleBlur).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Blur background' })).toHaveAttribute('aria-pressed', 'true')
    rerender(<ClassroomControls {...base} teacherTools={{ ...t, isSharingScreen: true }} />)
    expect(screen.getByRole('button', { name: 'Share another screen' })).toBeInTheDocument()
    rerender(<ClassroomControls {...base} teacherTools={{ ...t, canShareScreen: false, blurSupported: false }} />)
    expect(screen.getByRole('button', { name: 'Share screen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Blur background' })).toBeDisabled()
  })
})
