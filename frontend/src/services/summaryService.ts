import { api } from './apiClient'
import { db } from '../db/db'
import { downloadManager } from './downloadManager'
import type { Summary } from '../types'

export const summaryService = {
  async getClassSummary(classId: string): Promise<Summary> {
    try {
      const summary = await api.getClassSummary(classId)
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
      // Offline fallback: a summary the student explicitly saved, then the passively cached copy
      const saved = await downloadManager.getDownloadedSummaryForClass(classId)
      if (saved?.payload) return saved.payload
      const cached = await db.cachedSummaries.get(classId)
      if (cached?.payload) {
        return cached.payload
      }
      throw err
    }
  },

  async listSummaries(): Promise<Summary[]> {
    return api.getSummaries()
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
    return api.reviewSummary(summaryId, data)
  },

  async createSummaryJob(classId: string, transcriptText?: string): Promise<{ job_id: string; status: string }> {
    return api.createSummaryJob(classId, transcriptText)
  },

  getJobStatus(jobId: string) {
    return api.getJobStatus(jobId)
  },
}
