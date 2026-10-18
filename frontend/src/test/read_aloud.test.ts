import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReadAloud } from '../hooks/useReadAloud'

class FakeUtterance {
  text: string
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

describe('useReadAloud', () => {
  let speak: ReturnType<typeof vi.fn>
  let cancel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    speak = vi.fn()
    cancel = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak, cancel })
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports supported when the browser has SpeechSynthesis, and speaks the given text', () => {
    const { result } = renderHook(() => useReadAloud())
    expect(result.current.supported).toBe(true)

    act(() => result.current.read('Photosynthesis converts light into chemical energy.'))
    expect(speak).toHaveBeenCalledTimes(1)
    expect((speak.mock.calls[0][0] as FakeUtterance).text).toBe('Photosynthesis converts light into chemical energy.')
    expect(result.current.isReading).toBe(true)
  })

  it('cancels any previous utterance before starting a new one (only one plays at a time)', () => {
    const { result } = renderHook(() => useReadAloud())
    act(() => result.current.read('First summary.'))
    act(() => result.current.read('Second summary.'))
    expect(cancel).toHaveBeenCalled()
    expect(speak).toHaveBeenCalledTimes(2)
  })

  it('stop() cancels playback and clears isReading', () => {
    const { result } = renderHook(() => useReadAloud())
    act(() => result.current.read('Reading this aloud.'))
    act(() => result.current.stop())
    expect(cancel).toHaveBeenCalled()
    expect(result.current.isReading).toBe(false)
  })

  it('isReading clears itself when the utterance finishes naturally', () => {
    const { result } = renderHook(() => useReadAloud())
    act(() => result.current.read('A short summary.'))
    const utterance = speak.mock.calls[0][0] as FakeUtterance
    act(() => utterance.onend?.())
    expect(result.current.isReading).toBe(false)
  })

  it('ignores empty/whitespace-only text instead of speaking nothing', () => {
    const { result } = renderHook(() => useReadAloud())
    act(() => result.current.read('   '))
    expect(speak).not.toHaveBeenCalled()
  })

  it('stops any in-progress reading when the component unmounts', () => {
    const { result, unmount } = renderHook(() => useReadAloud())
    act(() => result.current.read('Still talking when this unmounts.'))
    unmount()
    expect(cancel).toHaveBeenCalled()
  })
})
