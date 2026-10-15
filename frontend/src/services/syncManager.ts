import { db } from '../db/db'
import { apiRequest } from './apiClient'
import type { AssignmentDraft, SyncOperation } from '../types'

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
    const existingOp = await db.syncOperations
      .filter((op) => op.entityId === assignmentId && op.status === 'pending')
      .first()

    let operation: SyncOperation

    if (existingOp) {
      existingOp.payload = { content }
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
    const pendingOps = await db.syncOperations
      .filter((op) => op.status === 'pending' || op.status === 'failed')
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
      // Build batch request
      const batchPayload = {
        operations: pendingOps.map((op) => ({
          operation_id: op.id,
          idempotency_key: op.idempotencyKey,
          operation_type: op.operationType,
          entity_id: op.entityId,
          payload: op.payload,
          timestamp: op.createdAt,
        })),
      }

      const response = await apiRequest<{
        processed_count: number
        results: Array<{
          operation_id: string
          idempotency_key: string
          status: string
          message: string
          server_entity_id?: string
        }>
      }>('/api/sync/operations', {
        method: 'POST',
        body: JSON.stringify(batchPayload),
      })

      for (const res of response.results) {
        const op = pendingOps.find((o) => o.id === res.operation_id)
        if (!op) continue

        if (res.status === 'SUCCESS') {
          successful++
          // Update corresponding draft
          if (op.operationType === 'submit_assignment') {
            const draft = await db.assignmentDrafts.get(op.entityId)
            if (draft) {
              draft.syncStatus = 'synced'
              draft.lastServerSubmissionId = res.server_entity_id
              await db.assignmentDrafts.put(draft)
            }
          }
          // Remove completed operation from queue
          await db.syncOperations.delete(op.id)
        } else {
          failed++
          op.status = 'failed'
          op.retryCount = (op.retryCount || 0) + 1
          op.lastError = res.message
          await db.syncOperations.put(op)
        }
      }
    } catch (err: any) {
      // Entire batch failed due to network / connectivity drop
      for (const op of pendingOps) {
        op.status = 'pending'
        op.lastError = err.message || 'Network disconnected during synchronization'
        await db.syncOperations.put(op)
      }
      failed = pendingOps.length
    }

    const remaining = await this.getPendingCount()
    return { successful, failed, remaining }
  },
}
