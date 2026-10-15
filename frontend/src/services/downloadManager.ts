import { db, type DownloadedRecording, type DownloadedSummary } from '../db/db'
import { api } from './apiClient'
import {
  DownloadError,
  clearJob,
  getInFlight,
  getJob,
  pauseDownload,
  startDownload,
  type DownloadOptions,
  type DownloadState,
} from './downloadEngine'
import type { DownloadedResource, Material, Recording, Summary } from '../types'

export interface StorageEstimateInfo {
  usageBytes: number
  quotaBytes: number
  percentageUsed: number
  availableMB: number
  /** false when the browser exposes no storage estimate; the numbers are then meaningless. */
  supported: boolean
  /** true when the browser has granted persistent storage (protected from automatic eviction). */
  persisted?: boolean
}

/** What a student sees for one file. "available_offline" is only ever reported for a fully verified local copy. */
export type OfflineState =
  | 'not_downloaded'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'failed'
  | 'available_offline'
  | 'update_available'

export interface OfflineStatus {
  state: OfflineState
  percent: number
  error?: string
  errorCode?: string
}

export interface ResourceDownloadOptions extends DownloadOptions {
  onState?: (state: DownloadState) => void
  /** Download again even if the local copy is current. */
  force?: boolean
}

const MB = 1024 * 1024

function isNetworkFailure(err: unknown): boolean {
  return !(err instanceof DownloadError) && (err as { isNetworkError?: boolean })?.isNetworkError === true
}

/** Triggers the browser's native "save file" behavior (their actual Downloads folder, same as
 * clicking a normal download link) for a Blob that's already sitting in memory/IndexedDB — no
 * network request, works fully offline. */
function saveBlobToDevice(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has had time to start the save (revoking immediately can cancel it in some browsers).
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
}

function suggestFilename(title: string, mimeType: string | undefined): string {
  const safeTitle = (title || 'download').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'download'
  const hasExtAlready = /\.[a-z0-9]{2,4}$/i.test(safeTitle)
  if (hasExtAlready) return safeTitle
  const ext = (mimeType && EXT_BY_MIME[mimeType]) || 'dat'
  return `${safeTitle}.${ext}`
}

