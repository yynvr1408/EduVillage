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

    // Mock the server's idempotent sync response (statuses: accepted | rejected | conflict)
    vi.spyOn(apiClient.api, 'syncOperations').mockResolvedValueOnce({
      results: [
        {
          operation_id: (await db.syncOperations.toCollection().first())!.id,
          status: 'accepted',
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

describe('Server refusals stay visible instead of being treated as synced', () => {
  beforeEach(async () => {
    await db.syncOperations.clear()
    await db.assignmentDrafts.clear()
    vi.restoreAllMocks()
  })

  it('keeps a rejected/conflicting operation as failed and leaves the draft unsynced', async () => {
    await syncManager.enqueueSubmission('asg-closed', 'student-1', 'course-1', 'Closed Assignment', 'Late work.')
    const op = (await db.syncOperations.toCollection().first())!
    vi.spyOn(apiClient.api, 'syncOperations').mockResolvedValueOnce({
      results: [{ operation_id: op.id, status: 'conflict', error_code: 'ASSIGNMENT_CLOSED', message: 'This assignment is closed.' }],
    })

    const result = await syncManager.processQueue()
    expect(result.successful).toBe(0)
    expect(result.failed).toBe(1)

    const stored = await db.syncOperations.get(op.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.lastError).toBe('This assignment is closed.')
    expect((await db.assignmentDrafts.get('asg-closed'))?.syncStatus).not.toBe('synced')
  })

  it('sends the backend contract: assignment_submission with an answer object and the stable operation id', async () => {
    await syncManager.enqueueSubmission('asg-contract', 'student-1', 'course-1', 'Contract', 'My answer')
    const op = (await db.syncOperations.toCollection().first())!
    expect(apiClient.api.toServerOperation(op)).toMatchObject({
      operation_id: op.id,
      operation_type: 'assignment_submission',
      entity_id: 'asg-contract',
      payload: { answer: { text: 'My answer' } },
    })
  })
})
