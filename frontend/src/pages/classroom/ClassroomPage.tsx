import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useTracks,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
  ConnectionStateToast,
} from '@livekit/components-react'
import { Track, ConnectionState, ConnectionQuality } from 'livekit-client'
import {
  Video,
  VideoOff,
  User,
  Users,
  Sparkles,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  AlertTriangle,
  ArrowLeft,
  X,
  Radio,
} from 'lucide-react'
import { api } from '../../services/apiClient'
import { useConnectionRecovery } from '../../hooks/useConnectionRecovery'
import { useNetworkStatus } from '../../context/NetworkContext'
import { diagnoseConnectivity } from '../../services/connectivity'
import { ConnectionLostPanel } from '../../components/class/ConnectionLostPanel'
import { TextFallbackPanel } from '../../components/class/TextFallbackPanel'
import { classService } from '../../services/classService'
import { summaryService } from '../../services/summaryService'
import { useAuth } from '../../context/AuthContext'
import { useAdaptiveAudio } from '../../hooks/useAdaptiveAudio'
import type { ClassRoom, JoinTokenResponse, Summary } from '../../types'
import { ClassroomControls } from '../../components/class/ClassroomControls'
import { SummaryViewer } from '../../components/summary/SummaryViewer'
import { Sheet, Badge, Button, LoadingState, ErrorState } from '../../components/ui'

/**
 * Inner room component that accesses LiveKit context hooks
 */
