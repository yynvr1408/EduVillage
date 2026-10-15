import { apiRequest } from './apiClient'
import { db } from '../db/db'
import type { Summary } from '../types'

export const summaryService = {
  async getClassSummary(classId: string): Promise<Summary> {
    try {
      const summary = await apiRequest<Summary>(`/api/classes/${classId}/summary`)
      // Cache summary in Dexie
      await db.cachedSummaries.put({
        classId: summary.class_id,
        courseId: summary.course_id,
        status: summary.status,
        reviewStatus: summary.review_status,
        updatedAt: new Date().toISOString(),
        payload: summary,
      }).catch(() => {})
      return summary
    } catch (err) {
      // Offline fallback: try reading cached summary
      const cached = await db.cachedSummaries.get(classId)
      if (cached?.payload) {
        return cached.payload
      }
      throw err
    }
  },

  async listSummaries(): Promise<Summary[]> {
    return apiRequest<Summary[]>('/api/summaries')
  },

  async reviewSummary(
    summaryId: string,
    data: {
      action: 'APPROVE' | 'REVISE'
      teacher_notes?: string
      overview?: string
      key_concepts?: string[]
      revision_questions?: string[]
    }
  ): Promise<Summary> {
    return apiRequest<Summary>(`/api/summaries/${summaryId}/review`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async createSummaryJob(classId: string): Promise<{ job_id: string; status: string }> {
    return apiRequest<{ job_id: string; status: string }>(`/api/classes/${classId}/summary-jobs`, {
      method: 'POST',
    })
  },
}
