import React, { useState, useEffect, useRef, useCallback } from 'react'
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
import { Track, ConnectionState, ConnectionQuality, RoomEvent } from 'livekit-client'
import {
  Video,
  VideoOff,
  User,
  Users,
  UserMinus,
  Sparkles,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  AlertTriangle,
  ArrowLeft,
  X,
  Radio,
  Mic,
  MicOff,
  Droplet,
  LayoutGrid,
  PencilLine,
  Monitor,
  Hand,
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
import type { ClassParticipant, ClassRoom, JoinTokenResponse, Summary } from '../../types'
import { ClassroomControls } from '../../components/class/ClassroomControls'
import { FloatingVideo, type FloatSize } from '../../components/class/FloatingVideo'
import { Whiteboard } from '../../components/class/whiteboard/Whiteboard'
import { useWhiteboard } from '../../components/class/whiteboard/useWhiteboard'
import { useScreenShares } from '../../hooks/useScreenShares'
import { useBackgroundBlur } from '../../hooks/useBackgroundBlur'
import { SummaryViewer } from '../../components/summary/SummaryViewer'
import { Sheet, Badge, Button, LoadingState, ErrorState } from '../../components/ui'

/**
 * Teacher-only roster: who has joined, their name/email, and a way to remove a student
 * from the live session. Students never see this (it's never fetched for them).
 */
export const ParticipantsPanel: React.FC<{
  participants: ClassParticipant[]
  isLoading: boolean
  removingUserId: string | null
  micActionUserId: string | null
  errorMessage: string | null
  onRemove: (p: ClassParticipant) => void
  onGrantMic: (p: ClassParticipant) => void
  onRevokeMic: (p: ClassParticipant) => void
}> = ({ participants, isLoading, removingUserId, micActionUserId, errorMessage, onRemove, onGrantMic, onRevokeMic }) => {
  if (isLoading && participants.length === 0) {
    return <div className="text-center py-12 text-[#687775] text-xs">Loading participants...</div>
  }
  if (participants.length === 0) {
    return <div className="text-center py-12 text-[#687775] text-xs">No one has joined yet.</div>
  }
  return (
    <div className="space-y-2">
      {errorMessage && <p className="text-xs text-[#B42318] mb-2">{errorMessage}</p>}
      {participants.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-[#E1E8E4] bg-[#F8FAF7]"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#202B2A] truncate">{p.full_name}</p>
            <p className="text-xs text-[#687775] truncate">{p.email}</p>
            {p.status === 'JOINED' && p.speak_requested_at && !p.mic_granted && (
              <p className="text-xs text-[#2364AA] font-semibold flex items-center gap-1 mt-0.5">
                <Hand className="w-3 h-3" /> Wants to speak
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={p.status === 'JOINED' ? 'success' : p.status === 'REMOVED' ? 'error' : 'secondary'} size="sm">
              {p.status}
            </Badge>
            {p.status === 'JOINED' && (
              <button
                type="button"
                onClick={() => (p.mic_granted ? onRevokeMic(p) : onGrantMic(p))}
                disabled={micActionUserId === p.user_id}
                className={`p-1.5 rounded-md disabled:opacity-50 cursor-pointer ${
                  p.mic_granted ? 'text-[#0F5B57] hover:bg-[#E3F2EF]' : 'text-[#687775] hover:bg-[#E1E8E4]'
                }`}
                aria-label={p.mic_granted ? `Mute ${p.full_name}` : `Allow ${p.full_name} to speak`}
                title={p.mic_granted ? 'Revoke microphone permission' : 'Allow this student to speak'}
              >
                {p.mic_granted ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>
            )}
            {p.status === 'JOINED' && (
              <button
                type="button"
                onClick={() => onRemove(p)}
                disabled={removingUserId === p.user_id}
                className="p-1.5 text-[#B42318] hover:bg-[#FDE8E7] rounded-md disabled:opacity-50 cursor-pointer"
                aria-label={`Remove ${p.full_name}`}
                title="Remove from class"
              >
                <UserMinus className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Inner room component that accesses LiveKit context hooks
 */
const ClassroomStage: React.FC<{
  classroom: ClassRoom
  isTeacher: boolean
  onLeave: () => void
  summary: Summary | null
  /** Fetches a fresh join-token and hands it to LiveKitRoom, so a sustained outage caused by a
   * genuinely rejected/expired token (not just a brief network blip, which LiveKit's own
   * reconnect already handles) can actually recover instead of retrying with the same bad token
   * forever. */
  onNeedFreshToken: () => void
}> = ({ classroom, isTeacher, onLeave, summary, onNeedFreshToken }) => {
  const room = useRoomContext()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
  const remoteParticipants = useRemoteParticipants()

  const [isSummaryPanelOpen, setIsSummaryPanelOpen] = useState(false)
  const [wantBlur, setWantBlur] = useState(true) // teacher's video is blurred by default
  const [floatSizeChoice, setFloatSizeChoice] = useState<FloatSize | null>(null)
  const [videoHidden, setVideoHidden] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [connectionStateStr, setConnectionStateStr] = useState<string>('connected')

  // Teacher-only roster panel: who has joined (name/email) and a way to remove a student.
  const [isParticipantsPanelOpen, setIsParticipantsPanelOpen] = useState(false)
  const [participants, setParticipants] = useState<ClassParticipant[]>([])
  const [participantsLoading, setParticipantsLoading] = useState(false)
  const [removingUserId, setRemovingUserId] = useState<string | null>(null)
  const [participantsError, setParticipantsError] = useState<string | null>(null)
  const [micActionUserId, setMicActionUserId] = useState<string | null>(null)

  // "Request to speak": a student's raise-hand request reaches the teacher instantly over the
  // LiveKit data channel (students can't publish data themselves, so the server relays it) and
  // shows up as a dismissable banner even if the teacher hasn't opened the participants panel.
  const [speakRequests, setSpeakRequests] = useState<{ studentId: string; studentName: string }[]>([])
  const [mySpeakRequestStatus, setMySpeakRequestStatus] = useState<'idle' | 'requested'>('idle')
  // The local participant's own live mic-publish grant (teacher: always; student: only once
  // granted) — tracked via LiveKit's ParticipantPermissionsChanged event, the canonical signal
  // for a server-side permission update, not a custom message that could drift out of sync.
  const [canPublishAudio, setCanPublishAudio] = useState(() => isTeacher || Boolean(localParticipant?.permissions?.canPublish))

  const loadParticipants = async () => {
    if (!isTeacher) return
    setParticipantsLoading(true)
    try {
      const list = await classService.getParticipants(classroom.id)
      setParticipants(list)
    } catch {
      // Keep whatever list is already shown; the panel's own content stays usable.
    } finally {
      setParticipantsLoading(false)
    }
  }

  useEffect(() => {
    if (isParticipantsPanelOpen) loadParticipants()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParticipantsPanelOpen])

  const openParticipants = () => {
    setIsSummaryPanelOpen(false)
    setIsParticipantsPanelOpen(true)
  }

  const handleRemoveParticipant = async (p: ClassParticipant) => {
    if (!window.confirm(`Remove ${p.full_name} from this class? They'll be disconnected immediately and can't rejoin this session.`)) {
      return
    }
    setParticipantsError(null)
    setRemovingUserId(p.user_id)
    try {
      await classService.removeParticipant(classroom.id, p.user_id)
      await loadParticipants()
    } catch (err: any) {
      setParticipantsError(err.message || 'Could not remove this student.')
    } finally {
      setRemovingUserId(null)
    }
  }

  const handleGrantMic = async (p: ClassParticipant) => {
    setParticipantsError(null)
    setMicActionUserId(p.user_id)
    try {
      await classService.grantMic(classroom.id, p.user_id)
      setSpeakRequests((prev) => prev.filter((r) => r.studentId !== p.user_id))
      await loadParticipants()
    } catch (err: any) {
      setParticipantsError(err.message || 'Could not allow this student to speak.')
    } finally {
      setMicActionUserId(null)
    }
  }

  const handleRevokeMic = async (p: ClassParticipant) => {
    setParticipantsError(null)
    setMicActionUserId(p.user_id)
    try {
      await classService.revokeMic(classroom.id, p.user_id)
      await loadParticipants()
    } catch (err: any) {
      setParticipantsError(err.message || 'Could not mute this student.')
    } finally {
      setMicActionUserId(null)
    }
  }

  const dismissSpeakRequest = (studentId: string) => {
    setSpeakRequests((prev) => prev.filter((r) => r.studentId !== studentId))
  }

  const handleRequestToSpeak = async () => {
    setMySpeakRequestStatus('requested')
    try {
      await classService.requestToSpeak(classroom.id)
    } catch {
      setMySpeakRequestStatus('idle') // let the student try again
    }
  }

  // Teacher: listen for a student's raise-hand request, pushed server-side over the data
  // channel the instant it happens (students can't publish data themselves).
  useEffect(() => {
    if (!room || !isTeacher) return
    const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== 'speak-request') return
      let msg: any
      try {
        msg = JSON.parse(new TextDecoder().decode(payload))
      } catch {
        return
      }
      if (msg?.type === 'speak_request' && typeof msg.student_id === 'string') {
        const studentId = msg.student_id
        const studentName = typeof msg.student_name === 'string' ? msg.student_name : 'A student'
        setSpeakRequests((prev) => (prev.some((r) => r.studentId === studentId) ? prev : [...prev, { studentId, studentName }]))
        loadParticipants()
      }
    }
    room.on(RoomEvent.DataReceived, onData as any)
    return () => {
      room.off(RoomEvent.DataReceived, onData as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, isTeacher])

  // Student: the server-side permission update is the source of truth for whether the mic
  // toggle can actually work — not the request's own "sent" state, which never implies a grant.
  useEffect(() => {
    if (!room || isTeacher) return
    const onPermissions = (_prev: unknown, participant: { identity: string }) => {
      if (participant.identity !== room.localParticipant.identity) return
      const granted = Boolean(room.localParticipant.permissions?.canPublish)
      setCanPublishAudio(granted)
      if (!granted) setMySpeakRequestStatus('idle') // revoked: let them ask again
    }
    room.on(RoomEvent.ParticipantPermissionsChanged, onPermissions as any)
    return () => {
      room.off(RoomEvent.ParticipantPermissionsChanged, onPermissions as any)
    }
  }, [room, isTeacher])

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

  // Test-only: lets a real-browser test inspect the real Room/PeerConnection directly, and
  // synthesize the one external input the browser itself won't reliably simulate — a
  // ConnectionQuality signal (ordinary DevTools/CDP network throttling only affects Chrome's
  // HTTP/WebSocket stack, not WebRTC's UDP media path, so it cannot be used to exercise this
  // reliably). Emitting the event is as far as this override goes: every reaction to it —
  // useAdaptiveAudio's handler, the real publication.setSubscribed() calls, the real resulting
  // RTP flow on the real LiveKit Cloud connection — is completely real and unmocked.
  // Never set in a real build — only the e2e-live harness sets VITE_E2E_TEST_HOOKS.
  useEffect(() => {
    if (import.meta.env.VITE_E2E_TEST_HOOKS !== 'true' || !room) return
    ;(window as any).__livekitRoom = room
    ;(window as any).__emitConnectionQuality = (quality: ConnectionQuality) => {
      room.emit('connectionQualityChanged' as any, quality, room.localParticipant)
    }
    return () => {
      delete (window as any).__livekitRoom
      delete (window as any).__emitConnectionQuality
    }
  }, [room])

  // A sustained outage offers the offline recovery screen (Downloads stay usable without any server)
  const { recoveryRequired, dismiss } = useConnectionRecovery(connectionStateStr)

  // A brief network blip is handled entirely by LiveKit's own reconnect using the same token.
  // But once it's sustained enough to show the recovery screen, that token may be the actual
  // problem (expired, revoked, rejected) — LiveKit will then retry forever with the same bad
  // credential. Fetching a fresh join-token and handing it to LiveKitRoom (as a new `token` prop)
  // makes it attempt a real reconnect with fresh credentials instead. Fires once per outage: the
  // effect only re-runs when `recoveryRequired` flips, not on every render.
  useEffect(() => {
    if (recoveryRequired) onNeedFreshToken()
  }, [recoveryRequired, onNeedFreshToken])

  // Three separate signals: the device, the EduVillage API, and the live media connection.
  const { isBrowserOnline, isServerReachable } = useNetworkStatus()
  const diagnosis = diagnoseConnectivity({ browserOnline: isBrowserOnline, apiReachable: isServerReachable, liveKitState: connectionStateStr })

  // The presenter's camera (the teacher sees their own, students see the teacher's)
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const cameraTrack = cameraTracks.find((t) =>
    isTeacher ? t.participant.isLocal : !t.participant.isLocal && t.participant.permissions?.canPublish
  )

  // Whiteboard (shared over the data channel) and screen sharing (one or several screens)
  const { board, dispatch, applyLocal, send, setOpen } = useWhiteboard(room, isTeacher)
  const { shares, hiddenCount, addScreen, stopShare, supported: canShareScreen, error: shareError } = useScreenShares(room)
  const blur = useBackgroundBlur(isTeacher ? room : undefined, Boolean(isCameraEnabled), wantBlur)

  // What is on the stage: the whiteboard and every shared screen. New content takes over the stage automatically.
  const views = [
    ...(board.open ? [{ key: 'board', label: 'Whiteboard' }] : []),
    ...shares.map((sh) => ({ key: sh.key, label: sh.isLocal ? `${sh.name} (yours)` : sh.name })),
    ...(shares.length > 1 ? [{ key: 'all', label: 'All screens' }] : []),
  ]
  const viewKeys = views.map((v) => v.key).join('|')
  const previousKeys = useRef<string[]>([])
  useEffect(() => {
    const now = viewKeys ? viewKeys.split('|') : []
    const added = now.filter((k) => !previousKeys.current.includes(k) && k !== 'all')
    if (added.length > 0) setActiveKey(added[added.length - 1])
    else if (activeKey && !now.includes(activeKey)) setActiveKey(now[0] ?? null)
    previousKeys.current = now
  }, [viewKeys]) // eslint-disable-line react-hooks/exhaustive-deps
  const hasContent = views.length > 0
  const currentKey = views.some((v) => v.key === activeKey) ? activeKey : views[0]?.key
  // Small once something is presented, larger while the video is all there is - unless the user chose a size.
  const floatSize: FloatSize = floatSizeChoice ?? (hasContent ? 'small' : 'large')

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
          {isTeacher ? (
            <button
              type="button"
              onClick={openParticipants}
              className="flex items-center gap-1.5 text-xs text-[#CBD7D1] bg-[#202B2A] hover:bg-[#374947] px-2.5 py-1 rounded-full border border-[#374947] cursor-pointer"
              aria-label="View participants"
            >
              <Users className="w-3.5 h-3.5 text-[#FFFFFF]" />
              <span data-testid="participant-count">{remoteParticipants.length + 1}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-[#CBD7D1] bg-[#202B2A] px-2.5 py-1 rounded-full border border-[#374947]">
              <Users className="w-3.5 h-3.5 text-[#FFFFFF]" />
              <span data-testid="participant-count">{remoteParticipants.length + 1}</span>
            </div>
          )}

          <Badge variant="live" size="sm">
            LIVE
          </Badge>
        </div>
      </div>

      {/* Pending "request to speak" notifications (teacher only) */}
      {isTeacher && speakRequests.length > 0 && (
        <div className="bg-[#E8F3FC] border-b border-[#CBD7D1] px-4 py-2 flex flex-col gap-1.5 text-xs text-[#2364AA]">
          {speakRequests.map((r) => (
            <div key={r.studentId} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <Hand className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  <strong>{r.studentName}</strong> is requesting to speak
                </span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const p = participants.find((pp) => pp.user_id === r.studentId)
                    if (p) handleGrantMic(p)
                    else handleGrantMic({ user_id: r.studentId, full_name: r.studentName } as ClassParticipant)
                  }}
                  className="px-2.5 py-1 rounded-full bg-[#2364AA] text-[#FFFFFF] font-semibold cursor-pointer hover:bg-[#1A4D80]"
                >
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => dismissSpeakRequest(r.studentId)}
                  className="p-1 rounded-full text-[#2364AA] hover:bg-[#CBD7D1]/50 cursor-pointer"
                  aria-label={`Dismiss request from ${r.studentName}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
        {/* Media Region: what the teacher presents, with the teacher's camera as a small floating window */}
        <div className="flex-1 relative bg-[#000000] overflow-hidden" data-testid="stage">
          <div className="absolute inset-0 overflow-y-auto p-3 sm:p-6 flex flex-col items-center">
            {severeDegradation && !isTeacher ? (
              /* Even audio-only is unreliable: fall back to the latest lecture summary as text. */
              <div className="my-auto w-full flex justify-center">
                <TextFallbackPanel classId={classroom.id} />
              </div>
            ) : hasContent ? (
              <div className={`w-full flex flex-col gap-3 ${currentKey === 'board' ? '' : 'max-w-5xl'}`}>
                {views.length > 1 && (
                  <div className="flex flex-wrap gap-2" role="tablist" aria-label="Shared content">
                    {views.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        role="tab"
                        aria-selected={currentKey === v.key}
                        onClick={() => setActiveKey(v.key)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer inline-flex items-center gap-1.5 ${
                          currentKey === v.key
                            ? 'bg-[#0F5B57] text-[#FFFFFF] border-[#0F5B57]'
                            : 'bg-[#202B2A] text-[#CBD7D1] border-[#374947] hover:bg-[#374947]'
                        }`}
                      >
                        {v.key === 'board' ? <PencilLine className="w-3.5 h-3.5" /> : v.key === 'all' ? <LayoutGrid className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}

                {currentKey === 'board' ? (
                  <Whiteboard board={board} {...(isTeacher ? { onAction: dispatch, applyLocal, send } : {})} />
                ) : (
                  <div className={currentKey === 'all' ? 'grid grid-cols-1 md:grid-cols-2 gap-3' : ''}>
                    {shares
                      .filter((sh) => currentKey === 'all' || sh.key === currentKey)
                      .map((sh) => (
                        <div key={sh.key} className="relative w-full aspect-video bg-[#121A19] rounded-xl overflow-hidden border border-[#202B2A] shadow-2xl" data-testid="screen-share">
                          <VideoTrack trackRef={{ participant: sh.participant, publication: sh.publication as any, source: Track.Source.ScreenShare }} className="w-full h-full object-contain" />
                          <div className="absolute bottom-3 left-3 bg-black/70 px-2.5 py-1 rounded text-xs font-semibold text-white">{sh.name}</div>
                          {sh.isLocal && (
                            <button
                              type="button"
                              onClick={() => stopShare(sh)}
                              className="absolute top-3 right-3 px-3 py-1.5 rounded-md bg-[#B42318] hover:bg-[#911C13] text-white text-xs font-semibold cursor-pointer"
                            >
                              Stop sharing
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              /* Nothing is being presented */
              <div className="my-auto flex flex-col items-center justify-center text-center p-6">
                <div className="w-16 h-16 rounded-full bg-[#121A19] border border-[#202B2A] flex items-center justify-center mb-3 text-[#84908D]">
                  <Video className="w-8 h-8 text-[#0F5B57]" />
                </div>
                <h3 className="font-semibold text-base text-[#FFFFFF] mb-1">
                  {isTeacher ? 'Nothing is shared yet' : cameraTrack ? 'No screen or whiteboard shared' : 'Waiting for the teacher'}
                </h3>
                <p className="text-xs text-[#84908D] max-w-sm">
                  {isTeacher
                    ? 'Share your screen or open the whiteboard from the bar below. Your students see it here.'
                    : 'When your teacher shares a screen or opens the whiteboard it appears here. Their video stays in the small window.'}
                </p>
              </div>
            )}

            {hiddenCount > 0 && !isTeacher && (
              <p className="mt-3 text-xs text-[#DDF3EA] bg-[#202B2A] border border-[#374947] rounded-lg px-3 py-2 max-w-md text-center" role="status">
                {hiddenCount === 1 ? 'A screen is being shared' : `${hiddenCount} screens are being shared`}, but video is paused in
                audio-only mode. Switch to video to see it. The whiteboard still works.
              </p>
            )}
            {(shareError || blur.error) && isTeacher && (
              <p className="mt-3 text-xs text-[#FDE8E7] bg-[#B42318]/30 border border-[#B42318] rounded-lg px-3 py-2 max-w-md text-center" role="alert">
                {shareError || blur.error}
              </p>
            )}
          </div>

          <FloatingVideo
            label={isTeacher ? 'You' : `${classroom.teacher_name || 'Teacher'}`}
            size={floatSize}
            onSizeChange={setFloatSizeChoice}
            hidden={videoHidden}
            onHiddenChange={setVideoHidden}
            status={isTeacher ? (blur.active ? 'blur-on' : blur.supported ? 'blur-off' : 'blur-unsupported') : undefined}
            actions={
              isTeacher ? (
                <>
                  <button
                    type="button"
                    onClick={handleToggleMic}
                    className="p-1 rounded text-[#CBD7D1] hover:text-[#FFFFFF] hover:bg-[#374947] cursor-pointer"
                    aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  >
                    {isMicrophoneEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5 text-[#F97066]" />}
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleCamera}
                    className="p-1 rounded text-[#CBD7D1] hover:text-[#FFFFFF] hover:bg-[#374947] cursor-pointer"
                    aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                  >
                    {isCameraEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5 text-[#F97066]" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWantBlur((v) => !v)}
                    disabled={!blur.supported}
                    aria-pressed={wantBlur}
                    className={`p-1 rounded hover:bg-[#374947] cursor-pointer disabled:opacity-40 ${blur.active ? 'text-[#7EE2B8]' : 'text-[#CBD7D1]'}`}
                    aria-label="Blur background"
                  >
                    <Droplet className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : undefined
            }
          >
            {isAudioOnly && !isTeacher ? (
              <div className="flex flex-col items-center text-[#CBD7D1] text-[11px]">
                <Volume2 className="w-6 h-6 text-[#2364AA] animate-pulse mb-1" />
                Audio only
              </div>
            ) : cameraTrack?.publication?.track ? (
              <VideoTrack trackRef={cameraTrack} className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center text-[#84908D] text-[11px]">
                <User className="w-8 h-8 mb-1" />
                {isTeacher ? (isCameraEnabled ? 'Starting camera...' : 'Camera off') : cameraTrack ? 'Video off' : 'Waiting for video'}
              </div>
            )}
          </FloatingVideo>
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

        {/* Desktop Side Participants Panel (teacher only; does not disconnect active call) */}
        {isParticipantsPanelOpen && isTeacher && (
          <aside className="hidden lg:flex flex-col w-96 bg-[#FFFFFF] text-[#202B2A] border-l border-[#E1E8E4] shrink-0 h-full overflow-hidden">
            <div className="p-4 border-b border-[#E1E8E4] flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm text-[#202B2A]">
                <Users className="w-4 h-4 text-[#0F5B57]" />
                <span>Participants ({remoteParticipants.length + 1})</span>
              </div>
              <button
                type="button"
                onClick={() => setIsParticipantsPanelOpen(false)}
                className="p-1 text-[#687775] hover:text-[#0F5B57] rounded cursor-pointer"
                aria-label="Close participants"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <ParticipantsPanel
                participants={participants}
                isLoading={participantsLoading}
                removingUserId={removingUserId}
                micActionUserId={micActionUserId}
                errorMessage={participantsError}
                onRemove={handleRemoveParticipant}
                onGrantMic={handleGrantMic}
                onRevokeMic={handleRevokeMic}
              />
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

      {/* Mobile Bottom Sheet for Participants (teacher only; does not disconnect active call) */}
      {isTeacher && (
        <Sheet
          isOpen={isParticipantsPanelOpen}
          onClose={() => setIsParticipantsPanelOpen(false)}
          title={`Participants (${remoteParticipants.length + 1})`}
          position="bottom"
        >
          <div className="text-left text-[#202B2A]">
            <ParticipantsPanel
              participants={participants}
              isLoading={participantsLoading}
              removingUserId={removingUserId}
              micActionUserId={micActionUserId}
              errorMessage={participantsError}
              onRemove={handleRemoveParticipant}
              onGrantMic={handleGrantMic}
              onRevokeMic={handleRevokeMic}
            />
          </div>
        </Sheet>
      )}

      {/* Bottom Control Bar */}
      <ClassroomControls
        isMicEnabled={Boolean(isMicrophoneEnabled)}
        onToggleMic={handleToggleMic}
        isCameraEnabled={Boolean(isCameraEnabled)}
        onToggleCamera={handleToggleCamera}
        canPublishVideo={isTeacher}
        canPublishAudio={isTeacher || canPublishAudio}
        speakToTeacher={!isTeacher ? { status: mySpeakRequestStatus, onRequest: handleRequestToSpeak } : undefined}
        isAudioOnly={isAudioOnly}
        onToggleAudioOnly={() => toggleAudioOnly()}
        isAdaptiveActive={isAdaptiveActive}
        onToggleSummary={() => {
          setIsParticipantsPanelOpen(false)
          setIsSummaryPanelOpen(!isSummaryPanelOpen)
        }}
        isSummaryOpen={isSummaryPanelOpen}
        onLeave={onLeave}
        connectionState={connectionStateStr}
        teacherTools={
          isTeacher
            ? {
                canShareScreen,
                isSharingScreen: shares.some((sh) => sh.isLocal),
                onAddScreen: () => void addScreen(),
                isBoardOpen: board.open,
                onToggleBoard: () => setOpen(!board.open),
                blurOn: wantBlur,
                blurSupported: blur.supported,
                onToggleBlur: () => setWantBlur((v) => !v),
              }
            : undefined
        }
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

  // Passed down to ClassroomStage: fetches a fresh LiveKit join-token and replaces `joinData`,
  // which flows into LiveKitRoom's `token` prop and makes it reconnect with fresh credentials
  // instead of retrying forever with one that may have been the actual cause of the outage.
  const refreshJoinToken = useCallback(async () => {
    if (!classId) return
    try {
      const fresh = await classService.getJoinToken(classId)
      setJoinData(fresh)
    } catch {
      // Transient (e.g. API also unreachable right now, or the class ended): the recovery
      // screen stays up and the next sustained outage, or a manual reload, tries again.
    }
  }, [classId])

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
      {/* video/audio auto-publish only for participants actually allowed to publish. Camera is
          teacher-only even for a student granted mic permission, since that grant is restricted
          to the microphone source (see livekit.set_mic_permission) — attempting a camera publish
          for them would be rejected by the server (a real, logged PublishTrackError) for no
          reason. `audio` covers both the teacher and a mic-granted student. Leaving `audio` true
          for an ungranted student made every one of them attempt a real mic publish that the
          server then rejected on every single join, for the same reason — this prop only
          controls local publishing, never remote audio playback/reception, which
          RoomAudioRenderer below handles independently of it. */}
      <LiveKitRoom
        serverUrl={joinData.url}
        token={joinData.token}
        connect={true}
        video={isTeacher}
        audio={joinData.is_publisher}
        className="flex-1 flex flex-col h-full overflow-hidden"
      >
        <ClassroomStage
          classroom={classroom}
          isTeacher={Boolean(isTeacher)}
          onLeave={handleLeave}
          summary={summary}
          onNeedFreshToken={refreshJoinToken}
        />
      </LiveKitRoom>
    </div>
  )
}
