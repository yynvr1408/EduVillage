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
  /** How often to independently sample real getStats() packet-loss on the incoming video track,
   * as a second, more direct signal alongside the server-pushed ConnectionQuality event. */
  statsPollIntervalMs?: number
  /** Consecutive bad getStats() samples required before that signal counts as "poor" — a single
   * noisy sample must never flip the mode (see the "two signals" note below). */
  statsConsecutiveBadSamples?: number
  /** Inbound packet-loss ratio (0-1) on the video track above which a getStats() sample counts as bad. */
  statsPacketLossThreshold?: number
}

const isPoor = (q: ConnectionQuality) => q === ConnectionQuality.Poor || q === ConnectionQuality.Lost
const isGood = (q: ConnectionQuality) => q === ConnectionQuality.Good || q === ConnectionQuality.Excellent

/**
 * Automatic audio-only adaptation with hysteresis:
 *   healthy --(poor for sustainedThresholdMs)--> audio-only --(good for recoveryThresholdMs)--> healthy
 *
 * Two independent signals feed the same hysteresis pipeline:
 *  1. LiveKit's server-pushed `ConnectionQualityChanged` event — authoritative, but event-driven
 *     (only fires on change) and, in testing against the real LiveKit Cloud service, observed to
 *     emit fresh "good" reports within ~1s even while a degraded condition is being simulated —
 *     i.e. a single poor report can be superseded almost immediately by a legitimate concurrent
 *     one. Relying on it alone means a genuinely-brief real blip and a sustained real problem are
 *     hard to tell apart from a single sample.
 *  2. A direct `getRTCStatsReport()` poll of the incoming video track's own inbound-rtp packet
 *     loss, sampled on a fixed interval and requiring several consecutive bad samples before it
 *     counts — this is this hook's own measurement of the actual thing that matters (packets
 *     actually being lost on the wire), not a derived server verdict, and isn't subject to the
 *     same one-sample flip-back.
 * Either signal reporting "poor" is enough to start the sustained-threshold clock; only a
 * sustained run of "good" from the authoritative quality signal restores video, so a single good
 * sample from either source never prematurely cancels an in-progress degradation.
 *
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
  statsPollIntervalMs = 2000,
  statsConsecutiveBadSamples = 2,
  statsPacketLossThreshold = 0.08,
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
  const statsPollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const consecutiveBadStats = useRef(0)
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
    if (statsPollTimer.current) clearInterval(statsPollTimer.current)
    poorTimer.current = null
    recoveryTimer.current = null
    severeTimer.current = null
    statsPollTimer.current = null
    poorSince.current = null
    consecutiveBadStats.current = 0
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

    /** Shared hysteresis pipeline: both the real ConnectionQualityChanged event and the
     * getStats()-based poller report into this one function, so neither signal needs its own
     * copy of the timer/threshold logic. `source` is only for diagnostic logging. */
    const reportQuality = (quality: ConnectionQuality, source: 'server' | 'stats') => {
      console.debug('[adaptive] quality report', { source, quality })
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

    const handleConnectionQuality = (quality: ConnectionQuality, participant: any) => {
      if (participant !== room.localParticipant) return
      reportQuality(quality, 'server')
    }

    /** Direct measurement of the actual incoming video track's packet loss, independent of the
     * server's own derived quality score. A single bad sample never flips anything — only
     * `statsConsecutiveBadSamples` in a row counts, same "don't trust one sample" rule the
     * server-quality path gets from its own sustained-threshold timer. */
    const pollStats = async () => {
      let sawBadSample = false
      let sawAnySample = false
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.kind !== Track.Kind.Video || !publication.track) continue
          try {
            const report = await publication.track.getRTCStatsReport()
            if (!report) continue
            for (const stat of report.values()) {
              if (stat.type !== 'inbound-rtp') continue
              sawAnySample = true
              const lost = stat.packetsLost ?? 0
              const received = stat.packetsReceived ?? 0
              const total = lost + received
              const lossRatio = total > 0 ? lost / total : 0
              console.debug('[adaptive] video inbound-rtp sample', { bytesReceived: stat.bytesReceived, packetsLost: lost, packetsReceived: received, lossRatio })
              if (lossRatio > statsPacketLossThreshold) sawBadSample = true
            }
          } catch {
            // getStats() can transiently fail mid-renegotiation; treat as "no sample", not "bad".
          }
        }
      }
      if (!sawAnySample) return // nothing to publish yet (no video track subscribed)
      if (sawBadSample) {
        consecutiveBadStats.current += 1
        if (consecutiveBadStats.current >= statsConsecutiveBadSamples) {
          reportQuality(ConnectionQuality.Poor, 'stats')
        }
      } else {
        consecutiveBadStats.current = 0
        // Only a real, authoritative "good": a clean stats sample alone does not cancel a
        // degradation that the server-pushed signal is still reporting — it just stops adding
        // to the bad-sample count, same restraint the "don't flip on one good sample" rule needs.
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
      consecutiveBadStats.current = 0
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
    statsPollTimer.current = setInterval(() => void pollStats(), statsPollIntervalMs)

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
  }, [room, autoAdaptiveEnabled, sustainedThresholdMs, recoveryThresholdMs, statsPollIntervalMs, statsConsecutiveBadSamples, statsPacketLossThreshold, applySubscriptionPolicy])

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
