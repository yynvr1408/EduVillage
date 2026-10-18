import React, { useState } from 'react'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Sparkles,
  PhoneOff,
  Radio,
  Wifi,
  MonitorUp,
  PencilLine,
  Droplet,
  Hand,
  SignalLow,
  Wrench,
  Check,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

export interface ClassroomControlsProps {
  isMicEnabled: boolean
  onToggleMic: () => void
  isCameraEnabled: boolean
  onToggleCamera: () => void
  canPublishVideo: boolean
  /** Whether the local participant currently has a real publish grant for mic audio
   * (always true for the teacher; true for a student only once the teacher grants it). */
  canPublishAudio: boolean
  /** Student only: the "raise hand" control shown in place of the mic toggle until granted. */
  speakToTeacher?: {
    status: 'idle' | 'requested'
    onRequest: () => void
  }
  isAudioOnly: boolean
  onToggleAudioOnly: () => void
  isAdaptiveActive: boolean
  onToggleSummary: () => void
  isSummaryOpen: boolean
  onLeave: () => void
  connectionState: string
  /** Teacher only: screen sharing, whiteboard and background blur. */
  teacherTools?: {
    canShareScreen: boolean
    isSharingScreen: boolean
    onAddScreen: () => void
    isBoardOpen: boolean
    onToggleBoard: () => void
    blurOn: boolean
    blurSupported: boolean
    onToggleBlur: () => void
    /** Caps the teacher's own camera upload to a much lower resolution/bitrate - for when the
     * teacher's own connection, not a student's, is the weak link. */
    lowBandwidthOn: boolean
    onToggleLowBandwidth: () => void
    notice?: string | null
  }
}

