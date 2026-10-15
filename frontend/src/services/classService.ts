import { apiRequest } from './apiClient'
import type { ClassRoom, JoinTokenResponse } from '../types'

export const classService = {
  async getClasses(): Promise<ClassRoom[]> {
    return apiRequest<ClassRoom[]>('/api/classes')
  },

  async getClassById(classId: string): Promise<ClassRoom> {
    return apiRequest<ClassRoom>(`/api/classes/${classId}`)
  },

  async scheduleClass(data: {
    course_id: string
    title: string
    scheduled_at: string
    section_id?: string
  }): Promise<ClassRoom> {
    return apiRequest<ClassRoom>('/api/classes', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async startClass(classId: string): Promise<ClassRoom> {
    return apiRequest<ClassRoom>(`/api/classes/${classId}/start`, {
      method: 'POST',
    })
  },

  async endClass(classId: string): Promise<ClassRoom> {
    return apiRequest<ClassRoom>(`/api/classes/${classId}/end`, {
      method: 'POST',
    })
  },

  async getJoinToken(classId: string): Promise<JoinTokenResponse> {
    return apiRequest<JoinTokenResponse>(`/api/classes/${classId}/join-token`, {
      method: 'POST',
    })
  },
}
