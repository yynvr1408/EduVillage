import { db } from '../db/db'
import { api } from './apiClient'
import type { AssignmentDraft, SyncOperation } from '../types'
import { MAX_NETWORK_RETRIES, classifySyncResult, draftStatusFor } from './syncOutcome'

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export interface SyncResult {
  successful: number
  failed: number
  remaining: number
}

export const syncManager = {
  /**
   * Save an assignment draft locally to IndexedDB ("Saved on this device")
   */
  async saveDraftLocally(
    assignmentId: string,
    studentId: string,
    courseId: string,
    assignmentTitle: string,
    content: string
  ): Promise<AssignmentDraft> {
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
    const draft: AssignmentDraft = {
      id: assignmentId,
      assignmentId,
      studentId,
      courseId,
      assignmentTitle,
      content,
      wordCount,
      savedAt: new Date().toISOString(),
      syncStatus: 'local_only',
    }

    await db.assignmentDrafts.put(draft)
    return draft
  },

  /**
   * Get draft by assignmentId
   */
  async getDraft(assignmentId: string): Promise<AssignmentDraft | undefined> {
    return db.assignmentDrafts.get(assignmentId)
  },

  /**
   * The server refused an online submission (deadline passed, conflict...). Persist the student's text together
   * with that refusal so it survives a reload and is never mistaken for a pending or confirmed submission.
   */
  async recordRefusal(
    assignmentId: string,
    studentId: string,
    courseId: string,
    assignmentTitle: string,
    content: string,
    status: 'expired' | 'conflict' | 'rejected',
    message?: string
  ): Promise<AssignmentDraft> {
    const draft = await this.saveDraftLocally(assignmentId, studentId, courseId, assignmentTitle, content)
    draft.syncStatus = status
    draft.syncMessage = message
    await db.assignmentDrafts.put(draft)
    return draft
  },

  /**
   * Enqueue an assignment submission for synchronization
   */
  async enqueueSubmission(
    assignmentId: string,
    studentId: string,
    courseId: string,
    assignmentTitle: string,
    content: string
  ): Promise<{ draft: AssignmentDraft; operation: SyncOperation }> {
    const idempotencyKey = `sub-${assignmentId}-${studentId}-${generateUUID()}`
    const operationId = generateUUID()

    // 1. Update draft status to pending_sync
    const draft = await this.saveDraftLocally(
      assignmentId,
      studentId,
      courseId,
      assignmentTitle,
      content
    )
    draft.syncStatus = 'pending_sync'
    await db.assignmentDrafts.put(draft)

    // 2. Check if there's already a pending operation for this assignment
    // (an operation that only failed on the network is reused; one the server refused gets a fresh id)
    const existingOp = await db.syncOperations
      .filter((op) => op.entityId === assignmentId && (op.status === 'pending' || (op.status === 'failed' && op.outcome === 'network')))
      .first()

    let operation: SyncOperation

    if (existingOp) {
      existingOp.payload = { content }
      existingOp.status = 'pending'
      existingOp.outcome = undefined
      existingOp.retryCount = 0
      await db.syncOperations.put(existingOp)
      operation = existingOp
    } else {
      operation = {
        id: operationId,
        operationType: 'submit_assignment',
        entityId: assignmentId,
        payload: { content },
        status: 'pending',
        idempotencyKey,
        createdAt: new Date().toISOString(),
        retryCount: 0,
      }
      await db.syncOperations.put(operation)
    }

    return { draft, operation }
  },

  /**
   * Get count of pending sync operations
   */
  async getPendingCount(): Promise<number> {
    return db.syncOperations.filter((op) => op.status === 'pending' || op.status === 'failed').count()
  },

  /**
   * Get all sync operations
   */
  async getAllOperations(): Promise<SyncOperation[]> {
    return db.syncOperations.toArray()
  },

  /**
   * Process all pending synchronization operations against the backend
   */
  async processQueue(): Promise<SyncResult> {
    // Retry what can still succeed: queued operations and network failures. A submission the server has
    // already refused (deadline passed, conflict...) would only be refused again, so it is not resent.
    const pendingOps = await db.syncOperations
      .filter((op) => op.status === 'pending' || (op.status === 'failed' && op.outcome === 'network'))
      .toArray()

    if (pendingOps.length === 0) {
      return { successful: 0, failed: 0, remaining: 0 }
    }

    // Mark as syncing
    for (const op of pendingOps) {
      op.status = 'syncing'
      await db.syncOperations.put(op)
    }

    let successful = 0
    let failed = 0

    try {
      // The backend is idempotent on (user, operation_id): a retry after a dropped response replays the
      // original result instead of creating a second submission.
      const response = await api.syncOperations(pendingOps)

      const answered = new Set<string>()
      for (const res of response.results) {
        const op = pendingOps.find((o) => o.id === res.operation_id)
        if (!op) continue
        answered.add(op.id)
        const outcome = classifySyncResult(res)

        if (outcome === 'confirmed') {
          successful++
          // Only now - after server confirmation - is the draft considered submitted.
          if (op.operationType === 'submit_assignment') {
            const draft = await db.assignmentDrafts.get(op.entityId)
            if (draft) {
              draft.syncStatus = 'synced'
              draft.syncMessage = undefined
              draft.lastServerSubmissionId = res.server_entity_id
              await db.assignmentDrafts.put(draft)
            }
          }
          // Remove completed operation from queue
          await db.syncOperations.delete(op.id)
        } else {
          // The server answered and refused: a final, distinct state (never "synced", never retried).
          failed++
          op.status = 'failed'
          op.outcome = outcome
          op.errorCode = res.error_code
          op.retryCount = (op.retryCount || 0) + 1
          op.lastError = res.message || res.error_code
          await db.syncOperations.put(op)
          if (op.operationType === 'submit_assignment') {
            const draft = await db.assignmentDrafts.get(op.entityId)
            if (draft) {
              draft.syncStatus = draftStatusFor(outcome)
              draft.syncMessage = op.lastError
              await db.assignmentDrafts.put(draft)
            }
          }
        }
      }
      // Anything the server did not answer for is still unsent: back to the queue, not stuck in "syncing".
      for (const op of pendingOps) {
        if (!answered.has(op.id)) {
          op.status = 'pending'
          await db.syncOperations.put(op)
        }
      }
    } catch (err: any) {
      // Entire batch failed (connectivity drop): nothing is confirmed. It stays queued; after repeated
      // failures the draft shows "sync failed" (still retried) so the student knows it has NOT been received.
      for (const op of pendingOps) {
        op.retryCount = (op.retryCount || 0) + 1
        op.lastError = err.message || 'Network disconnected during synchronization'
        if (op.retryCount >= MAX_NETWORK_RETRIES) {
          op.status = 'failed'
          op.outcome = 'network'
          const draft = op.operationType === 'submit_assignment' ? await db.assignmentDrafts.get(op.entityId) : undefined
          if (draft && draft.syncStatus === 'pending_sync') {
            draft.syncStatus = 'sync_failed'
            draft.syncMessage = op.lastError
            await db.assignmentDrafts.put(draft)
          }
        } else {
          op.status = 'pending'
        }
        await db.syncOperations.put(op)
      }
      failed = pendingOps.length
    }

    const remaining = await this.getPendingCount()
    return { successful, failed, remaining }
  },
}
