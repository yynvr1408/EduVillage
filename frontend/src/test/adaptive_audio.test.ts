import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAdaptiveAudio } from '../hooks/useAdaptiveAudio'
import { Track } from 'livekit-client'

describe('Adaptive Audio-Only Mode & WebRTC Subscription Control', () => {
  it('controls media subscriptions by unsubscribing video tracks while keeping audio subscribed', () => {
    const videoTrackMock = {
      kind: Track.Kind.Video,
      setSubscribed: vi.fn(),
    }
    const audioTrackMock = {
      kind: Track.Kind.Audio,
      setSubscribed: vi.fn(),
    }

    const mockParticipant = {
      trackPublications: new Map([
        ['video-1', videoTrackMock],
        ['audio-1', audioTrackMock],
      ]),
    }

    const mockRoom: any = {
      remoteParticipants: new Map([['part-1', mockParticipant]]),
      on: vi.fn(),
      off: vi.fn(),
    }

    const { result } = renderHook(() =>
      useAdaptiveAudio({
        room: mockRoom,
        initialAudioOnly: false,
        autoAdaptiveEnabled: true,
      })
    )

    // Initial state: not audio only
    expect(result.current.isAudioOnly).toBe(false)

    // Activate Audio-Only mode (e.g. user toggle or adaptive trigger)
    act(() => {
      result.current.toggleAudioOnly(true)
    })

    expect(result.current.isAudioOnly).toBe(true)

    // Verify actual WebRTC transport layer subscription control
    // Video track MUST have setSubscribed(false) called to stop packet flow over wire
    expect(videoTrackMock.setSubscribed).toHaveBeenCalledWith(false)
    // Audio track MUST remain subscribed
    expect(audioTrackMock.setSubscribed).toHaveBeenCalledWith(true)

    // Switch back to video mode
    act(() => {
      result.current.toggleAudioOnly(false)
    })

    expect(result.current.isAudioOnly).toBe(false)
    expect(videoTrackMock.setSubscribed).toHaveBeenCalledWith(true)
  })
})

describe('getStats()-based packet-loss detection (independent of the server-pushed quality event)', () => {
  function makeRoomWithVideoStats(statsSequence: Array<{ packetsLost: number; packetsReceived: number }>) {
    let call = 0
    const videoPublication: any = {
      kind: Track.Kind.Video,
      isSubscribed: true,
      setSubscribed: vi.fn(function (this: any, v: boolean) {
        this.isSubscribed = v
      }),
      track: {
        getRTCStatsReport: vi.fn(async () => {
          const sample = statsSequence[Math.min(call, statsSequence.length - 1)]
          call += 1
          return new Map([['inbound-rtp-1', { type: 'inbound-rtp', ...sample, bytesReceived: 1000 }]])
        }),
      },
    }
    const audioPublication: any = { kind: Track.Kind.Audio, isSubscribed: true, setSubscribed: vi.fn() }
    const participant = { trackPublications: new Map([['v', videoPublication], ['a', audioPublication]]) }
    const room: any = {
      remoteParticipants: new Map([['p1', participant]]),
      localParticipant: {},
      on: vi.fn(),
      off: vi.fn(),
    }
    return { room, videoPublication }
  }

  it('a single bad sample never triggers audio-only (one sample is not a permanent failure)', async () => {
    vi.useFakeTimers()
    const { room, videoPublication } = makeRoomWithVideoStats([{ packetsLost: 50, packetsReceived: 50 }]) // 50% loss, but only ever sampled once below
    const { result } = renderHook(() =>
      useAdaptiveAudio({ room, statsPollIntervalMs: 1000, statsConsecutiveBadSamples: 2, autoAdaptiveEnabled: true })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000) // exactly one poll
    })
    expect(result.current.isAudioOnly).toBe(false)
    expect(videoPublication.setSubscribed).not.toHaveBeenCalledWith(false)
    vi.useRealTimers()
  })

  it('enough consecutive bad samples, sustained past the threshold, switches to audio-only for real', async () => {
    vi.useFakeTimers()
    const { room, videoPublication } = makeRoomWithVideoStats([{ packetsLost: 40, packetsReceived: 10 }]) // 80% loss, every sample
    const { result } = renderHook(() =>
      useAdaptiveAudio({
        room,
        statsPollIntervalMs: 1000,
        statsConsecutiveBadSamples: 2,
        sustainedThresholdMs: 3000,
        autoAdaptiveEnabled: true,
      })
    )
    // Two consecutive bad polls (2000ms) are required before the signal even counts as "poor"...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current.isAudioOnly).toBe(false) // the sustained-threshold clock has only just started
    // ...then the sustained-threshold clock (3000ms from when "poor" first registered) must also elapse.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(result.current.isAudioOnly).toBe(true)
    expect(videoPublication.setSubscribed).toHaveBeenCalledWith(false)
    vi.useRealTimers()
  })

  it('packet loss under the threshold never counts as a bad sample, however long it runs', async () => {
    vi.useFakeTimers()
    const { room, videoPublication } = makeRoomWithVideoStats([{ packetsLost: 1, packetsReceived: 99 }]) // 1% loss
    const { result } = renderHook(() =>
      useAdaptiveAudio({ room, statsPollIntervalMs: 1000, statsConsecutiveBadSamples: 2, sustainedThresholdMs: 2000, autoAdaptiveEnabled: true })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(result.current.isAudioOnly).toBe(false)
    expect(videoPublication.setSubscribed).not.toHaveBeenCalledWith(false)
    vi.useRealTimers()
  })
})
