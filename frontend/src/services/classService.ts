import { api } from './apiClient'
import type { ClassRoom, JoinTokenResponse } from '../types'

export const classService = {
  getClasses(): Promise<ClassRoom[]> {
    return api.getClasses()
  },

  getClassById(classId: string): Promise<ClassRoom> {
    return api.getClass(classId)
  },

  scheduleClass(data: {
    course_id: string
    title: string
    scheduled_at: string
    section_id?: string
    all_branch_sections?: boolean
  }): Promise<ClassRoom> {
    return api.scheduleClass(data)
  },

  startClass(classId: string): Promise<ClassRoom> {
    return api.startClass(classId)
  },

  endClass(classId: string): Promise<ClassRoom> {
    return api.endClass(classId)
  },

  getJoinToken(classId: string): Promise<JoinTokenResponse> {
    return api.getJoinToken(classId)
  },
}