export const ClassroomControls: React.FC<ClassroomControlsProps> = ({
  isMicEnabled,
  onToggleMic,
  isCameraEnabled,
  onToggleCamera,
  canPublishVideo,
  canPublishAudio,
  speakToTeacher,
  isAudioOnly,
  onToggleAudioOnly,
  isAdaptiveActive,
  onToggleSummary,
  isSummaryOpen,
  onLeave,
  connectionState,
  teacherTools,
}) => {
  const [toolsOpen, setToolsOpen] = useState(false)
  const anyToolActive = Boolean(
    teacherTools && (teacherTools.isSharingScreen || teacherTools.isBoardOpen || teacherTools.blurOn || teacherTools.lowBandwidthOn)
  )

  return (
    <div className="bg-[#121A19] text-[#FFFFFF] border-t border-[#202B2A] p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 safe-bottom">
      {/* Left: Connection State & Mode Badges */}
      <div className="flex items-center gap-2">
        <Badge
          variant={
            connectionState === 'connected'
              ? 'success'
              : connectionState === 'reconnecting'
              ? 'warning'
              : 'error'
          }
          size="sm"
        >
          {connectionState.toUpperCase()}
        </Badge>

        {isAudioOnly && (
          <Badge variant={isAdaptiveActive ? 'warning' : 'info'} size="sm">
            <Radio className="w-3 h-3 mr-1 text-[#2364AA]" />
            {isAdaptiveActive ? 'Adaptive Audio-Only' : 'Manual Audio-Only'}
          </Badge>
        )}
      </div>

      {/* Center: Core Controls (Mic, Camera, Audio-Only, Summary) */}
      <div className="flex items-center gap-2 sm:gap-3 mx-auto">
        {/* Mic Control (only rendered when there is a real publish grant to back it) */}
        {canPublishAudio ? (
          <button
            type="button"
            onClick={onToggleMic}
            className={`p-3 rounded-full transition-colors touch-target flex items-center justify-center cursor-pointer ${
              isMicEnabled
                ? 'bg-[#202B2A] hover:bg-[#374947] text-[#FFFFFF]'
                : 'bg-[#B42318] text-[#FFFFFF] hover:bg-[#911C13]'
            }`}
            title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
            aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            {isMicEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
        ) : (
          speakToTeacher && (
            <button
              type="button"
              onClick={speakToTeacher.onRequest}
              disabled={speakToTeacher.status === 'requested'}
              className={`px-3 py-2 sm:px-4 rounded-full text-xs font-semibold flex items-center gap-1.5 touch-target transition-colors border ${
                speakToTeacher.status === 'requested'
                  ? 'bg-[#2364AA] text-[#FFFFFF] border-[#2364AA] cursor-default opacity-80'
                  : 'bg-[#202B2A] text-[#FFFFFF] border-[#374947] hover:bg-[#374947] cursor-pointer'
              }`}
              title={speakToTeacher.status === 'requested' ? 'Your teacher has been notified' : 'Ask your teacher for permission to speak'}
              aria-label="Request to speak"
            >
              <Hand className="w-4 h-4" />
              <span className="hidden sm:inline">{speakToTeacher.status === 'requested' ? 'Request Sent' : 'Request to Speak'}</span>
            </button>
          )
        )}

        {/* Camera Control (Publisher only) */}
        {canPublishVideo && (
          <button
            type="button"
            onClick={onToggleCamera}
            className={`p-3 rounded-full transition-colors touch-target flex items-center justify-center cursor-pointer ${
              isCameraEnabled
                ? 'bg-[#202B2A] hover:bg-[#374947] text-[#FFFFFF]'
                : 'bg-[#B42318] text-[#FFFFFF] hover:bg-[#911C13]'
            }`}
            title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {isCameraEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>
        )}

        {/* Audio-Only Mode Toggle (Stops video packets to conserve low bandwidth). Student-only:
            it unsubscribes from a REMOTE participant's video, and a teacher never subscribes to
            one in this app's model, so showing it to the teacher would just be a dead button. */}
        {!teacherTools && (
          <button
            type="button"
            onClick={onToggleAudioOnly}
            className={`px-3 py-2 sm:px-4 rounded-full text-xs font-semibold flex items-center gap-1.5 touch-target transition-colors cursor-pointer border ${
              isAudioOnly
                ? 'bg-[#2364AA] text-[#FFFFFF] border-[#2364AA]'
                : 'bg-[#202B2A] text-[#FFFFFF] border-[#374947] hover:bg-[#374947]'
            }`}
            title="Toggle Audio-Only mode to conserve bandwidth"
            aria-label="Toggle Audio-Only mode"
          >
            {isAudioOnly ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">
              {isAudioOnly ? 'Audio Only (Active)' : 'Save Data'}
            </span>
          </button>
        )}

        {/* Teacher-only presentation tools, grouped behind one "Tools" button instead of four
            separate pills always on screen - the live class view already competes for space with
            the stage, roster, notes and speak-request banners. */}
        {teacherTools && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={toolsOpen}
              aria-haspopup="true"
              className={`px-3 py-2 sm:px-4 rounded-full text-xs font-semibold flex items-center gap-1.5 touch-target transition-colors cursor-pointer border ${
                toolsOpen || anyToolActive
                  ? 'bg-[#0F5B57] text-[#FFFFFF] border-[#0F5B57]'
                  : 'bg-[#202B2A] text-[#FFFFFF] border-[#374947] hover:bg-[#374947]'
              }`}
              title="Presentation tools: screen share, whiteboard, blur, low bandwidth"
              aria-label="Tools"
            >
              <Wrench className="w-4 h-4" />
              <span className="hidden sm:inline">Tools</span>
              {anyToolActive && <span className="w-1.5 h-1.5 rounded-full bg-[#F2A516]" aria-hidden="true" data-testid="tools-active-indicator" />}
            </button>

            {toolsOpen && (
              <>
                {/* Click-outside-to-close backdrop. */}
                <div className="fixed inset-0 z-40" data-testid="tools-menu-backdrop" onClick={() => setToolsOpen(false)} />
                <div
                  role="group"
                  aria-label="Presentation tools"
                  className="absolute bottom-full left-0 mb-2 z-50 w-60 bg-[#202B2A] border border-[#374947] rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5"
                >
                  <button
                    type="button"
                    onClick={teacherTools.onAddScreen}
                    disabled={!teacherTools.canShareScreen}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${
                      teacherTools.canShareScreen ? 'cursor-pointer hover:bg-[#2B3A38] text-[#FFFFFF]' : 'opacity-50 cursor-not-allowed text-[#687775]'
                    }`}
                    title={teacherTools.canShareScreen ? undefined : 'Screen sharing is not supported on this device'}
                  >
                    <MonitorUp className="w-4 h-4 shrink-0" />
                    <span className="flex-1">{teacherTools.isSharingScreen ? 'Add another screen' : 'Share screen'}</span>
                    {teacherTools.isSharingScreen && <Check className="w-4 h-4 text-[#2DBE8B] shrink-0" />}
                  </button>
                  <button
                    type="button"
                    onClick={teacherTools.onToggleBoard}
                    aria-pressed={teacherTools.isBoardOpen}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors cursor-pointer hover:bg-[#2B3A38] text-[#FFFFFF]"
                  >
                    <PencilLine className="w-4 h-4 shrink-0" />
                    <span className="flex-1">Whiteboard</span>
                    {teacherTools.isBoardOpen && <Check className="w-4 h-4 text-[#2DBE8B] shrink-0" />}
                  </button>
                  <button
                    type="button"
                    onClick={teacherTools.onToggleBlur}
                    disabled={!teacherTools.blurSupported}
                    aria-pressed={teacherTools.blurOn}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${
                      teacherTools.blurSupported ? 'cursor-pointer hover:bg-[#2B3A38] text-[#FFFFFF]' : 'opacity-50 cursor-not-allowed text-[#687775]'
                    }`}
                    title={teacherTools.blurSupported ? undefined : 'Background blur is not supported in this browser'}
                  >
                    <Droplet className="w-4 h-4 shrink-0" />
                    <span className="flex-1">Blur my background</span>
                    {teacherTools.blurOn && <Check className="w-4 h-4 text-[#2DBE8B] shrink-0" />}
                  </button>
                  <button
                    type="button"
                    onClick={teacherTools.onToggleLowBandwidth}
                    aria-pressed={teacherTools.lowBandwidthOn}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors cursor-pointer hover:bg-[#2B3A38] text-[#FFFFFF]"
                    title="Lower your own camera resolution and bitrate - for when your connection, not a student's, is weak"
                  >
                    <SignalLow className="w-4 h-4 shrink-0" />
                    <span className="flex-1">Low bandwidth broadcast</span>
                    {teacherTools.lowBandwidthOn && <Check className="w-4 h-4 text-[#2DBE8B] shrink-0" />}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Summary side panel toggle */}
        <button
          type="button"
          onClick={onToggleSummary}
          className={`px-3 py-2 sm:px-4 rounded-full text-xs font-semibold flex items-center gap-1.5 touch-target transition-colors cursor-pointer border ${
            isSummaryOpen
              ? 'bg-[#0F5B57] text-[#FFFFFF] border-[#0F5B57]'
              : 'bg-[#202B2A] text-[#FFFFFF] border-[#374947] hover:bg-[#374947]'
          }`}
          title="Open AI Lecture Summary Notes"
          aria-label="Open AI Lecture Summary Notes"
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline">Notes</span>
        </button>
      </div>

      {/* Right: Leave Room Action */}
      <div>
        <Button
          variant="destructive"
          size="sm"
          onClick={onLeave}
          icon={<PhoneOff className="w-4 h-4" />}
        >
          Leave Class
        </Button>
      </div>
    </div>
  )
}
