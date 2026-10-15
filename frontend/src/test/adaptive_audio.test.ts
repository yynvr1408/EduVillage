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
