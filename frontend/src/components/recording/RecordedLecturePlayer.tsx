import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Radio,
  Video,
  Download,
  CheckCircle,
  AlertCircle,
  Clock,
  HardDrive,
  RefreshCw,
} from 'lucide-react'
import type { Recording } from '../../types'
import { api } from '../../services/apiClient'
import { downloadManager } from '../../services/downloadManager'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

interface RecordedLecturePlayerProps {
  recording: Recording
  initialPositionSeconds?: number
  onProgressSaved?: (positionSeconds: number) => void
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export const RecordedLecturePlayer: React.FC<RecordedLecturePlayerProps> = ({
  recording,
  initialPositionSeconds = 0,
  onProgressSaved,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(initialPositionSeconds)
  const [duration, setDuration] = useState(recording.duration_seconds || 0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isAudioOnly, setIsAudioOnly] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [mediaSrc, setMediaSrc] = useState<string | null>(null)
  const [isOfflineBlob, setIsOfflineBlob] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [downloadSuccessMessage, setDownloadSuccessMessage] = useState<string | null>(null)
  const lastSavedPositionRef = useRef<number>(initialPositionSeconds)

  // 1. Resolve media source (check offline IndexedDB blob first)
  useEffect(() => {
    let active = true

    async function resolveSource() {
      try {
        const offlineUrl = await downloadManager.getRecordingBlobUrl(recording.id)
        if (offlineUrl && active) {
          setMediaSrc(offlineUrl)
          setIsOfflineBlob(true)
          setIsDownloaded(true)
          return
        }

        const downloaded = await downloadManager.isRecordingDownloaded(recording.id)
        if (active) setIsDownloaded(downloaded)

        const vUrl = recording.video_url || (recording as any).recording_url
        if (vUrl && active) {
          setMediaSrc(vUrl)
          setIsOfflineBlob(false)
        } else if (active) {
          setMediaSrc(null)
        }
      } catch {
        const fallbackUrl = recording.video_url || (recording as any).recording_url
        if (active && fallbackUrl) {
          setMediaSrc(fallbackUrl)
        }
      }
    }

    resolveSource()

    return () => {
      active = false
    }
  }, [recording.id, recording.video_url, (recording as any).recording_url])

  // 2. Seek to initial position once metadata is loaded
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      if (videoRef.current.duration) {
        setDuration(videoRef.current.duration)
      }
      if (initialPositionSeconds > 0 && initialPositionSeconds < (videoRef.current.duration || recording.duration_seconds)) {
        videoRef.current.currentTime = initialPositionSeconds
        setCurrentTime(initialPositionSeconds)
      }
    }
  }

  // 3. Debounced progress persistence
  const saveProgress = useCallback(
    async (pos: number, completed = false) => {
      if (Math.abs(pos - lastSavedPositionRef.current) < 3 && !completed) {
        return
      }
      lastSavedPositionRef.current = pos
      try {
        await api.saveRecordingProgress(recording.id, Math.round(pos), completed)
        if (onProgressSaved) onProgressSaved(Math.round(pos))
      } catch {
        // Offline or transient failure: do not interrupt playback
      }
    },
    [recording.id, onProgressSaved]
  )

  const handleTimeUpdate = () => {
    if (!videoRef.current) return
    const pos = videoRef.current.currentTime
    setCurrentTime(pos)

    // Save every 8 seconds
    if (Math.floor(pos) % 8 === 0) {
      saveProgress(pos)
    }
  }

