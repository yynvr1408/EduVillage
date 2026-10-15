import { apiRequest } from './apiClient'
import type { Assignment, Submission } from '../types'

export const assignmentService = {
  async getAssignments(courseId?: string): Promise<Assignment[]> {
    const query = courseId ? `?course_id=${encodeURIComponent(courseId)}` : ''
    return apiRequest<Assignment[]>(`/api/assignments${query}`)
  },

  async getAssignmentById(assignmentId: string): Promise<Assignment> {
    return apiRequest<Assignment>(`/api/assignments/${assignmentId}`)
  },

  async createAssignment(data: {
    course_id: string
    title: string
    instructions: string
    due_date: string
    max_score?: number
  }): Promise<Assignment> {
    return apiRequest<Assignment>('/api/assignments', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async submitAssignment(
    assignmentId: string,
    content: string,
    idempotencyKey?: string
  ): Promise<Submission> {
    return apiRequest<Submission>(`/api/assignments/${assignmentId}/submissions`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        idempotency_key: idempotencyKey,
      }),
    })
  },

  async getSubmissions(assignmentId: string): Promise<Submission[]> {
    return apiRequest<Submission[]>(`/api/assignments/${assignmentId}/submissions`)
  },
}
