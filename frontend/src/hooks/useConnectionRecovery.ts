import { useCallback, useEffect, useRef, useState } from 'react'

export interface ConnectionRecoveryOptions {
  /** How long the live connection may stay down before recovery options are offered. */
  graceMs?: number
  /** Browser online flag; a dropped link shortens nothing but is surfaced to callers separately. */
}

/**
 * Decides when a live class connection is "lost for good enough" to offer the student the offline
 * recovery screen. Brief drops and LiveKit's own reconnection stay invisible; only a sustained
 * outage (default 20 s) triggers it, and it clears itself the moment the connection returns.
 * `dismissed` lets the student choose to keep waiting without the panel reappearing until the
 * next outage.
 */
export function useConnectionRecovery(connectionState: string, { graceMs = 20_000 }: ConnectionRecoveryOptions = {}) {
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (connectionState === 'connected') {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      setRecoveryRequired(false)
      setDismissed(false)
      return
    }
    if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null
        setRecoveryRequired(true)
      }, graceMs)
    }
  }, [connectionState, graceMs])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const dismiss = useCallback(() => setDismissed(true), [])

  return { recoveryRequired: recoveryRequired && !dismissed, dismiss }
}
