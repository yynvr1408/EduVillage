import { useState, useEffect, useCallback, useRef } from 'react'
import { Room, RoomEvent, ConnectionQuality, Track } from 'livekit-client'

export interface UseAdaptiveAudioOptions {
  room: Room | null
  initialAudioOnly?: boolean
  autoAdaptiveEnabled?: boolean
  /** How long poor quality must persist before video is dropped. */
  sustainedThresholdMs?: number
  /** How long GOOD quality must persist before video is restored (longer than the drop, to avoid flapping). */
  recoveryThresholdMs?: number
  /** How long quality must stay at the worst tier (Lost), while already audio-only, before even
   * audio is considered too unreliable and a text fallback is offered instead. */
  severeThresholdMs?: number
}

const isPoor = (q: ConnectionQuality) => q === ConnectionQuality.Poor || q === ConnectionQuality.Lost
const isGood = (q: ConnectionQuality) => q === ConnectionQuality.Good || q === ConnectionQuality.Excellent

/**
 * Automatic audio-only adaptation with hysteresis:
 *   healthy --(poor for sustainedThresholdMs)--> audio-only --(good for recoveryThresholdMs)--> healthy
 * Quality events only fire when the quality CHANGES, so the thresholds are enforced with timers, not by
 * waiting for a second event. A manual choice by the student always wins. After a LiveKit reconnect
 * the subscription policy is re-applied, because a re-established session may reset track subscriptions.
 */
