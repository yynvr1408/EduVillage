import { api, ApiError } from './apiClient'
import type { Assignment, Submission, SubmissionAttachment } from '../types'

export const assignmentService = {
  listAttachments(assignmentId: string): Promise<SubmissionAttachment[]> {
    return api.listAttachments(assignmentId)
  },

  /** Uploads a PDF / Word file (init, upload to storage, server check). Needs a connection. */
  uploadAttachment(assignmentId: string, file: File): Promise<SubmissionAttachment> {
    return api.uploadAttachment(assignmentId, file)
  },

  deleteAttachment(assignmentId: string, attachmentId: string): Promise<void> {
    return api.deleteAttachment(assignmentId, attachmentId)
  },

  attachmentDownloadUrl(assignmentId: string, attachmentId: string): string {
    return api.attachmentDownloadUrl(assignmentId, attachmentId)
  },

  getAssignments(courseId?: string): Promise<Assignment[]> {
    return api.getAssignments(courseId)
  },

  getAssignmentById(assignmentId: string): Promise<Assignment> {
    return api.getAssignment(assignmentId)
  },

  createAssignment(data: {
    course_id: string
    title: string
    instructions: string
    due_date: string
    max_score?: number
  }): Promise<Assignment> {
    return api.createAssignment(data)
  },

  /**
   * Online submission goes through the same idempotent sync endpoint the offline queue uses, so a
   * retry of the same idempotencyKey can never create a second submission. Resolves only when the
   * server has accepted it; a server-side refusal throws (it is NOT a connectivity problem).
   */
  async submitAssignment(assignmentId: string, content: string, idempotencyKey: string): Promise<{ submissionId: string }> {
    const { results } = await api.syncOperations([
      {
        id: idempotencyKey,
        operationType: 'submit_assignment',
        entityId: assignmentId,
        payload: { content },
        status: 'syncing',
        idempotencyKey,
        createdAt: new Date().toISOString(),
        retryCount: 0,
      },
    ])
    const result = results[0]
    if (!result || result.status !== 'accepted') {
      throw new ApiError(result?.message || 'The server did not accept this submission.', 409, false, result?.error_code)
    }
    return { submissionId: result.server_entity_id ?? '' }
  },

  gradeSubmission(assignmentId: string, submissionId: string, score: number, feedback: string): Promise<Submission> {
    return api.gradeSubmission(assignmentId, submissionId, score, feedback)
  },

  getSubmissions(assignmentId: string): Promise<Submission[]> {
    return api.getSubmissions(assignmentId)
  },
}
