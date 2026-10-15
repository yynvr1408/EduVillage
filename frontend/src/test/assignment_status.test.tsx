import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../db/db'
import { syncManager } from '../services/syncManager'
import * as apiClient from '../services/apiClient'
import { classifySyncResult, draftStatusFor } from '../services/syncOutcome'
import { assignmentService } from '../services/assignmentService'
import { OfflineDraftEditor } from '../components/assignment/OfflineDraftEditor'
import type { Assignment } from '../types'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'student-1', role: 'student', full_name: 'A', email: 'a@b.c' } }) }))
vi.mock('../context/NetworkContext', () => ({ useNetworkStatus: () => ({ isOnline: true, isBrowserOnline: true, isServerReachable: true }) }))
vi.mock('../context/SyncContext', () => ({ useSync: () => ({ refreshQueue: async () => {} }) }))

const result = (over: Record<string, unknown>) => ({ operation_id: 'x', status: 'accepted', ...over })

async function enqueue(id = 'asg-1') {
  const { operation } = await syncManager.enqueueSubmission(id, 'student-1', 'c1', 'Quiz', 'My answer')
  return operation
}

beforeEach(async () => {
  await Promise.all([db.syncOperations.clear(), db.assignmentDrafts.clear()])
  vi.restoreAllMocks()
})
afterEach(() => vi.restoreAllMocks())

describe('classifying what the server answered', () => {
  it('maps every answer to exactly one distinct state', () => {
    expect(classifySyncResult({ status: 'accepted' })).toBe('confirmed')
    expect(classifySyncResult({ status: 'conflict', error_code: 'ASSIGNMENT_EXPIRED' })).toBe('expired')
    expect(classifySyncResult({ status: 'conflict', error_code: 'ASSIGNMENT_CLOSED' })).toBe('closed')
    expect(classifySyncResult({ status: 'conflict', error_code: 'OPERATION_ID_REUSED' })).toBe('conflict')
    expect(classifySyncResult({ status: 'rejected', error_code: 'FORBIDDEN' })).toBe('rejected')
    expect(draftStatusFor('closed')).toBe('expired')
  })
})

describe('sync outcomes are surfaced, never reported as confirmed', () => {
  it('marks a submission whose deadline passed as expired, keeps the work, and never retries it', async () => {
    const op = await enqueue()
    const sync = vi.spyOn(apiClient.api, 'syncOperations').mockResolvedValueOnce({
      results: [result({ operation_id: op.id, status: 'conflict', error_code: 'ASSIGNMENT_EXPIRED', message: 'The deadline has passed.' })],
    })
    const r = await syncManager.processQueue()
    expect(r.successful).toBe(0)

    const draft = await db.assignmentDrafts.get('asg-1')
    expect(draft?.syncStatus).toBe('expired')
    expect(draft?.content).toBe('My answer') // the student's work is preserved
    expect(draft?.syncMessage).toBe('The deadline has passed.')
    const stored = await db.syncOperations.get(op.id)
    expect(stored).toMatchObject({ status: 'failed', outcome: 'expired', errorCode: 'ASSIGNMENT_EXPIRED' })

    sync.mockClear()
    await syncManager.processQueue()
    expect(sync).not.toHaveBeenCalled() // a final refusal is not resent
  })

  it('distinguishes a conflict from an expiry and from a rejection', async () => {
    const a = await enqueue('asg-conflict')
    const b = await enqueue('asg-rejected')
    vi.spyOn(apiClient.api, 'syncOperations').mockResolvedValueOnce({
      results: [
        result({ operation_id: a.id, status: 'conflict', error_code: 'OPERATION_ID_REUSED', message: 'Reused id' }),
        result({ operation_id: b.id, status: 'rejected', error_code: 'FORBIDDEN', message: 'Not enrolled' }),
      ],
    })
    await syncManager.processQueue()
    expect((await db.assignmentDrafts.get('asg-conflict'))?.syncStatus).toBe('conflict')
    expect((await db.assignmentDrafts.get('asg-rejected'))?.syncStatus).toBe('rejected')
  })

  it('shows "sync failed" only after repeated network failures, keeps retrying, and confirms only when the server accepts', async () => {
    const op = await enqueue()
    const sync = vi.spyOn(apiClient.api, 'syncOperations').mockRejectedValue(new apiClient.ApiError('offline', 0, true))

    await syncManager.processQueue()
    await syncManager.processQueue()
    expect((await db.assignmentDrafts.get('asg-1'))?.syncStatus).toBe('pending_sync') // still just waiting
    expect((await db.syncOperations.get(op.id))?.status).toBe('pending')

    await syncManager.processQueue() // third consecutive failure
    expect((await db.assignmentDrafts.get('asg-1'))?.syncStatus).toBe('sync_failed')
    expect((await db.syncOperations.get(op.id))).toMatchObject({ status: 'failed', outcome: 'network' })

    // ...but it is retried when the network is back, and only THEN is it confirmed.
    sync.mockResolvedValueOnce({ results: [result({ operation_id: op.id, status: 'accepted', server_entity_id: 'sub-9' })] })
    const r = await syncManager.processQueue()
    expect(r.successful).toBe(1)
    const draft = await db.assignmentDrafts.get('asg-1')
    expect(draft).toMatchObject({ syncStatus: 'synced', lastServerSubmissionId: 'sub-9' })
    expect(await db.syncOperations.get(op.id)).toBeUndefined()
  })

  it('an operation the server did not answer for goes back to the queue instead of sticking in "syncing"', async () => {
    const op = await enqueue()
    vi.spyOn(apiClient.api, 'syncOperations').mockResolvedValueOnce({ results: [] })
    await syncManager.processQueue()
    expect((await db.syncOperations.get(op.id))?.status).toBe('pending')
    expect((await db.assignmentDrafts.get('asg-1'))?.syncStatus).toBe('pending_sync') // never "synced"
  })

  it('a fresh submission after a refusal gets a NEW operation id (the old one would just replay the refusal)', async () => {
    const first = await enqueue()
    vi.spyOn(apiClient.api, 'syncOperations').mockResolvedValueOnce({
      results: [result({ operation_id: first.id, status: 'conflict', error_code: 'ASSIGNMENT_EXPIRED' })],
    })
    await syncManager.processQueue()
    const second = await enqueue()
    expect(second.id).not.toBe(first.id)
    expect((await db.assignmentDrafts.get('asg-1'))?.syncStatus).toBe('pending_sync')
  })
})

