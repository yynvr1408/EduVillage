import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Reads text aloud using the browser's own built-in SpeechSynthesis API — zero server cost, zero
 * bandwidth, and works even once the connection is too weak for audio/video (it's local to the
 * device, not a network call). Used to read the cached lecture summary aloud when a student's
 * connection has dropped to the text fallback, and as an accessibility aid everywhere else a
 * summary is shown.
 *
 * Reads the API off the bare global (`speechSynthesis`, not `window.speechSynthesis`) — that's
 * the ambient form the spec itself exposes, and the one a stubbed-global test double reliably
 * replaces.
 */
export function useReadAloud() {
  const [isReading, setIsReading] = useState(false)
  const supportedRef = useRef(typeof speechSynthesis !== 'undefined')
  const supported = supportedRef.current

  const stop = useCallback(() => {
    if (!supported) return
    speechSynthesis.cancel()
    setIsReading(false)
  }, [supported])

  const read = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return
      speechSynthesis.cancel() // only one utterance plays at a time
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.onend = () => setIsReading(false)
      utterance.onerror = () => setIsReading(false)
      speechSynthesis.speak(utterance)
      setIsReading(true)
    },
    [supported]
  )

  // Never keep talking after the component that started it is gone. Checked fresh (not from the
  // cached `supported` flag) since this runs during teardown, after anything else might have run.
  useEffect(() => {
    return () => {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    }
  }, [])

  return { supported, isReading, read, stop }
}
