import { api } from './apiClient'
import type { ClassParticipant, ClassRoom, JoinTokenResponse } from '../types'

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

  cancelClass(classId: string): Promise<ClassRoom> {
    return api.cancelClass(classId)
  },

  getJoinToken(classId: string): Promise<JoinTokenResponse> {
    return api.getJoinToken(classId)
  },

  getParticipants(classId: string): Promise<ClassParticipant[]> {
    return api.getParticipants(classId)
  },

  removeParticipant(classId: string, studentId: string): Promise<void> {
    return api.removeParticipant(classId, studentId)
  },

  requestToSpeak(classId: string): Promise<void> {
    return api.requestToSpeak(classId)
  },

  grantMic(classId: string, studentId: string): Promise<void> {
    return api.grantMic(classId, studentId)
  },

  revokeMic(classId: string, studentId: string): Promise<void> {
    return api.revokeMic(classId, studentId)
  },
}
