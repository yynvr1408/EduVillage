/**
 * What the server actually answered for a queued submission. Only `confirmed` means the backend
 * persisted it; every other outcome is a distinct, non-confirmed state the UI must show honestly.
 */
export type SyncOutcome = 'confirmed' | 'expired' | 'closed' | 'conflict' | 'rejected'

/** Draft states the server decided (final: retrying would get the same answer). */
export type TerminalDraftStatus = 'expired' | 'conflict' | 'rejected'

export function classifySyncResult(result: { status: string; error_code?: string }): SyncOutcome {
  if (result.status === 'accepted') return 'confirmed'
  if (result.error_code === 'SUBMISSION_EXPIRED') return 'expired'
  if (result.error_code === 'ASSIGNMENT_CLOSED') return 'closed'
  if (result.status === 'conflict') return 'conflict'
  return 'rejected'
}

/** A closed assignment is, to the student, the same as a passed deadline. */
export function draftStatusFor(outcome: Exclude<SyncOutcome, 'confirmed'>): TerminalDraftStatus {
  return outcome === 'closed' ? 'expired' : outcome
}

/** Consecutive whole-batch network failures before the UI says "sync failed" (the operation is still retried). */
export const MAX_NETWORK_RETRIES = 3
