import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { EventEmitter } from 'node:events'
import { RoomEvent, ConnectionQuality, Track } from 'livekit-client'
import { useAdaptiveAudio } from '../hooks/useAdaptiveAudio'
import { diagnoseConnectivity } from '../services/connectivity'

/**
 * These tests drive the adaptation logic with a SIMULATED LiveKit room (events and subscription calls
 * are faked). They verify the state machine; they do not prove real WebRTC behaviour on a real network.
 */

class FakeRoom extends EventEmitter {
  localParticipant = {}
  remoteParticipants = new Map<string, any>()
  video = { kind: Track.Kind.Video, setSubscribed: vi.fn() }
  audio = { kind: Track.Kind.Audio, setSubscribed: vi.fn() }
  constructor() {
    super()
    this.remoteParticipants.set('teacher', { trackPublications: new Map([['v', this.video], ['a', this.audio]]) })
  }
  quality(q: ConnectionQuality) {
    this.emit(RoomEvent.ConnectionQualityChanged, q, this.localParticipant)
  }
  state(s: string) {
    this.emit(RoomEvent.ConnectionStateChanged, s)
  }
  reconnected() {
    this.emit(RoomEvent.Reconnected)
  }
  lastVideoSubscription() {
    return this.video.setSubscribed.mock.calls.at(-1)?.[0]
  }
}

