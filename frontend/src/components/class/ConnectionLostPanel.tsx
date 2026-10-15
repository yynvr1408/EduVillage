import React from 'react'
import { Link } from 'react-router-dom'
import { WifiOff } from 'lucide-react'
import { Button } from '../ui/Button'

export interface ConnectionLostPanelProps {
  /** Students get the Downloads shortcut; teachers can only wait or leave. */
  showDownloads: boolean
  onKeepWaiting: () => void
  onLeave: () => void
}

/**
 * Shown when the live class connection has been down for a sustained period. It makes no claim
 * that the student is still in the class, and its Downloads link is a plain client-side route, so
 * it works with the network and the backend completely unavailable.
 */
export const ConnectionLostPanel: React.FC<ConnectionLostPanelProps> = ({ showDownloads, onKeepWaiting, onLeave }) => (
  <div
    role="alertdialog"
    aria-labelledby="connection-lost-title"
    className="fixed inset-0 z-50 bg-[#121A19]/95 flex items-center justify-center p-6 text-white"
  >
    <div className="max-w-sm w-full text-center flex flex-col items-center gap-3">
      <WifiOff className="w-10 h-10 text-[#84908D]" />
      <h2 id="connection-lost-title" className="text-lg font-bold">
        You are not connected to the live class
      </h2>
      <p className="text-xs text-[#C9D3D0] leading-relaxed">
        {showDownloads
          ? 'We could not restore the connection. While you wait, your downloaded lectures, audio, notes and summaries are still available on this device.'
          : 'We could not restore the connection. You will rejoin automatically if it comes back.'}
      </p>
      <div className="flex flex-col sm:flex-row gap-2 w-full mt-2">
        {showDownloads && (
          <Link to="/student/downloads" className="flex-1">
            <Button variant="primary" fullWidth>
              Go to Downloads
            </Button>
          </Link>
        )}
        <Button variant="secondary" className="flex-1" onClick={onKeepWaiting}>
          Keep waiting
        </Button>
        <Button variant="outline" className="flex-1" onClick={onLeave}>
          Leave class
        </Button>
      </div>
    </div>
  </div>
)
