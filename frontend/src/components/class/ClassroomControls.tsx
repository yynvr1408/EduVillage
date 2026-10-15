import React from 'react'
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
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

export interface ClassroomControlsProps {
  isMicEnabled: boolean
  onToggleMic: () => void
  isCameraEnabled: boolean
  onToggleCamera: () => void
  canPublishVideo: boolean
  isAudioOnly: boolean
  onToggleAudioOnly: () => void
  isAdaptiveActive: boolean
  onToggleSummary: () => void
  isSummaryOpen: boolean
  onLeave: () => void
  connectionState: string
}

export const ClassroomControls: React.FC<ClassroomControlsProps> = ({
  isMicEnabled,
  onToggleMic,
  isCameraEnabled,
  onToggleCamera,
  canPublishVideo,
  isAudioOnly,
  onToggleAudioOnly,
  isAdaptiveActive,
  onToggleSummary,
  isSummaryOpen,
  onLeave,
  connectionState,
}) => {
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
        {/* Mic Control */}
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

        {/* Audio-Only Mode Toggle (Stops video packets to conserve low bandwidth) */}
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
