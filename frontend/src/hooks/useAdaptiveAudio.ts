import { useState, useEffect, useCallback, useRef } from 'react'
import { Room, RoomEvent, ConnectionQuality, Track } from 'livekit-client'

export interface UseAdaptiveAudioOptions {
  room: Room | null
  initialAudioOnly?: boolean
  autoAdaptiveEnabled?: boolean
  sustainedThresholdMs?: number // how long poor quality must persist to activate
}

export function useAdaptiveAudio({
  room,
  initialAudioOnly = false,
  autoAdaptiveEnabled = true,
  sustainedThresholdMs = 5000,
}: UseAdaptiveAudioOptions) {
  const [isAudioOnly, setIsAudioOnly] = useState<boolean>(initialAudioOnly)
  const [isManualOverride, setIsManualOverride] = useState<boolean>(false)
  const [isAdaptiveActive, setIsAdaptiveActive] = useState<boolean>(false)
  const [poorQualityDuration, setPoorQualityDuration] = useState<number>(0)
  
  const poorStartTimeRef = useRef<number | null>(null)

  // Actual media subscription control function
  const applySubscriptionPolicy = useCallback(
    (audioOnly: boolean) => {
      if (!room) return

      // Iterate through remote participants and update their video track subscriptions
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.kind === Track.Kind.Video) {
            // Unsubscribe from video tracks at the WebRTC transport layer
            // When audioOnly is true -> setSubscribed(false) cuts off video packets!
            publication.setSubscribed(!audioOnly)
          } else if (publication.kind === Track.Kind.Audio) {
            // Keep audio subscribed always
            publication.setSubscribed(true)
          }
        })
      })
    },
    [room]
  )

  // Toggle manual audio-only mode
  const toggleAudioOnly = useCallback(
    (forced?: boolean) => {
      const next = typeof forced === 'boolean' ? forced : !isAudioOnly
      setIsManualOverride(true)
      setIsAudioOnly(next)
      setIsAdaptiveActive(false)
      applySubscriptionPolicy(next)
    },
    [isAudioOnly, applySubscriptionPolicy]
  )

  // Listen to connection quality changes from WebRTC
  useEffect(() => {
    if (!room || !autoAdaptiveEnabled) return

    const handleConnectionQuality = (
      quality: ConnectionQuality,
      participant: any
    ) => {
      // Monitor local participant connection quality
      if (participant === room.localParticipant) {
        if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) {
          const now = Date.now()
          if (!poorStartTimeRef.current) {
            poorStartTimeRef.current = now
          } else {
            const elapsed = now - poorStartTimeRef.current
            setPoorQualityDuration(elapsed)

            // If sustained poor quality exceeds threshold and not manually overridden
            if (elapsed >= sustainedThresholdMs && !isManualOverride && !isAudioOnly) {
              setIsAudioOnly(true)
              setIsAdaptiveActive(true)
              applySubscriptionPolicy(true)
            }
          }
        } else if (quality === ConnectionQuality.Excellent || quality === ConnectionQuality.Good) {
          // Stable recovery detected
          poorStartTimeRef.current = null
          setPoorQualityDuration(0)
        }
      }
    }

    const handleTrackSubscribed = (track: any, publication: any) => {
      // When a new track is added, ensure subscription matches current policy
      if (publication.kind === Track.Kind.Video && isAudioOnly) {
        publication.setSubscribed(false)
      }
    }

    room.on(RoomEvent.ConnectionQualityChanged, handleConnectionQuality)
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)

    // Apply policy on initial mount / room ready
    applySubscriptionPolicy(isAudioOnly)

    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, handleConnectionQuality)
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    }
  }, [room, autoAdaptiveEnabled, isManualOverride, isAudioOnly, sustainedThresholdMs, applySubscriptionPolicy])

  return {
    isAudioOnly,
    isManualOverride,
    isAdaptiveActive,
    toggleAudioOnly,
    poorQualityDuration,
  }
}