export function useAdaptiveAudio({
  room,
  initialAudioOnly = false,
  autoAdaptiveEnabled = true,
  sustainedThresholdMs = 5000,
  recoveryThresholdMs = 15000,
  severeThresholdMs = 8000,
}: UseAdaptiveAudioOptions) {
  const [isAudioOnly, setIsAudioOnly] = useState<boolean>(initialAudioOnly)
  const [isManualOverride, setIsManualOverride] = useState<boolean>(false)
  const [isAdaptiveActive, setIsAdaptiveActive] = useState<boolean>(false)
  const [poorQualityDuration, setPoorQualityDuration] = useState<number>(0)
  const [severeDegradation, setSevereDegradation] = useState<boolean>(false)

  // Latest values for use inside timers/event handlers without re-subscribing on every change.
  const audioOnlyRef = useRef(isAudioOnly)
  const manualRef = useRef(isManualOverride)
  const adaptiveRef = useRef(isAdaptiveActive)
  const qualityRef = useRef<ConnectionQuality | null>(null)
  const poorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const severeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poorSince = useRef<number | null>(null)
  audioOnlyRef.current = isAudioOnly
  manualRef.current = isManualOverride
  adaptiveRef.current = isAdaptiveActive

  // Actual media subscription control function
  const applySubscriptionPolicy = useCallback(
    (audioOnly: boolean) => {
      if (!room) return
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.kind === Track.Kind.Video) {
            // Unsubscribing at the WebRTC transport layer is what actually stops the video packets.
            publication.setSubscribed(!audioOnly)
          } else if (publication.kind === Track.Kind.Audio) {
            publication.setSubscribed(true) // audio stays on in every mode
          }
        })
      })
    },
    [room]
  )

  const clearTimers = () => {
    if (poorTimer.current) clearTimeout(poorTimer.current)
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current)
    if (severeTimer.current) clearTimeout(severeTimer.current)
    poorTimer.current = null
    recoveryTimer.current = null
    severeTimer.current = null
    poorSince.current = null
    setSevereDegradation(false)
  }

  // Toggle manual audio-only mode
  const toggleAudioOnly = useCallback(
    (forced?: boolean) => {
      const next = typeof forced === 'boolean' ? forced : !audioOnlyRef.current
      clearTimers()
      setIsManualOverride(true)
      setIsAudioOnly(next)
      setIsAdaptiveActive(false)
      applySubscriptionPolicy(next)
    },
    [applySubscriptionPolicy]
  )

  useEffect(() => {
    if (!room || !autoAdaptiveEnabled) return

    const engageAudioOnly = () => {
      poorTimer.current = null
      if (manualRef.current || audioOnlyRef.current) return
      if (qualityRef.current === null || !isPoor(qualityRef.current)) return // it improved while we waited
      console.debug('[adaptive] poor quality sustained: switching to audio-only')
      setIsAudioOnly(true)
      setIsAdaptiveActive(true)
      applySubscriptionPolicy(true)
    }

    const engageSevere = () => {
      severeTimer.current = null
      // Only meaningful once already audio-only, and only if it's still truly Lost (not just Poor).
      if (!audioOnlyRef.current || qualityRef.current !== ConnectionQuality.Lost) return
      console.debug('[adaptive] Lost quality sustained while audio-only: offering text fallback')
      setSevereDegradation(true)
    }

    const restoreVideo = () => {
      recoveryTimer.current = null
      if (manualRef.current || !adaptiveRef.current) return
      if (qualityRef.current === null || !isGood(qualityRef.current)) return // not stable after all
      console.debug('[adaptive] quality recovered and stable: restoring video')
      setIsAudioOnly(false)
      setIsAdaptiveActive(false)
      applySubscriptionPolicy(false)
    }

    const handleConnectionQuality = (quality: ConnectionQuality, participant: any) => {
      if (participant !== room.localParticipant) return
      qualityRef.current = quality

      if (isPoor(quality)) {
        if (recoveryTimer.current) {
          clearTimeout(recoveryTimer.current) // recovery was premature: restart the clock
          recoveryTimer.current = null
        }
        if (poorSince.current === null) poorSince.current = Date.now()
        if (!poorTimer.current && !manualRef.current && !audioOnlyRef.current) {
          poorTimer.current = setTimeout(engageAudioOnly, sustainedThresholdMs)
        }
        setPoorQualityDuration(Date.now() - poorSince.current)

        if (quality === ConnectionQuality.Lost) {
          if (audioOnlyRef.current && !severeTimer.current) {
            severeTimer.current = setTimeout(engageSevere, severeThresholdMs)
          }
        } else if (severeTimer.current) {
          // Poor but not Lost: audio is viable again, don't offer the text fallback.
          clearTimeout(severeTimer.current)
          severeTimer.current = null
          setSevereDegradation(false)
        }
      } else if (isGood(quality)) {
        if (poorTimer.current) {
          clearTimeout(poorTimer.current) // it was only a blip
          poorTimer.current = null
        }
        if (severeTimer.current) {
          clearTimeout(severeTimer.current)
          severeTimer.current = null
        }
        poorSince.current = null
        setPoorQualityDuration(0)
        setSevereDegradation(false)
        if (adaptiveRef.current && !manualRef.current && !recoveryTimer.current) {
          recoveryTimer.current = setTimeout(restoreVideo, recoveryThresholdMs)
        }
      }
    }

    // Policy must follow new tracks and survive a reconnect.
    const reapply = () => applySubscriptionPolicy(audioOnlyRef.current)
    const handleTrackPublished = (publication: any) => {
      if (publication?.kind === Track.Kind.Video) publication.setSubscribed(!audioOnlyRef.current)
    }
    const handleTrackSubscribed = (_track: any, publication: any) => {
      if (publication.kind === Track.Kind.Video && audioOnlyRef.current) publication.setSubscribed(false)
    }
    const handleReconnected = () => {
      // The old quality reading is stale; wait for a fresh one before judging, and re-assert subscriptions.
      qualityRef.current = null
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current)
      if (severeTimer.current) clearTimeout(severeTimer.current)
      recoveryTimer.current = null
      severeTimer.current = null
      setSevereDegradation(false)
      reapply()
    }
    const handleStateChanged = (state: string) => {
      // While the link is down no quality verdict is meaningful: do not restore video during a drop.
      if (state !== 'connected' && recoveryTimer.current) {
        clearTimeout(recoveryTimer.current)
        recoveryTimer.current = null
      }
    }

    room.on(RoomEvent.ConnectionQualityChanged, handleConnectionQuality)
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    room.on(RoomEvent.TrackPublished, handleTrackPublished)
    room.on(RoomEvent.Reconnected, handleReconnected)
    room.on(RoomEvent.ConnectionStateChanged, handleStateChanged)

    reapply() // initial mount / room ready

    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, handleConnectionQuality)
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      room.off(RoomEvent.TrackPublished, handleTrackPublished)
      room.off(RoomEvent.Reconnected, handleReconnected)
      room.off(RoomEvent.ConnectionStateChanged, handleStateChanged)
      clearTimers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, autoAdaptiveEnabled, sustainedThresholdMs, recoveryThresholdMs, applySubscriptionPolicy])

  // Re-apply whenever the mode flips (covers the automatic transitions as well as manual ones).
  useEffect(() => {
    applySubscriptionPolicy(isAudioOnly)
  }, [isAudioOnly, applySubscriptionPolicy])

  return {
    isAudioOnly,
    isManualOverride,
    isAdaptiveActive,
    toggleAudioOnly,
    poorQualityDuration,
    /** True once audio-only mode has itself been unreliable (Lost quality) for severeThresholdMs. */
    severeDegradation,
  }
}