  const handleEnded = () => {
    setIsPlaying(false)
    saveProgress(duration, true)
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
      saveProgress(videoRef.current.currentTime)
    } else {
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.warn('Playback error:', err)
          setPlaybackError('Unable to start media playback. Try refreshing or downloading for offline study.')
        })
    }
  }

  const seekRelative = (deltaSeconds: number) => {
    if (!videoRef.current) return
    const newTime = Math.max(0, Math.min(videoRef.current.currentTime + deltaSeconds, duration))
    videoRef.current.currentTime = newTime
    setCurrentTime(newTime)
    saveProgress(newTime)
  }

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value)
    setCurrentTime(newTime)
    if (videoRef.current) {
      videoRef.current.currentTime = newTime
    }
  }

  const handleScrubEnd = () => {
    if (videoRef.current) {
      saveProgress(videoRef.current.currentTime)
    }
  }

  const toggleMute = () => {
    if (!videoRef.current) return
    const newMuted = !isMuted
    videoRef.current.muted = newMuted
    setIsMuted(newMuted)
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (videoRef.current) {
      videoRef.current.volume = val
      videoRef.current.muted = val === 0
      setIsMuted(val === 0)
    }
  }

  const togglePlaybackRate = () => {
    const rates = [1, 1.25, 1.5]
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length
    const nextRate = rates[nextIdx]
    setPlaybackRate(nextRate)
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate
    }
  }

  const toggleFullscreen = () => {
    if (!videoRef.current) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      videoRef.current.requestFullscreen().catch(() => {})
    }
  }

  // Explicit download action
  const handleDownload = async () => {
    try {
      setIsDownloading(true)
      setPlaybackError(null)
      await downloadManager.downloadRecording(recording)
      setIsDownloaded(true)
      setIsOfflineBlob(true)
      setDownloadSuccessMessage('Saved to IndexedDB. Available for offline viewing.')
      setTimeout(() => setDownloadSuccessMessage(null), 4000)
    } catch (err: any) {
      setPlaybackError(err.message || 'Download failed. Check storage quota.')
    } finally {
      setIsDownloading(false)
    }
  }

  // Case 1: Recording is still being processed
  if (recording.status === 'PROCESSING') {
    return (
      <div className="w-full bg-[#202B2A] text-[#FFFFFF] rounded-2xl p-8 sm:p-12 text-center flex flex-col items-center justify-center border border-[#CBD7D1] space-y-4 shadow-sm">
        <Clock className="w-12 h-12 text-[#8A5700] animate-pulse" />
        <div className="space-y-1 max-w-md">
          <Badge variant="warning" className="uppercase tracking-wider">
            Processing Lecture
          </Badge>
          <h3 className="text-base sm:text-lg font-semibold text-[#FFFFFF] pt-2">
            Your lecture recording is being prepared.
          </h3>
          <p className="text-xs sm:text-sm text-[#CBD7D1] leading-relaxed">
            The video stream, audio isolation, and transcript are currently being finalized. You can return later to watch this recording.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="bg-transparent text-[#FFFFFF] border-[#CBD7D1] hover:bg-[#123B39]"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="w-4 h-4 mr-1.5" />
          Check Status
        </Button>
      </div>
    )
  }

  // Case 2: Recording processing failed or unavailable
  if (recording.status === 'FAILED' || (!recording.video_url && !mediaSrc)) {
    return (
      <div className="w-full bg-[#F1F5F2] rounded-2xl p-8 sm:p-12 text-center flex flex-col items-center justify-center border border-[#E1E8E4] space-y-3">
        <AlertCircle className="w-10 h-10 text-[#B42318]" />
        <h3 className="text-base font-semibold text-[#202B2A]">Recording Unavailable</h3>
        <p className="text-xs sm:text-sm text-[#687775] max-w-md leading-relaxed">
          {recording.status === 'FAILED'
            ? 'The recording for this live class encountered a processing error. The instructor has been notified.'
            : 'No media stream was generated for this session. Please review the AI summary and study guide below.'}
        </p>
      </div>
    )
  }

  return (
    <div className="w-full bg-[#202B2A] rounded-2xl overflow-hidden border border-[#E1E8E4] shadow-md">
      {/* Video / Audio Canvas */}
      <div className="relative aspect-video bg-[#121A19] flex items-center justify-center">
        <video
          ref={videoRef}
          src={mediaSrc || undefined}
          className={`w-full h-full object-contain ${isAudioOnly ? 'hidden' : 'block'}`}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onError={() => setPlaybackError('Unable to play stream. Try downloading the lesson for offline playback.')}
          playsInline
          preload="metadata"
        />

        {/* Audio-only Mode Visualizer */}
        {isAudioOnly && (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-3">
            <Radio className="w-12 h-12 text-[#2364AA] animate-pulse" />
            <div>
              <p className="text-sm font-semibold text-[#FFFFFF]">Low-Bandwidth Audio-Only Mode</p>
              <p className="text-xs text-[#CBD7D1] max-w-sm mt-1">
                Video track hidden to conserve cellular bandwidth on low-speed networks.
              </p>
            </div>
          </div>
        )}

        {/* Source Badge (Offline vs Network) */}
        <div className="absolute top-3 left-3 flex items-center space-x-2">
          {isOfflineBlob ? (
            <Badge variant="success" className="bg-[#E5F5EB] text-[#247A4D] border border-[#247A4D]/30 text-[10px]">
              <HardDrive className="w-3 h-3 mr-1 inline" /> Offline Storage
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-[#202B2A] text-[#CBD7D1] border-[#374947] text-[10px]">
              <Video className="w-3 h-3 mr-1 inline text-[#0F5B57]" /> Stream
            </Badge>
          )}

          {initialPositionSeconds > 0 && currentTime === initialPositionSeconds && (
            <Badge variant="secondary" className="bg-[#202B2A] text-[#CBD7D1] border-[#374947] text-[10px]">
              Resumed at {formatDuration(initialPositionSeconds)}
            </Badge>
          )}
        </div>

        {/* Big Center Play Overlay (when paused) */}
        {!isPlaying && (
          <button
            onClick={togglePlay}
            aria-label="Play Recording"
            className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-[#0F5B57]/90 hover:bg-[#0F5B57] text-[#FFFFFF] flex items-center justify-center border border-[#CBD7D1] transition-transform hover:scale-105 shadow-lg"
          >
            <Play className="w-7 h-7 ml-1" />
          </button>
        )}
      </div>

      {/* Playback Error Alert */}
      {playbackError && (
        <div className="p-3 bg-[#FDE8E7] border-t border-[#B42318]/30 text-[#B42318] text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{playbackError}</span>
          </div>
          {!isDownloaded && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              className="text-xs h-7 border-[#B42318] text-[#B42318] hover:bg-[#B42318] hover:text-white"
            >
              <Download className="w-3 h-3 mr-1" /> Download
            </Button>
          )}
        </div>
      )}

      {/* Download Success Alert */}
      {downloadSuccessMessage && (
        <div className="p-2.5 bg-[#E5F5EB] border-t border-[#247A4D]/30 text-[#247A4D] text-xs flex items-center space-x-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{downloadSuccessMessage}</span>
        </div>
      )}

      {/* Control Bar */}
      <div className="bg-[#202B2A] text-[#FFFFFF] p-3 sm:p-4 space-y-2 border-t border-[#374947]">
        {/* Scrub Bar */}
        <div className="flex items-center space-x-3">
          <span className="text-[11px] font-mono text-[#CBD7D1] min-w-9 text-right">
            {formatDuration(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.5}
            value={currentTime}
            onChange={handleScrub}
            onMouseUp={handleScrubEnd}
            onTouchEnd={handleScrubEnd}
            aria-label="Seek time"
            className="w-full h-1.5 bg-[#374947] rounded-lg appearance-none cursor-pointer accent-[#0F5B57]"
          />
          <span className="text-[11px] font-mono text-[#CBD7D1] min-w-9">
            {formatDuration(duration)}
          </span>
        </div>

        {/* Buttons Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {/* Left Controls: Play, Rewind 10, Forward 10 */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="p-2 rounded-lg bg-[#0F5B57] text-[#FFFFFF] hover:bg-[#123B39] transition-colors"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>

            <button
              onClick={() => seekRelative(-10)}
              aria-label="Rewind 10 seconds"
              className="p-1.5 text-[#CBD7D1] hover:text-[#FFFFFF] transition-colors"
              title="Rewind 10s"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={() => seekRelative(10)}
              aria-label="Fast forward 10 seconds"
              className="p-1.5 text-[#CBD7D1] hover:text-[#FFFFFF] transition-colors"
              title="Forward 10s"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume */}
            <div className="hidden sm:flex items-center space-x-2 pl-2">
              <button
                onClick={toggleMute}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                className="text-[#CBD7D1] hover:text-[#FFFFFF]"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
                className="w-16 h-1 bg-[#374947] rounded appearance-none cursor-pointer accent-[#0F5B57]"
              />
            </div>
          </div>

          {/* Right Controls: Audio-only Toggle, Speed, Download, Fullscreen */}
          <div className="flex items-center space-x-2">
            {/* Audio-only toggle */}
            <button
              onClick={() => setIsAudioOnly(!isAudioOnly)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors flex items-center space-x-1 ${
                isAudioOnly
                  ? 'bg-[#2364AA] text-[#FFFFFF] border-[#2364AA]'
                  : 'bg-[#2A3735] text-[#CBD7D1] border-[#374947] hover:text-[#FFFFFF]'
              }`}
              title="Switch to audio-only stream to save bandwidth"
            >
              <Radio className="w-3 h-3" />
              <span className="hidden sm:inline">Audio-Only</span>
            </button>

            {/* Playback speed */}
            <button
              onClick={togglePlaybackRate}
              aria-label="Change playback speed"
              className="text-xs px-2 py-1 rounded-md bg-[#2A3735] text-[#CBD7D1] hover:text-[#FFFFFF] border border-[#374947]"
            >
              {playbackRate}x
            </button>

            {/* Offline download */}
            {!isDownloaded ? (
              <button
                onClick={handleDownload}
                disabled={isDownloading}
                className="text-xs px-2.5 py-1 rounded bg-[#222222] text-[#CCCCCC] hover:text-[#FFFFFF] border border-[#444444] flex items-center space-x-1"
                title={`Download for offline study (${Math.round(recording.file_size_bytes / (1024 * 1024))} MB)`}
              >
                <Download className="w-3 h-3" />
                <span className="hidden sm:inline">{isDownloading ? 'Downloading...' : 'Offline'}</span>
              </button>
            ) : (
              <span className="text-[11px] text-[#247A4D] flex items-center space-x-1 px-1.5 py-1">
                <CheckCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Saved</span>
              </span>
            )}

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              aria-label="Fullscreen"
              className="p-1.5 text-[#CCCCCC] hover:text-[#FFFFFF]"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
