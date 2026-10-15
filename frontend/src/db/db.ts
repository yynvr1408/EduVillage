import Dexie, { type EntityTable } from 'dexie'
import type { DownloadedResource, AssignmentDraft, SyncOperation, Summary, Lesson } from '../types'

export interface CachedLesson {
  id: string
  courseId: string
  title: string
  updatedAt: string
  payload: Lesson
}

export interface CachedSummary {
  classId: string
  courseId: string
  status: string
  reviewStatus: string
  updatedAt: string
  payload: Summary
}

export interface DownloadedRecording {
  id: string // recordingId
  recordingId: string
  courseId: string
  title: string
  courseTitle: string
  durationSeconds: number
  fileSizeBytes: number
  blob?: Blob
  downloadedAt: string
  transcript?: string
}

class EduVillageDatabase extends Dexie {
  downloadedResources!: EntityTable<DownloadedResource, 'id'>
  downloadedRecordings!: EntityTable<DownloadedRecording, 'id'>
  cachedLessonMetadata!: EntityTable<CachedLesson, 'id'>
  cachedSummaries!: EntityTable<CachedSummary, 'classId'>
  assignmentDrafts!: EntityTable<AssignmentDraft, 'id'>
  syncOperations!: EntityTable<SyncOperation, 'id'>

  constructor() {
    super('EduVillageDB')

    // Schema version 1
    this.version(1).stores({
      downloadedResources: 'id, resourceId, courseId, lessonId, fileType, downloadedAt',
      cachedLessonMetadata: 'id, courseId, title, updatedAt',
      cachedSummaries: 'classId, courseId, status, reviewStatus, updatedAt',
      assignmentDrafts: 'id, assignmentId, studentId, courseId, syncStatus, savedAt',
      syncOperations: 'id, operationType, entityId, status, idempotencyKey, createdAt',
    })

    // Schema version 2: add offline downloaded recorded classes
    this.version(2).stores({
      downloadedResources: 'id, resourceId, courseId, lessonId, fileType, downloadedAt',
      downloadedRecordings: 'id, recordingId, courseId, title, downloadedAt',
      cachedLessonMetadata: 'id, courseId, title, updatedAt',
      cachedSummaries: 'classId, courseId, status, reviewStatus, updatedAt',
      assignmentDrafts: 'id, assignmentId, studentId, courseId, syncStatus, savedAt',
      syncOperations: 'id, operationType, entityId, status, idempotencyKey, createdAt',
    })
  }

  /**
   * Clear user-private data upon logout to protect privacy on shared rural devices
   */
  async clearPrivateUserData(options: { includeDownloads?: boolean } = {}): Promise<void> {
    await this.transaction('rw', [this.assignmentDrafts, this.syncOperations], async () => {
      await this.assignmentDrafts.clear()
      await this.syncOperations.clear()
    })
    if (options.includeDownloads) {
      // Shared device: the next person must not be able to open this user's downloaded lectures, files or summaries.
      await this.transaction(
        'rw',
        [this.downloadedResources, this.downloadedRecordings, this.cachedSummaries, this.cachedLessonMetadata],
        async () => {
          await this.downloadedResources.clear()
          await this.downloadedRecordings.clear()
          await this.cachedSummaries.clear()
          await this.cachedLessonMetadata.clear()
        }
      )
    }
  }
}

export const db = new EduVillageDatabase()