const mount = (room: FakeRoom, opts = {}) =>
  renderHook(() => useAdaptiveAudio({ room: room as any, sustainedThresholdMs: 5000, recoveryThresholdMs: 15000, ...opts }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('automatic audio-only adaptation', () => {
  it('drops remote video only after poor quality is SUSTAINED, even with a single quality event', () => {
    const room = new FakeRoom()
    const { result } = mount(room)
    act(() => room.quality(ConnectionQuality.Poor)) // one event, then silence (events fire only on change)
    act(() => void vi.advanceTimersByTime(4000))
    expect(result.current.isAudioOnly).toBe(false) // not yet: 4 s < 5 s
    act(() => void vi.advanceTimersByTime(1500))
    expect(result.current.isAudioOnly).toBe(true)
    expect(result.current.isAdaptiveActive).toBe(true)
    expect(room.lastVideoSubscription()).toBe(false) // the track is really unsubscribed, not just hidden
    expect(room.audio.setSubscribed).toHaveBeenLastCalledWith(true) // audio is kept
  })

  it('ignores a momentary dip (no flapping)', () => {
    const room = new FakeRoom()
    const { result } = mount(room)
    act(() => room.quality(ConnectionQuality.Poor))
    act(() => void vi.advanceTimersByTime(2000))
    act(() => room.quality(ConnectionQuality.Good)) // recovered quickly
    act(() => void vi.advanceTimersByTime(30_000))
    expect(result.current.isAudioOnly).toBe(false)
    expect(room.video.setSubscribed).not.toHaveBeenCalledWith(false)
  })

  it('restores video only after quality stays good for the longer recovery period', () => {
    const room = new FakeRoom()
    const { result } = mount(room)
    act(() => room.quality(ConnectionQuality.Lost))
    act(() => void vi.advanceTimersByTime(5000))
    expect(result.current.isAudioOnly).toBe(true)

    act(() => room.quality(ConnectionQuality.Good))
    act(() => void vi.advanceTimersByTime(10_000))
    expect(result.current.isAudioOnly).toBe(true) // one good sample / 10 s is not enough
    expect(room.lastVideoSubscription()).toBe(false)
    act(() => void vi.advanceTimersByTime(5500))
    expect(result.current.isAudioOnly).toBe(false)
    expect(result.current.isAdaptiveActive).toBe(false)
    expect(room.lastVideoSubscription()).toBe(true) // video subscription really restored
  })

  it('cancels a pending recovery if quality turns poor again', () => {
    const room = new FakeRoom()
    const { result } = mount(room)
    act(() => room.quality(ConnectionQuality.Poor))
    act(() => void vi.advanceTimersByTime(5000))
    act(() => room.quality(ConnectionQuality.Excellent))
    act(() => void vi.advanceTimersByTime(10_000))
    act(() => room.quality(ConnectionQuality.Poor)) // relapse before the 15 s were up
    act(() => void vi.advanceTimersByTime(20_000))
    expect(result.current.isAudioOnly).toBe(true) // stayed audio-only; no oscillation
    act(() => room.quality(ConnectionQuality.Good))
    act(() => void vi.advanceTimersByTime(15_500))
    expect(result.current.isAudioOnly).toBe(false) // a full, uninterrupted good period restores it
  })

  it('does not judge quality or restore video while the connection is down, and re-applies the policy after a reconnect', () => {
    const room = new FakeRoom()
    const { result } = mount(room)
    act(() => room.quality(ConnectionQuality.Poor))
    act(() => void vi.advanceTimersByTime(5000))
    act(() => room.quality(ConnectionQuality.Good))
    act(() => void vi.advanceTimersByTime(8000))
    act(() => room.state('reconnecting')) // the link dropped mid-recovery: the recovery clock must not keep running
    act(() => void vi.advanceTimersByTime(30_000))
    expect(result.current.isAudioOnly).toBe(true)

    room.video.setSubscribed.mockClear()
    act(() => room.state('connected'))
    act(() => room.reconnected()) // LiveKit rebuilt the session: subscriptions must be re-asserted
    expect(room.video.setSubscribed).toHaveBeenCalledWith(false) // still audio-only until quality is proven good again
    act(() => room.quality(ConnectionQuality.Good))
    act(() => void vi.advanceTimersByTime(15_500))
    expect(result.current.isAudioOnly).toBe(false)
    expect(room.lastVideoSubscription()).toBe(true)
  })

  it('applies the current policy to video tracks published later', () => {
    const room = new FakeRoom()
    mount(room)
    act(() => room.quality(ConnectionQuality.Poor))
    act(() => void vi.advanceTimersByTime(5000))
    const lateVideo = { kind: Track.Kind.Video, setSubscribed: vi.fn() }
    act(() => void room.emit(RoomEvent.TrackPublished, lateVideo))
    expect(lateVideo.setSubscribed).toHaveBeenCalledWith(false)
  })

  it('never overrides a manual choice', () => {
    const room = new FakeRoom()
    const { result } = mount(room)
    act(() => result.current.toggleAudioOnly(true)) // the student chose audio-only
    act(() => room.quality(ConnectionQuality.Excellent))
    act(() => void vi.advanceTimersByTime(60_000))
    expect(result.current.isAudioOnly).toBe(true)
    expect(result.current.isManualOverride).toBe(true)

    act(() => result.current.toggleAudioOnly(false)) // and chose video
    act(() => room.quality(ConnectionQuality.Poor))
    act(() => void vi.advanceTimersByTime(60_000))
    expect(result.current.isAudioOnly).toBe(false)
  })

  it('clears its timers when the classroom is left', () => {
    const room = new FakeRoom()
    const { unmount } = mount(room)
    act(() => room.quality(ConnectionQuality.Poor))
    unmount()
    act(() => void vi.advanceTimersByTime(60_000))
    expect(room.video.setSubscribed).not.toHaveBeenCalledWith(false)
    expect(room.listenerCount(RoomEvent.ConnectionQualityChanged)).toBe(0)
  })
})

describe('connectivity diagnosis keeps device, API and live media separate', () => {
  const d = (browserOnline: boolean, apiReachable: boolean, liveKitState: string) => diagnoseConnectivity({ browserOnline, apiReachable, liveKitState })

  it('healthy', () => expect(d(true, true, 'connected').cause).toBe('ok'))

  it('device offline: says so and that downloads still work', () => {
    const r = d(false, false, 'disconnected')
    expect(r.cause).toBe('device_offline')
    expect(r.guidance).toMatch(/no internet connection/i)
    expect(r.guidance).toMatch(/downloaded/i)
    expect(r.canRejoinLive).toBe(false)
  })

  it('browser says online but nothing can be reached: weak/blocked network, not "offline"', () => {
    const r = d(true, false, 'disconnected')
    expect(r.cause).toBe('network_unstable')
    expect(r.headline).not.toMatch(/offline/i)
  })

  it('internet and API fine, media down: the live server is the problem and rejoining is worth trying', () => {
    const r = d(true, true, 'disconnected')
    expect(r.cause).toBe('media_unreachable')
    expect(r.canRejoinLive).toBe(true)
    expect(r.guidance).toMatch(/internet and EduVillage are working/i)
  })

  it('API down but live media healthy: the class is NOT reported as lost', () => {
    const r = d(true, false, 'connected')
    expect(r.cause).toBe('api_down_media_ok')
    expect(r.headline).toMatch(/still in the class/i)
  })

  it('a brief LiveKit retry is a reconnection, not a failure', () => {
    expect(d(true, true, 'reconnecting').cause).toBe('reconnecting')
  })

  it('device offline but media still connected (stale flag) does not claim the class is lost', () => {
    expect(d(false, false, 'connected').cause).toBe('api_down_media_ok')
  })
})
