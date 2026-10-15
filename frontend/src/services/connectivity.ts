/**
 * Three different questions, three different signals - never collapsed into one boolean:
 *   1. Is the device online at all?            -> the browser's online/offline events
 *   2. Can we reach the EduVillage API?        -> the /health heartbeat (NetworkContext)
 *   3. Is the live media connection healthy?   -> LiveKit's own connection state
 * A browser can report "online" while WebRTC is broken, and the media can stay healthy while the API
 * heartbeat fails, so each combination gets its own, accurate guidance.
 */

export type LiveKitState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | string

export interface ConnectivitySignals {
  browserOnline: boolean
  apiReachable: boolean
  liveKitState: LiveKitState
}

export type ConnectivityCause =
  | 'ok'
  | 'api_down_media_ok' // class continues; server-backed actions (submit, join other rooms) are unavailable
  | 'reconnecting' // brief drop, LiveKit is retrying on its own
  | 'device_offline' // the device has no network
  | 'network_unstable' // device says online, but neither the API nor the media server can be reached
  | 'media_unreachable' // device and API are fine; only the live media connection is down

export interface ConnectivityDiagnosis {
  cause: ConnectivityCause
  headline: string
  guidance: string
  /** Whether trying to rejoin the live class could work right now. */
  canRejoinLive: boolean
}

export function diagnoseConnectivity({ browserOnline, apiReachable, liveKitState }: ConnectivitySignals): ConnectivityDiagnosis {
  const mediaUp = liveKitState === 'connected'
  const mediaRetrying = liveKitState === 'reconnecting' || liveKitState === 'connecting'

  if (mediaUp) {
    if (!browserOnline || !apiReachable) {
      return {
        cause: 'api_down_media_ok',
        headline: 'You are still in the class',
        guidance:
          'The live audio and video are working, but EduVillage cannot be reached right now. Submitting work and loading new pages will wait until it is back.',
        canRejoinLive: true,
      }
    }
    return { cause: 'ok', headline: '', guidance: '', canRejoinLive: true }
  }

  if (!browserOnline) {
    return {
      cause: 'device_offline',
      headline: 'Your device is offline',
      guidance:
        'This device has no internet connection. Check your Wi-Fi or mobile data. The class will reconnect on its own when the connection returns; meanwhile your downloaded lectures, audio, notes and summaries still work.',
      canRejoinLive: false,
    }
  }

  if (mediaRetrying) {
    return {
      cause: 'reconnecting',
      headline: 'Reconnecting to the class',
      guidance: 'The connection dropped for a moment. Trying to reconnect automatically.',
      canRejoinLive: false,
    }
  }

  if (!apiReachable) {
    return {
      cause: 'network_unstable',
      headline: 'Your connection is too weak',
      guidance:
        'Your device reports being online, but neither the live class nor EduVillage can be reached. The signal may be very weak or blocked. Moving to a better spot may help; your downloaded lessons still work.',
      canRejoinLive: false,
    }
  }

  return {
    cause: 'media_unreachable',
    headline: 'The live class connection was lost',
    guidance:
      'Your internet and EduVillage are working, but the live video server cannot be reached. This is usually temporary. You can wait, or study your downloaded lessons and rejoin later.',
    canRejoinLive: true,
  }
}
