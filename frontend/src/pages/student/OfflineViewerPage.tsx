import React, { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { db } from '../../db/db'
import { playbackStore } from '../../services/playbackStore'
import type { DownloadedResource } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { LoadingState, ErrorState, Badge } from '../../components/ui'

type Kind = 'video' | 'audio' | 'pdf' | 'text' | 'other'

function kindOf(item: DownloadedResource): Kind {
  const mime = item.blob?.type || ''
  if (mime.startsWith('video/') || item.fileType === 'video') return 'video'
  if (mime.startsWith('audio/') || item.fileType === 'audio') return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('text/') || item.content) return 'text'
  return 'other'
}

async function readText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

const MEDIA_ERRORS: Record<number, string> = {
  1: 'Playback was cancelled.',
  2: 'The file could not be read from this device.',
  3: 'This file is damaged or could not be decoded.',
  4: "This device's browser cannot play this file format.",
}

/**
 * Opens a downloaded resource entirely from local storage. It never contacts the server, so it
 * works with the network disconnected. Media resumes where the student left off.
 */
export const OfflineViewerPage: React.FC = () => {
  const { resourceId } = useParams<{ resourceId: string }>()
  const [item, setItem] = useState<DownloadedResource | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [resumedAt, setResumedAt] = useState(0)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const lastSaveRef = useRef(0)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null

    async function load() {
      if (!resourceId) return
      try {
        const record = await db.downloadedResources.get(resourceId)
        if (!active) return
        if (!record || (!record.blob && !record.content)) {
          setError('This file is not saved on this device. Download it again while you are online.')
          return
        }
        setItem(record)
        const kind = kindOf(record)
        if (kind === 'text') {
          setText(record.blob ? await readText(record.blob) : (record.content ?? ''))
        } else if (record.blob) {
          objectUrl = URL.createObjectURL(record.blob)
          setUrl(objectUrl)
        }
      } catch {
        if (active) setError('The saved file could not be opened. The browser may have cleared it; download it again.')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [resourceId])

  const positionId = resourceId ? playbackStore.key.resource(resourceId) : ''

  const handleLoadedMetadata = async () => {
    const el = mediaRef.current
    if (!el || !positionId) return
    const start = await playbackStore.resumeAt(positionId, el.duration)
    if (start > 0) {
      el.currentTime = start
      setResumedAt(start)
    }
  }

  const persist = (completed = false) => {
    const el = mediaRef.current
    if (!el || !positionId) return
    void playbackStore.save(positionId, el.currentTime, el.duration, completed)
  }

  const handleTimeUpdate = () => {
    const el = mediaRef.current
    if (!el) return
    if (Math.abs(el.currentTime - lastSaveRef.current) >= 5) {
      lastSaveRef.current = el.currentTime
      persist()
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <LoadingState message="Opening saved file..." />
      </PageContainer>
    )
  }

  const back = (
    <div className="mb-4">
      <Link
        to="/student/downloads"
        className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Downloads
      </Link>
    </div>
  )

  if (error || !item) {
    return (
      <PageContainer>
        {back}
        <ErrorState title="File Unavailable Offline" message={error || 'This file is not saved on this device.'} />
      </PageContainer>
    )
  }

  const kind = kindOf(item)

  return (
    <PageContainer maxWidth="lg">
      {back}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#202B2A]">{item.title}</h1>
        <Badge variant="success" size="sm">
          Playing from this device
        </Badge>
      </div>

      {mediaError && (
        <div role="alert" className="mb-4 p-3 bg-[#B42318]/10 text-[#B42318] rounded-md text-xs font-medium">
          {mediaError}
        </div>
      )}

      {kind === 'video' && url && (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          data-testid="offline-media"
          src={url}
          controls
          preload="metadata"
          className="w-full rounded-xl bg-black max-h-[70vh]"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPause={() => persist()}
          onEnded={() => persist(true)}
          onError={(e) => setMediaError(MEDIA_ERRORS[e.currentTarget.error?.code ?? 0] ?? 'Playback failed.')}
        />
      )}

      {kind === 'audio' && url && (
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          data-testid="offline-media"
          src={url}
          controls
          preload="metadata"
          className="w-full"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPause={() => persist()}
          onEnded={() => persist(true)}
          onError={(e) => setMediaError(MEDIA_ERRORS[e.currentTarget.error?.code ?? 0] ?? 'Playback failed.')}
        />
      )}

      {resumedAt > 0 && (
        <p className="mt-2 text-xs text-[#687775]">Resumed from {Math.floor(resumedAt / 60)}:{String(Math.floor(resumedAt % 60)).padStart(2, '0')}</p>
      )}

      {kind === 'pdf' && url && (
        <iframe
          data-testid="offline-pdf"
          title={item.title}
          src={url}
          className="w-full h-[75vh] rounded-xl border border-[#E1E8E4] bg-white"
        />
      )}

      {kind === 'text' && (
        <pre
          data-testid="offline-text"
          className="whitespace-pre-wrap text-sm text-[#202B2A] bg-white border border-[#E1E8E4] rounded-xl p-4"
        >
          {text}
        </pre>
      )}

      {kind === 'other' && url && (
        <p className="text-sm text-[#687775]">
          This file type can't be shown in the app.{' '}
          <a href={url} download={item.title} className="font-semibold text-[#0F5B57] underline">
            Save a copy to this device
          </a>
        </p>
      )}
    </PageContainer>
  )
}
