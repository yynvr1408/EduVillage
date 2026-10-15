import { db, type DownloadedRecording } from '../db/db'
import { apiUrl } from './apiClient'
import type { DownloadedResource, Material, Recording } from '../types'

export interface StorageEstimateInfo {
  usageBytes: number
  quotaBytes: number
  percentageUsed: number
  availableMB: number
  /** false when the browser exposes no storage estimate; the numbers are then meaningless. */
  supported: boolean
}

export const downloadManager = {
  /**
   * Explicitly download a learning resource and save to IndexedDB
   */
  async downloadResource(
    material: Material,
    courseTitle?: string,
    onProgress?: (percent: number) => void
  ): Promise<DownloadedResource> {
    try {
      // Authenticated fetch of the real file (the server redirects to a short-lived signed URL or streams it).
      // A failed download is reported as a failure — never replaced by placeholder content.
      const response = await fetch(apiUrl(material.file_url), { credentials: 'include' })
      if (!response.ok) {
        throw new Error(response.status === 403 || response.status === 404 ? 'You no longer have access to this file.' : `Server returned ${response.status}`)
      }
      const blob = await response.blob()
      const textContent: string | undefined = undefined

      const record: DownloadedResource = {
        id: material.id,
        resourceId: material.id,
        courseId: material.course_id,
        lessonId: material.lesson_id,
        title: material.title,
        fileType: material.file_type,
        sizeBytes: blob.size || material.file_size || 1024,
        blob,
        content: textContent,
        downloadedAt: new Date().toISOString(),
      }

      await db.downloadedResources.put(record)
      if (onProgress) onProgress(100)
      return record
    } catch (err: any) {
      console.error('Download error:', err)
      throw new Error(`Failed to download resource: ${err.message || 'Storage error'}`)
    }
  },

  /**
   * Get all downloaded resources
   */
  async getAllDownloads(): Promise<DownloadedResource[]> {
    return db.downloadedResources.toArray()
  },

  /**
   * Check if a resource is downloaded
   */
  async isDownloaded(resourceId: string): Promise<boolean> {
    const item = await db.downloadedResources.get(resourceId)
    return Boolean(item)
  },

  /**
   * Remove a downloaded resource to reclaim storage
   */
  async deleteDownload(resourceId: string): Promise<void> {
    await db.downloadedResources.delete(resourceId)
  },

  /**
   * Open / access downloaded resource blob URL
   */
  async getResourceBlobUrl(resourceId: string): Promise<string | null> {
    const item = await db.downloadedResources.get(resourceId)
    if (!item) return null

    if (item.blob) {
      return URL.createObjectURL(item.blob)
    }
    if (item.content) {
      const blob = new Blob([item.content], { type: 'text/plain' })
      return URL.createObjectURL(blob)
    }
    return null
  },

  /**
   * Download a recorded lecture for offline viewing
   */
  async downloadRecording(
    recording: Recording,
    onProgress?: (percent: number) => void
  ): Promise<DownloadedRecording> {
    if (recording.status !== 'READY' || (!recording.video_url && !recording.download_url)) {
      throw new Error('Recording is not ready for offline download.')
    }

    // Check device storage before downloading large media
    const estimate = await this.getStorageEstimate()
    const requiredMB = Math.round(recording.file_size_bytes / (1024 * 1024))
    if (estimate.availableMB < requiredMB + 50) {
      throw new Error(`Insufficient storage. Required: ${requiredMB} MB, Available: ${estimate.availableMB} MB`)
    }

    const downloadUrl = recording.download_url || recording.video_url!
    // Signed storage URL: no credentials are sent. A failure surfaces as an error, never as a fake file.
    const response = await fetch(downloadUrl)
    if (!response.ok) {
      throw new Error(`Could not download the recording (server returned ${response.status}). Try again while online.`)
    }
    const blob = await response.blob()

    const record: DownloadedRecording = {
      id: recording.id,
      recordingId: recording.id,
      courseId: recording.course_id,
      title: recording.title,
      courseTitle: recording.course_title || recording.course_code || 'Course',
      durationSeconds: recording.duration_seconds,
      fileSizeBytes: blob.size || recording.file_size_bytes,
      blob,
      downloadedAt: new Date().toISOString(),
      transcript: recording.transcript,
    }

    await db.downloadedRecordings.put(record)
    if (onProgress) onProgress(100)
    return record
  },

  async isRecordingDownloaded(recordingId: string): Promise<boolean> {
    const item = await db.downloadedRecordings.get(recordingId)
    return Boolean(item)
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
  },

  async getAllDownloadedRecordings(): Promise<DownloadedRecording[]> {
    return db.downloadedRecordings.toArray()
  },

  /**
   * Inspect device storage estimate
   */
  async getStorageEstimate(): Promise<StorageEstimateInfo> {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const { usage, quota } = await navigator.storage.estimate()
        const usageBytes = usage || 0
        const quotaBytes = quota || 1024 * 1024 * 1024 // 1GB fallback
        const percentageUsed = quotaBytes > 0 ? Math.round((usageBytes / quotaBytes) * 100) : 0
        const availableMB = Math.round((quotaBytes - usageBytes) / (1024 * 1024))
        return {
          usageBytes,
          quotaBytes,
          percentageUsed,
          availableMB,
          supported: true,
        }
      } catch {
        // Fallback
      }
    }

    // The browser can't report storage: say so (zeroes) rather than inventing numbers.
    return { usageBytes: 0, quotaBytes: 0, percentageUsed: 0, availableMB: Number.MAX_SAFE_INTEGER, supported: false }
  },
}