export const downloadManager = {
  /**
   * Download a learning resource for offline use. Resumable, verified, and a no-op when a current,
   * verified copy is already stored (no unnecessary network use).
   */
  async downloadResource(
    material: Material,
    _courseTitle?: string,
    onProgress?: (percent: number) => void,
    options: ResourceDownloadOptions = {}
  ): Promise<DownloadedResource> {
    const existing = await db.downloadedResources.get(material.id)

    let info
    try {
      info = await api.getResourceDownloadInfo(material.id)
    } catch (err) {
      // Offline or the server is down: a verified local copy still satisfies the request.
      if (existing && isNetworkFailure(err)) return existing
      if (err instanceof Error && (err as { status?: number }).status && [403, 404].includes((err as { status?: number }).status!)) {
        throw new DownloadError('UNAVAILABLE', 'This file is no longer available to you (removed, unpublished, or access changed).')
      }
      throw err
    }

    if (existing && !options.force && existing.version === info.version) {
      onProgress?.(100)
      return existing // same version already verified on this device: nothing to download
    }

    const blob = await startDownload(
      {
        id: material.id,
        url: info.url,
        credentials: info.sameOrigin,
        totalBytes: info.sizeBytes || material.file_size,
        version: info.version,
        checksum: info.checksum,
        mimeType: info.mimeType || material.file_type,
      },
      {
        ...options,
        onProgress: (p) => {
          onProgress?.(p.percent)
          options.onProgress?.(p)
          options.onState?.(p.state)
        },
      }
    )

    const record: DownloadedResource = {
      id: material.id,
      resourceId: material.id,
      courseId: material.course_id,
      lessonId: material.lesson_id,
      title: material.title,
      fileType: material.resource_type || material.file_type,
      sizeBytes: blob.size,
      blob,
      downloadedAt: new Date().toISOString(),
      version: info.version,
      checksum: info.checksum,
      verifiedAt: new Date().toISOString(),
    }
    try {
      await db.downloadedResources.put(record) // only now is it "available offline"
    } catch (err) {
      if ((err as { name?: string })?.name === 'QuotaExceededError') {
        throw new DownloadError('STORAGE_LIMIT', 'The browser refused to store this file (storage is full). Free some space and retry.')
      }
      throw err
    }
    await clearJob(material.id) // chunks are no longer needed once the verified file is stored
    onProgress?.(100)
    return record
  },

  /** Current offline status of a resource. Pass the server's version to detect a stale local copy. */
  async getResourceStatus(resourceId: string, currentVersion?: number): Promise<OfflineStatus> {
    const record = await db.downloadedResources.get(resourceId)
    if (record) {
      const stale = currentVersion !== undefined && record.version !== undefined && record.version < currentVersion
      return { state: stale ? 'update_available' : 'available_offline', percent: 100 }
    }
    const job = await getJob(resourceId)
    if (!job) return { state: 'not_downloaded', percent: 0 }
    const percent = job.totalBytes > 0 ? Math.floor((job.bytesDownloaded / job.totalBytes) * 100) : 0
    // A persisted "downloading" job with nothing running (closed tab, crash) is really paused.
    const active = getInFlight(resourceId)
    const state: OfflineState =
      job.status === 'failed' ? 'failed' : job.status === 'verifying' ? 'verifying' : active ? 'downloading' : 'paused'
    return { state, percent, error: job.error, errorCode: job.errorCode }
  },

  /** Stop an active download, keeping the bytes already stored so it can resume. */
  pauseResourceDownload(resourceId: string): void {
    pauseDownload(resourceId)
  },

  /** Abandon a partial download and free its stored chunks. */
  async cancelResourceDownload(resourceId: string): Promise<void> {
    pauseDownload(resourceId)
    await clearJob(resourceId)
  },

  /** Resources with an interrupted/failed download waiting to be resumed. */
  async getPendingJobs() {
    return db.downloadJobs.where('status').anyOf('queued', 'downloading', 'paused', 'failed').toArray()
  },

  async getAllDownloads(): Promise<DownloadedResource[]> {
    return db.downloadedResources.toArray()
  },

  async isDownloaded(resourceId: string): Promise<boolean> {
    return Boolean(await db.downloadedResources.get(resourceId))
  },

  /** Remove a downloaded file (and any partial data) to reclaim space. */
  async deleteDownload(resourceId: string): Promise<void> {
    await db.downloadedResources.delete(resourceId)
    await clearJob(resourceId)
  },

  async getResourceBlobUrl(resourceId: string): Promise<string | null> {
    const item = await db.downloadedResources.get(resourceId)
    if (!item) return null
    if (item.blob) return URL.createObjectURL(item.blob)
    if (item.content) return URL.createObjectURL(new Blob([item.content], { type: 'text/plain' }))
    return null
  },

  // ---------------------------------------------------------------- recordings

  /** Download a recorded lecture for offline viewing (same resumable, verified engine). */
  async downloadRecording(
    recording: Recording,
    onProgress?: (percent: number) => void,
    options: ResourceDownloadOptions = {}
  ): Promise<DownloadedRecording> {
    if (recording.status !== 'READY' || (!recording.video_url && !recording.download_url)) {
      throw new DownloadError('UNAVAILABLE', 'This recording is not ready for offline download.')
    }
    const id = `rec:${recording.id}`
    const existing = await db.downloadedRecordings.get(recording.id)
    if (existing && !options.force) {
      onProgress?.(100)
      return existing
    }

    const blob = await startDownload(
      {
        id,
        url: (recording.download_url || recording.video_url)!,
        credentials: false, // signed storage URL
        totalBytes: recording.file_size_bytes,
        version: 1,
        mimeType: 'video/mp4',
      },
      {
        ...options,
        onProgress: (p) => {
          onProgress?.(p.percent)
          options.onProgress?.(p)
          options.onState?.(p.state)
        },
      }
    )

    const record: DownloadedRecording = {
      id: recording.id,
      recordingId: recording.id,
      courseId: recording.course_id,
      title: recording.title,
      courseTitle: recording.course_title || recording.course_code || 'Course',
      durationSeconds: recording.duration_seconds,
      fileSizeBytes: blob.size,
      blob,
      downloadedAt: new Date().toISOString(),
      transcript: recording.transcript,
      version: 1,
      mimeType: 'video/mp4',
    }
    try {
      await db.downloadedRecordings.put(record)
    } catch (err) {
      if ((err as { name?: string })?.name === 'QuotaExceededError') {
        throw new DownloadError('STORAGE_LIMIT', 'The browser refused to store this file (storage is full). Free some space and retry.')
      }
      throw err
    }
    await clearJob(id)
    onProgress?.(100)
    return record
  },

  async isRecordingDownloaded(recordingId: string): Promise<boolean> {
    return Boolean(await db.downloadedRecordings.get(recordingId))
  },

  async getDownloadedRecording(recordingId: string): Promise<DownloadedRecording | undefined> {
    return db.downloadedRecordings.get(recordingId)
  },

  async getRecordingBlobUrl(recordingId: string): Promise<string | null> {
    const item = await db.downloadedRecordings.get(recordingId)
    if (!item || !item.blob) return null
    return URL.createObjectURL(item.blob)
  },

  async deleteDownloadedRecording(recordingId: string): Promise<void> {
    await db.downloadedRecordings.delete(recordingId)
    await clearJob(`rec:${recordingId}`)
  },

  async getAllDownloadedRecordings(): Promise<DownloadedRecording[]> {
    return db.downloadedRecordings.toArray()
  },

  // ---------------------------------------------------------------- summaries

  /** Save a teacher-approved summary for offline reading. Opening it later needs no network or AI call. */
  async downloadSummary(summary: Summary, title?: string): Promise<DownloadedSummary> {
    if (summary.status !== 'COMPLETED') {
      throw new DownloadError('UNAVAILABLE', 'Only summaries approved by the teacher can be downloaded.')
    }
    const record: DownloadedSummary = {
      id: summary.id,
      classId: summary.class_id,
      courseId: summary.course_id,
      title: title || 'Lecture summary',
      downloadedAt: new Date().toISOString(),
      payload: summary,
    }
    await db.downloadedSummaries.put(record)
    return record
  },

  async getDownloadedSummaries(): Promise<DownloadedSummary[]> {
    return db.downloadedSummaries.toArray()
  },

  async getDownloadedSummaryForClass(classId: string): Promise<DownloadedSummary | undefined> {
    return db.downloadedSummaries.where('classId').equals(classId).first()
  },

  async deleteDownloadedSummary(summaryId: string): Promise<void> {
    await db.downloadedSummaries.delete(summaryId)
  },

  // ---------------------------------------------------------------- storage

  /** Inspect device storage; reports honestly when the browser can't say. */
  async getStorageEstimate(): Promise<StorageEstimateInfo> {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const { usage, quota } = await navigator.storage.estimate()
        const usageBytes = usage || 0
        const quotaBytes = quota || 0
        if (quotaBytes > 0) {
          let persisted: boolean | undefined
          try {
            persisted = await navigator.storage.persisted?.()
          } catch {
            persisted = undefined
          }
          return {
            usageBytes,
            quotaBytes,
            percentageUsed: Math.round((usageBytes / quotaBytes) * 100),
            availableMB: Math.round((quotaBytes - usageBytes) / MB),
            supported: true,
            persisted,
          }
        }
      } catch {
        // fall through
      }
    }
    return { usageBytes: 0, quotaBytes: 0, percentageUsed: 0, availableMB: Number.MAX_SAFE_INTEGER, supported: false }
  },

  // ---------------------------------------------------------------- save to device (real file, not just IndexedDB)

  /** Writes an already-downloaded resource's stored blob to the user's actual filesystem (their
   * browser's Downloads folder, via the normal save dialog) — separate from being saved in
   * IndexedDB for offline in-app viewing. Throws if the resource was never downloaded. */
  async saveResourceToDevice(resourceId: string): Promise<void> {
    const item = await db.downloadedResources.get(resourceId)
    if (!item) throw new DownloadError('UNAVAILABLE', 'This file is not saved on this device yet.')
    const blob = item.blob ?? (item.content != null ? new Blob([item.content], { type: 'text/plain' }) : null)
    if (!blob) throw new DownloadError('UNAVAILABLE', 'This file has no stored content to save.')
    saveBlobToDevice(blob, suggestFilename(item.title, blob.type))
  },

  /** Same, for a downloaded recorded lecture. */
  async saveRecordingToDevice(recordingId: string): Promise<void> {
    const item = await db.downloadedRecordings.get(recordingId)
    if (!item?.blob) throw new DownloadError('UNAVAILABLE', 'This recording is not saved on this device yet.')
    saveBlobToDevice(item.blob, suggestFilename(item.title, item.mimeType || item.blob.type))
  },
}
