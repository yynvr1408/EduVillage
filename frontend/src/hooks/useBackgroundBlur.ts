import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, Track, type LocalVideoTrack, type Room } from 'livekit-client'

/**
 * Blurs the teacher's background before the video is sent, so students receive an already-blurred picture.
 * The person-segmentation model is loaded from a CDN the first time (needs internet) and the heavy library is only
 * loaded when the teacher has a camera on. If the browser cannot do it, the video simply stays unblurred.
 */
export function useBackgroundBlur(room: Room | undefined, cameraOn: boolean, wanted: boolean) {
  const [active, setActive] = useState(false)
  const [supported, setSupported] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const processorRef = useRef<any>(null)
  const appliedTo = useRef<string | null>(null)
  const running = useRef<Promise<void> | null>(null)
  const rerun = useRef(false)

  const applyOnce = useCallback(async () => {
    if (!room) return
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera)
    const track = pub?.track as LocalVideoTrack | undefined
    if (!track) {
      appliedTo.current = null
      setActive(false)
      return
    }
    try {
      if (wanted) {
        if (appliedTo.current === track.sid) return
        const lib = await import('@livekit/track-processors')
        if (!lib.supportsBackgroundProcessors()) {
          setSupported(false)
          setActive(false)
          return
        }
        processorRef.current = processorRef.current ?? lib.BackgroundProcessor({ mode: 'background-blur', blurRadius: 12 })
        await track.setProcessor(processorRef.current)
        appliedTo.current = track.sid ?? null
        setActive(true)
        setError(null)
      } else if (appliedTo.current) {
        await track.stopProcessor()
        appliedTo.current = null
        setActive(false)
      }
    } catch {
      appliedTo.current = null
      setActive(false)
      setError('Background blur could not start on this device; your video is sent as normal.')
    }
  }, [room, wanted])

  /** Runs one apply at a time; a request that arrives meanwhile is re-run afterwards (events can fire together). */
  const apply = useCallback(async () => {
    if (running.current) {
      rerun.current = true
      return
    }
    do {
      rerun.current = false
      running.current = applyOnce()
      await running.current
      running.current = null
    } while (rerun.current)
  }, [applyOnce])

  useEffect(() => {
    void apply()
  }, [apply, cameraOn])

  // A re-published camera is a new track: blur it again.
  useEffect(() => {
    if (!room) return
    const handler = () => void apply()
    room.on(RoomEvent.LocalTrackPublished, handler)
    return () => {
      room.off(RoomEvent.LocalTrackPublished, handler)
    }
  }, [room, apply])

  return { active, supported, error }
}
