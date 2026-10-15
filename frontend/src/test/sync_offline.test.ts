import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../db/db'
import { syncManager } from '../services/syncManager'
import * as apiClient from '../services/apiClient'

describe('Offline-First Architecture & IndexedDB Sync', () => {
  beforeEach(async () => {
    await db.assignmentDrafts.clear()
    await db.syncOperations.clear()
    await db.downloadedResources.clear()
    vi.restoreAllMocks()
  })

  it('saves an assignment draft locally to IndexedDB with "local_only" status', async () => {
    const draft = await syncManager.saveDraftLocally(
      'asg-1',
      'student-1',
      'course-1',
      'Solar Sizing Calculation',
      'Draft step 1: Daily kilowatt hours = 4.5 kWh.'
    )

    expect(draft.id).toBe('asg-1')
    expect(draft.syncStatus).toBe('local_only')
    expect(draft.wordCount).toBe(9)

    // Retrieve directly from Dexie table to prove persistence
    const saved = await db.assignmentDrafts.get('asg-1')
    expect(saved).toBeDefined()
    expect(saved?.content).toContain('4.5 kWh')
  })

  it('preserves assignment drafts across simulated reload', async () => {
    await syncManager.saveDraftLocally(
      'asg-persist-test',
      'student-1',
      'course-1',
      'Persisted Assignment',
      'Content that must survive page refreshes and offline periods.'
    )

    // Simulate reload by fetching from a fresh query
    const reloaded = await syncManager.getDraft('asg-persist-test')
    expect(reloaded).toBeDefined()
    expect(reloaded?.content).toBe(
      'Content that must survive page refreshes and offline periods.'
    )
  })

  it('enqueues submission with a unique idempotency key preventing duplicate queueing', async () => {
    const { draft, operation } = await syncManager.enqueueSubmission(
      'asg-queue-test',
      'student-1',
      'course-1',
      'Queue Test',
      'Final answer response.'
    )

    expect(draft.syncStatus).toBe('pending_sync')
    expect(operation.status).toBe('pending')
    expect(operation.idempotencyKey).toMatch(/^sub-asg-queue-test-student-1-/)

    // Queue count should be 1
    const count = await syncManager.getPendingCount()
    expect(count).toBe(1)

    // Enqueueing again for the same assignment should update the existing pending operation, preventing duplicates
    const secondCall = await syncManager.enqueueSubmission(
      'asg-queue-test',
      'student-1',
      'course-1',
      'Queue Test',
      'Updated final answer response.'
    )

    const updatedCount = await syncManager.getPendingCount()
    expect(updatedCount).toBe(1)
    expect(secondCall.operation.payload.content).toBe('Updated final answer response.')
  })

  it('processes pending operations successfully and updates draft to "synced"', async () => {
    // Seed pending submission
    await syncManager.enqueueSubmission(
      'asg-sync-success',
      'student-1',
      'course-1',
      'Sync Success Assignment',
      'Ready to submit.'
    )

    // Mock API client response for batch sync
    vi.spyOn(apiClient, 'apiRequest').mockResolvedValueOnce({
      processed_count: 1,
      results: [
        {
          operation_id: (await db.syncOperations.toCollection().first())!.id,
          idempotency_key: 'test-key',
          status: 'SUCCESS',
          message: 'Confirmed',
          server_entity_id: 'sub-server-999',
        },
      ],
    })

    const result = await syncManager.processQueue()
    expect(result.successful).toBe(1)
    expect(result.failed).toBe(0)

    // Operation removed from pending queue
    const remainingCount = await syncManager.getPendingCount()
    expect(remainingCount).toBe(0)

    // Draft updated to synced
    const draft = await db.assignmentDrafts.get('asg-sync-success')
    expect(draft?.syncStatus).toBe('synced')
    expect(draft?.lastServerSubmissionId).toBe('sub-server-999')
  })
})