describe('the assignment editor never shows server confirmation before the backend confirms', () => {
  const assignment: Assignment = {
    id: 'asg-1', course_id: 'c1', title: 'Quiz', instructions: 'Do it', due_date: '2026-01-01T00:00:00Z', max_score: 100, created_at: '', my_submission: null,
  }

  it('shows "Deadline passed" (not "Server Confirmed") when the server refuses an online submission as expired', async () => {
    vi.spyOn(assignmentService, 'submitAssignment').mockRejectedValue(
      new apiClient.ApiError('The deadline for this assignment has passed.', 409, false, 'ASSIGNMENT_EXPIRED')
    )
    render(<OfflineDraftEditor assignment={assignment} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my late answer' } })
    fireEvent.click(screen.getByRole('button', { name: /submit to teacher/i }))

    expect(await screen.findByText('Deadline passed')).toBeInTheDocument()
    expect(screen.queryByText('Server Confirmed')).toBeNull()
    expect(screen.getByText(/deadline for this assignment has passed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit to teacher/i })).toBeDisabled() // nothing more to submit
    expect(await db.syncOperations.count()).toBe(0) // not queued: the server will refuse it forever
  })

  it('shows "Conflict" for other server refusals, and keeps the text the student typed', async () => {
    vi.spyOn(assignmentService, 'submitAssignment').mockRejectedValue(new apiClient.ApiError('Something changed.', 409, false, 'OPERATION_ID_REUSED'))
    render(<OfflineDraftEditor assignment={assignment} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'work' } })
    fireEvent.click(screen.getByRole('button', { name: /submit to teacher/i }))
    expect(await screen.findByText('Conflict')).toBeInTheDocument()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('work')
  })

  it('queues (waiting to sync) on a network failure — and does not claim confirmation', async () => {
    vi.spyOn(assignmentService, 'submitAssignment').mockRejectedValue(new apiClient.ApiError('offline', 0, true))
    render(<OfflineDraftEditor assignment={assignment} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'offline work' } })
    fireEvent.click(screen.getByRole('button', { name: /submit to teacher/i }))
    expect(await screen.findByText('Waiting to sync')).toBeInTheDocument()
    expect(screen.queryByText('Server Confirmed')).toBeNull()
    await waitFor(async () => expect(await db.syncOperations.count()).toBe(1))
  })

  it('shows "Server Confirmed" only after the backend accepted it', async () => {
    let resolve!: (v: { submissionId: string }) => void
    vi.spyOn(assignmentService, 'submitAssignment').mockReturnValue(new Promise((r) => (resolve = r)))
    render(<OfflineDraftEditor assignment={assignment} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'answer' } })
    fireEvent.click(screen.getByRole('button', { name: /submit to teacher/i }))
    await waitFor(() => expect(assignmentService.submitAssignment).toHaveBeenCalled())
    expect(screen.queryByText('Server Confirmed')).toBeNull() // request in flight: NOT confirmed yet
    resolve({ submissionId: 'sub-1' })
    expect(await screen.findByText('Server Confirmed')).toBeInTheDocument()
  })

  it('restores an expired / sync-failed draft status when the page is reopened', async () => {
    await db.assignmentDrafts.put({
      id: 'asg-1', assignmentId: 'asg-1', studentId: 'student-1', courseId: 'c1', assignmentTitle: 'Quiz', content: 'kept', wordCount: 1,
      savedAt: new Date().toISOString(), syncStatus: 'expired', syncMessage: 'The deadline has passed.',
    })
    render(<OfflineDraftEditor assignment={assignment} />)
    expect(await screen.findByText('Deadline passed')).toBeInTheDocument()
    expect(screen.getByText('The deadline has passed.')).toBeInTheDocument()
  })
})
