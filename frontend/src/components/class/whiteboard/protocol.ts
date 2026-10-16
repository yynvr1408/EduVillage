/**
 * Whiteboard wire protocol. The teacher's board is shared over the LiveKit data channel (a few hundred bytes per
 * stroke, so it still works when a student is in audio-only mode on a weak connection).
 *
 * Coordinates are integers in a 0..SCALE logical space on a 16:9 board, so every screen renders the same picture.
 */

export const TOPIC = 'whiteboard'
export const SCALE = 10000 // x: 0..SCALE, y: 0..SCALE*9/16 (kept in the same units, see aspect)
export const ASPECT = 16 / 9
export const MAX_ITEMS = 600
const MAX_POINTS_PER_MESSAGE = 400 // keeps one message well under the data-channel packet limit

export interface Stroke {
  kind: 'stroke'
  id: string
  color: string
  width: number // in board units (SCALE/1000 = thin)
  points: number[] // x0,y0,x1,y1,...
}

export interface TextItem {
  kind: 'text'
  id: string
  x: number
  y: number
  text: string
  color: string
  size: number
}

export type BoardItem = Stroke | TextItem

export type Message =
  | { t: 'open'; open: boolean }
  | { t: 'seg'; id: string; c: string; w: number; p: number[] } // append points to a stroke (creates it if new)
  | { t: 'txt'; id: string; x: number; y: number; s: string; c: string; z: number }
  | { t: 'undo' }
  | { t: 'clear' }
  | { t: 'req' } // a student asks the teacher for the current board

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encode(message: Message) {
  return encoder.encode(JSON.stringify(message))
}

/** Returns null for anything that is not a well-formed message (never trust data from the network). */
export function decode(payload: Uint8Array): Message | null {
  let raw: any
  try {
    raw = JSON.parse(decoder.decode(payload))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const str = (v: unknown, max = 500) => typeof v === 'string' && v.length <= max
  switch (raw.t) {
    case 'open':
      return typeof raw.open === 'boolean' ? { t: 'open', open: raw.open } : null
    case 'seg':
      return str(raw.id, 64) && str(raw.c, 32) && num(raw.w) && Array.isArray(raw.p) && raw.p.length <= MAX_POINTS_PER_MESSAGE * 2 && raw.p.every(num)
        ? { t: 'seg', id: raw.id, c: raw.c, w: raw.w, p: raw.p }
        : null
    case 'txt':
      return str(raw.id, 64) && num(raw.x) && num(raw.y) && str(raw.s, 500) && str(raw.c, 32) && num(raw.z)
        ? { t: 'txt', id: raw.id, x: raw.x, y: raw.y, s: raw.s, c: raw.c, z: raw.z }
        : null
    case 'undo':
    case 'clear':
    case 'req':
      return { t: raw.t }
    default:
      return null
  }
}

export interface BoardState {
  open: boolean
  items: BoardItem[]
}

export const emptyBoard = (): BoardState => ({ open: false, items: [] })

/** Pure reducer: the same function runs on the teacher (own actions) and on every student (received messages). */
export function apply(state: BoardState, message: Message): BoardState {
  switch (message.t) {
    case 'open':
      return { ...state, open: message.open }
    case 'clear':
      return { ...state, items: [] }
    case 'undo':
      return { ...state, items: state.items.slice(0, -1) }
    case 'seg': {
      const existing = state.items.findIndex((i) => i.kind === 'stroke' && i.id === message.id)
      if (existing >= 0) {
        const items = state.items.slice()
        const s = items[existing] as Stroke
        items[existing] = { ...s, points: s.points.concat(message.p) }
        return { ...state, items }
      }
      return { ...state, items: trim([...state.items, { kind: 'stroke', id: message.id, color: message.c, width: message.w, points: message.p.slice() }]) }
    }
    case 'txt': {
      if (state.items.some((i) => i.kind === 'text' && i.id === message.id)) return state
      return { ...state, items: trim([...state.items, { kind: 'text', id: message.id, x: message.x, y: message.y, text: message.s, color: message.c, size: message.z }]) }
    }
    default:
      return state
  }
}

function trim(items: BoardItem[]): BoardItem[] {
  return items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items
}

/** The messages that rebuild a board from nothing (sent to a student who joins late or asks for it). */
export function snapshot(state: BoardState): Message[] {
  const out: Message[] = [{ t: 'clear' }, { t: 'open', open: state.open }]
  for (const item of state.items) {
    if (item.kind === 'text') {
      out.push({ t: 'txt', id: item.id, x: item.x, y: item.y, s: item.text, c: item.color, z: item.size })
    } else {
      for (let i = 0; i < item.points.length; i += MAX_POINTS_PER_MESSAGE * 2) {
        out.push({ t: 'seg', id: item.id, c: item.color, w: item.width, p: item.points.slice(i, i + MAX_POINTS_PER_MESSAGE * 2) })
      }
    }
  }
  return out
}

/** Splits a long stroke segment into messages that fit in one data packet. */
export function chunkSegment(id: string, color: string, width: number, points: number[]): Message[] {
  const out: Message[] = []
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_MESSAGE * 2) {
    out.push({ t: 'seg', id, c: color, w: width, p: points.slice(i, i + MAX_POINTS_PER_MESSAGE * 2) })
  }
  return out
}

export const COLORS = ['#202B2A', '#B42318', '#2364AA', '#247A4D', '#8A5700'] as const

/** Board height in the same units as x (so a normalized y is 0..BOARD_H). */
export const BOARD_W = SCALE
export const BOARD_H = Math.round(SCALE / ASPECT)

export function draw(ctx: CanvasRenderingContext2D, items: BoardItem[], pxWidth: number, pxHeight: number) {
  ctx.save()
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, pxWidth, pxHeight)
  const k = pxWidth / BOARD_W
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const item of items) {
    if (item.kind === 'stroke') {
      ctx.strokeStyle = item.color
      ctx.fillStyle = item.color
      ctx.lineWidth = Math.max(1, item.width * k)
      const p = item.points
      if (p.length === 2) {
        ctx.beginPath()
        ctx.arc(p[0] * k, p[1] * k, Math.max(0.5, (item.width * k) / 2), 0, Math.PI * 2)
        ctx.fill()
      } else if (p.length >= 4) {
        ctx.beginPath()
        ctx.moveTo(p[0] * k, p[1] * k)
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * k, p[i + 1] * k)
        ctx.stroke()
      }
    } else {
      ctx.fillStyle = item.color
      ctx.font = `${Math.max(8, item.size * k)}px sans-serif`
      ctx.textBaseline = 'top'
      const lines = item.text.split('\n')
      lines.forEach((line, i) => ctx.fillText(line, item.x * k, item.y * k + i * item.size * k * 1.25))
    }
  }
  ctx.restore()
}
