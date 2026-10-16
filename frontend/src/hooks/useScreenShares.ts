import { useCallback, useEffect, useState } from 'react'
import { LocalVideoTrack, RoomEvent, Track, type Participant, type Room, type TrackPublication } from 'livekit-client'

export interface ScreenShare {
  key: string
  participant: Participant
  publication: TrackPublication
  name: string
  isLocal: boolean
}

/**
 * Every screen being shared in the room (the teacher may share several screens or windows at once), plus a count of
 * shares that exist but are not being received (audio-only mode unsubscribes video to save data).
 */
export function useScreenShares(room: Room | undefined) {
  const [shares, setShares] = useState<ScreenShare[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!room) return
    const recompute = () => {
      const list: ScreenShare[] = []
      let hidden = 0
      const participants: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())]
      for (const p of participants) {
        for (const pub of p.trackPublications.values()) {
          if (pub.kind !== Track.Kind.Video || pub.source !== Track.Source.ScreenShare) continue
          if (p.isLocal || (pub.isSubscribed && pub.track)) {
            list.push({ key: pub.trackSid, participant: p, publication: pub, name: pub.trackName || 'Screen', isLocal: p.isLocal })
          } else {
            hidden += 1
          }
        }
      }
      setShares(list)
      setHiddenCount(hidden)
    }
    const events = [
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
    ] as const
    events.forEach((e) => room.on(e as any, recompute))
    recompute()
    return () => {
      events.forEach((e) => room.off(e as any, recompute))
    }
  }, [room])

  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)

  /** Teacher: share another screen or window (the browser asks which one). Repeat to share several. */
  const addScreen = useCallback(async () => {
    if (!room || !supported) return
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    } catch (err: any) {
      // The teacher closing the picker is normal, not an error.
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') setError('Could not start screen sharing on this device.')
      return
    }
    const mediaTrack = stream.getVideoTracks()[0]
    if (!mediaTrack) return
    const count = Array.from(room.localParticipant.trackPublications.values()).filter((p) => p.source === Track.Source.ScreenShare).length
    const track = new LocalVideoTrack(mediaTrack, undefined, true)
    try {
      await room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShare, name: `Screen ${count + 1}`, simulcast: false })
    } catch {
      track.stop()
      setError('Could not share that screen with the class.')
      return
    }
    // The browser's own "Stop sharing" button ends the track: take it out of the room too.
    mediaTrack.addEventListener('ended', () => {
      room.localParticipant.unpublishTrack(track, true).catch(() => undefined)
    })
  }, [room, supported])

  const stopShare = useCallback(
    async (share: ScreenShare) => {
      if (!room || !share.isLocal || !share.publication.track) return
      await room.localParticipant.unpublishTrack(share.publication.track as LocalVideoTrack, true)
    },
    [room],
  )

  return { shares, hiddenCount, addScreen, stopShare, supported, error }
}