const ClassroomStage: React.FC<{
  classroom: ClassRoom
  isTeacher: boolean
  onLeave: () => void
  summary: Summary | null
}> = ({ classroom, isTeacher, onLeave, summary }) => {
  const room = useRoomContext()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
  const remoteParticipants = useRemoteParticipants()

  const [isSummaryPanelOpen, setIsSummaryPanelOpen] = useState(false)
  const [connectionStateStr, setConnectionStateStr] = useState<string>('connected')

  // Adaptive Audio-Only controller hook (manages WebRTC video track subscriptions)
  const {
    isAudioOnly,
    isAdaptiveActive,
    toggleAudioOnly,
    severeDegradation,
  } = useAdaptiveAudio({
    room,
    initialAudioOnly: !isTeacher && false,
    autoAdaptiveEnabled: true,
  })

  // Watch room connection state
  useEffect(() => {
    if (!room) return
    const updateState = () => {
      setConnectionStateStr(room.state)
    }
    room.on('connectionStateChanged', updateState)
    updateState()
    return () => {
      room.off('connectionStateChanged', updateState)
    }
  }, [room])

  // A sustained outage offers the offline recovery screen (Downloads stay usable without any server)
  const { recoveryRequired, dismiss } = useConnectionRecovery(connectionStateStr)
  // Three separate signals: the device, the EduVillage API, and the live media connection.
  const { isBrowserOnline, isServerReachable } = useNetworkStatus()
  const diagnosis = diagnoseConnectivity({ browserOnline: isBrowserOnline, apiReachable: isServerReachable, liveKitState: connectionStateStr })

  // Get video tracks from publishers
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  })

  const handleToggleMic = async () => {
    if (localParticipant) {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    }
  }

  const handleToggleCamera = async () => {
    if (localParticipant && isTeacher) {
      await localParticipant.setCameraEnabled(!isCameraEnabled)
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#121A19] text-[#FFFFFF] overflow-hidden">
      {/* Top Header */}
      <div className="bg-[#121A19] border-b border-[#202B2A] h-14 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onLeave}
            className="p-1.5 text-[#84908D] hover:text-[#FFFFFF] rounded-md hover:bg-[#202B2A] cursor-pointer"
            aria-label="Exit classroom"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-bold text-sm sm:text-base text-[#FFFFFF] truncate">
              {classroom.title}
            </h1>
            <p className="text-xs text-[#84908D] truncate">
              {classroom.course_title || 'Live Classroom Session'} • Teacher: {classroom.teacher_name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-[#CBD7D1] bg-[#202B2A] px-2.5 py-1 rounded-full border border-[#374947]">
            <Users className="w-3.5 h-3.5 text-[#FFFFFF]" />
            <span data-testid="participant-count">{remoteParticipants.length + 1}</span>
          </div>

          <Badge variant="live" size="sm">
            LIVE
          </Badge>
        </div>
      </div>

      {/* Severe degradation: even audio-only is unreliable, fall back to text */}
      {severeDegradation && !isTeacher && (
        <div className="bg-[#FDE8E7] border-b border-[#B42318]/30 px-4 py-2 flex items-center gap-2 text-xs text-[#B42318]">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            <strong>Text Fallback Mode:</strong> Your connection can't sustain audio right now. Showing the latest
            lecture summary instead.
          </span>
        </div>
      )}

      {/* Adaptive Audio-Only Banner Notification */}
      {isAudioOnly && !severeDegradation && (
        <div className="bg-[#E8F3FC] border-b border-[#CBD7D1] px-4 py-2 flex items-center justify-between text-xs text-[#2364AA]">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#2364AA] shrink-0" />
            <span>
              <strong>Audio-Only Mode Active:</strong> Incoming video tracks unsubscribed at transport layer to conserve cellular data. Audio remains crystal clear.
            </span>
          </div>
          <button
            type="button"
            onClick={() => toggleAudioOnly(false)}
            className="underline font-semibold hover:text-[#0F5B57] text-xs cursor-pointer ml-3 shrink-0"
          >
            Switch to Video
          </button>
        </div>
      )}

      {/* Main Classroom Stage Area (Media Region + Side Summary Panel on Desktop) */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Media Region */}
        <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-6 bg-[#000000] overflow-y-auto">
          {severeDegradation && !isTeacher ? (
            /* Even audio-only is unreliable: fall back to the latest lecture summary as text. */
            <TextFallbackPanel classId={classroom.id} />
          ) : isAudioOnly ? (
            /* Audio-Only Visualizer Mode */
            <div className="flex flex-col items-center justify-center p-8 max-w-md text-center">
              <div className="w-24 h-24 rounded-full bg-[#121A19] border-2 border-[#374947] flex items-center justify-center text-[#FFFFFF] mb-5 shadow-2xl relative">
                <Volume2 className="w-10 h-10 text-[#2364AA] animate-pulse" />
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#2364AA] border-2 border-[#121A19]" />
              </div>
              <h2 className="text-lg font-bold text-[#FFFFFF] mb-1">
                {classroom.teacher_name || 'Instructor'} Speaking
              </h2>
              <p className="text-xs text-[#84908D] max-w-xs mb-4">
                Adaptive Low-Bandwidth Mode. Live audio playback stream is actively sustained.
              </p>
              <Badge variant="secondary" size="sm" className="font-mono text-xs">
                WebRTC OPUS • ~24 kbps Stream
              </Badge>
            </div>
          ) : tracks.length > 0 ? (
            /* Video Tracks Grid */
            <div className="w-full h-full max-w-5xl flex items-center justify-center">
              <div className="w-full aspect-video max-h-[75vh] bg-[#121A19] rounded-xl overflow-hidden border border-[#202B2A] relative shadow-2xl flex items-center justify-center">
                {tracks[0].publication?.track ? (
                  <VideoTrack trackRef={tracks[0]} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-[#84908D]">
                    <User className="w-16 h-16 mb-2" />
                    <span className="text-sm font-medium">{classroom.teacher_name}</span>
                  </div>
                )}
                <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-xs px-2.5 py-1 rounded text-xs font-semibold text-white">
                  {classroom.teacher_name} (Presenter)
                </div>
              </div>
            </div>
          ) : (
            /* Waiting for presenter stream */
            <div className="flex flex-col items-center justify-center text-center p-6">
              <div className="w-16 h-16 rounded-full bg-[#121A19] border border-[#202B2A] flex items-center justify-center mb-3 text-[#84908D]">
                <Video className="w-8 h-8 text-[#0F5B57]" />
              </div>
              <h3 className="font-semibold text-base text-[#FFFFFF] mb-1">Waiting for Video Stream</h3>
              <p className="text-xs text-[#84908D] max-w-sm mb-4">
                Connected to room {classroom.livekit_room_name}. Media will stream when instructor starts video.
              </p>
              {isTeacher && (
                <Button size="sm" variant="primary" onClick={handleToggleCamera}>
                  Start Presenter Camera
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Desktop Side Summary Panel (Does not disconnect active call!) */}
        {isSummaryPanelOpen && (
          <aside className="hidden lg:flex flex-col w-96 bg-[#FFFFFF] text-[#202B2A] border-l border-[#E1E8E4] shrink-0 h-full overflow-hidden">
            <div className="p-4 border-b border-[#E1E8E4] flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm text-[#202B2A]">
                <Sparkles className="w-4 h-4 text-[#0F5B57]" />
                <span>Live Lecture Notes</span>
              </div>
              <button
                type="button"
                onClick={() => setIsSummaryPanelOpen(false)}
                className="p-1 text-[#687775] hover:text-[#0F5B57] rounded cursor-pointer"
                aria-label="Close notes"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {summary ? (
                <SummaryViewer summary={summary} isCompact={true} isTeacher={isTeacher} />
              ) : (
                <div className="text-center py-12 text-[#687775] text-xs">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 text-[#0F5B57]" />
                  Lecture notes and AI key concepts will be synthesized as the class concludes.
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Mobile Bottom Sheet for Lecture Summary (Does not disconnect active call!) */}
      <Sheet
        isOpen={isSummaryPanelOpen}
        onClose={() => setIsSummaryPanelOpen(false)}
        title="Live Lecture Notes & Revision"
        position="bottom"
      >
        <div className="text-left text-[#202B2A]">
          {summary ? (
            <SummaryViewer summary={summary} isCompact={true} isTeacher={isTeacher} />
          ) : (
            <div className="text-center py-8 text-[#687775] text-xs">
              <Sparkles className="w-8 h-8 mx-auto mb-2 text-[#0F5B57]" />
              Lecture summary will appear here once audio analysis completes.
            </div>
          )}
        </div>
      </Sheet>

      {/* Bottom Control Bar */}
      <ClassroomControls
        isMicEnabled={Boolean(isMicrophoneEnabled)}
        onToggleMic={handleToggleMic}
        isCameraEnabled={Boolean(isCameraEnabled)}
        onToggleCamera={handleToggleCamera}
        canPublishVideo={isTeacher}
        isAudioOnly={isAudioOnly}
        onToggleAudioOnly={() => toggleAudioOnly()}
        isAdaptiveActive={isAdaptiveActive}
        onToggleSummary={() => setIsSummaryPanelOpen(!isSummaryPanelOpen)}
        isSummaryOpen={isSummaryPanelOpen}
        onLeave={onLeave}
        connectionState={connectionStateStr}
      />

      {/* Audio Renderer for WebRTC audio playback */}
      <RoomAudioRenderer />

      {recoveryRequired && (
        <ConnectionLostPanel
          showDownloads={!isTeacher}
          headline={diagnosis.headline}
          guidance={diagnosis.guidance}
          onKeepWaiting={dismiss}
          onLeave={onLeave}
        />
      )}
    </div>
  )
}

/**
 * Recording notice for everyone, plus start/stop for teachers. Recording is always an explicit
 * teacher action; a recording stays private until the teacher publishes it from Recorded Lessons.
 */
const RecordingBar: React.FC<{ classId: string; isTeacher: boolean; initiallyRecording: boolean }> = ({
  classId,
  isTeacher,
  initiallyRecording,
}) => {
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(initiallyRecording)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    // A teacher who reloads mid-recording needs the active recording's id to be able to stop it.
    if (!isTeacher || !initiallyRecording) return
    api
      .getClassRecordings(classId)
      .then((list) => setRecordingId(list.find((r) => r.status === 'recording')?.id ?? null))
      .catch(() => {})
  }, [classId, isTeacher, initiallyRecording])

  const toggle = async () => {
    setBusy(true)
    setMessage(null)
    try {
      if (isRecording && recordingId) {
        await api.stopRecording(classId, recordingId)
        setIsRecording(false)
        setMessage('Recording stopped. It is being processed and will stay private until you publish it.')
      } else {
        const rec = await api.startRecording(classId)
        setRecordingId(rec.id)
        setIsRecording(true)
      }
    } catch (err: any) {
      setMessage(err.message || 'Could not change the recording state.')
    } finally {
      setBusy(false)
    }
  }

  if (!isTeacher && !isRecording) return null
  return (
    <div className="bg-[#121A19] text-[#FFFFFF] text-xs px-4 py-2 flex items-center justify-between gap-3 border-b border-[#202B2A]" role="status">
      <span>
        {isRecording
          ? 'This session is being recorded, and the audio may be transcribed for lecture summaries.'
          : (message ?? 'This session is not being recorded.')}
      </span>
      {isTeacher && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy || (isRecording && !recordingId)}
          className="px-3 py-1.5 rounded-md bg-[#202B2A] hover:bg-[#374947] disabled:opacity-50 cursor-pointer"
        >
          {isRecording ? 'Stop recording' : 'Start recording'}
        </button>
      )}
    </div>
  )
}

/**
 * Main Classroom Page with token authorization flow
 */
export const ClassroomPage: React.FC = () => {
  const { classId } = useParams<{ classId: string }>()
  const { user, isTeacher } = useAuth()
  const navigate = useNavigate()

  const [classroom, setClassroom] = useState<ClassRoom | null>(null)
  const [joinData, setJoinData] = useState<JoinTokenResponse | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function initClassroom() {
      if (!classId) return
      setIsLoading(true)
      setError(null)

      try {
        // 1. Fetch class details
        const cls = await classService.getClassById(classId)
        if (!isMounted) return
        setClassroom(cls)

        // 2. Fetch LiveKit Join Token issued by FastAPI backend
        const tokenRes = await classService.getJoinToken(classId)
        if (!isMounted) return
        setJoinData(tokenRes)

        // 3. Fetch summary if exists
        try {
          const sum = await summaryService.getClassSummary(classId)
          if (isMounted) setSummary(sum)
        } catch {
          // Summary might not exist yet
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Failed to authenticate and join classroom')
        }
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    initClassroom()
    return () => {
      isMounted = false
    }
  }, [classId])

  const handleLeave = () => {
    navigate(isTeacher ? '/teacher/classes' : '/student/classes')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#121A19] flex items-center justify-center text-white">
        <LoadingState message="Verifying class credentials and requesting LiveKit token from server..." />
      </div>
    )
  }

  if (error || !classroom || !joinData) {
    return (
      <div className="min-h-screen bg-[#121A19] flex items-center justify-center p-4">
        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 max-w-md w-full text-center shadow-lg">
          <AlertTriangle className="w-10 h-10 text-[#B42318] mx-auto mb-3" />
          <h2 className="text-base font-bold text-[#202B2A] mb-2">Classroom Access Denied</h2>
          <p className="text-xs text-[#687775] mb-6">{error || 'Unable to authorize room token'}</p>
          <Button variant="secondary" onClick={handleLeave}>
            Return to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#000000] overflow-hidden select-none">
      <RecordingBar classId={classroom.id} isTeacher={Boolean(isTeacher)} initiallyRecording={joinData.recording_active} />
      <LiveKitRoom
        serverUrl={joinData.url}
        token={joinData.token}
        connect={true}
        video={joinData.is_publisher}
        audio={true}
        className="flex-1 flex flex-col h-full overflow-hidden"
      >
        <ClassroomStage
          classroom={classroom}
          isTeacher={Boolean(isTeacher)}
          onLeave={handleLeave}
          summary={summary}
        />
      </LiveKitRoom>
    </div>
  )
}
