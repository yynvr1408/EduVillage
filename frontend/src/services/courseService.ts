import { apiRequest } from './apiClient'
import { db } from '../db/db'
import type { Course, Lesson, Material } from '../types'

export const courseService = {
  async getCourses(): Promise<Course[]> {
    return apiRequest<Course[]>('/api/courses')
  },

  async getCourseById(courseId: string): Promise<Course> {
    const course = await apiRequest<Course>(`/api/courses/${courseId}`)
    // Cache lessons for offline viewing
    if (course.lessons) {
      for (const lesson of course.lessons) {
        await db.cachedLessonMetadata.put({
          id: lesson.id,
          courseId: course.id,
          title: lesson.title,
          updatedAt: new Date().toISOString(),
          payload: lesson,
        }).catch(() => {})
      }
    }
    return course
  },

  async createCourse(data: { title: string; code: string; description?: string }): Promise<Course> {
    return apiRequest<Course>('/api/courses', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async createLesson(courseId: string, data: {
    title: string
    description?: string
    order_index: number
    content?: string
    offline_ready?: boolean
  }): Promise<Lesson> {
    return apiRequest<Lesson>(`/api/courses/${courseId}/lessons`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async getLessonById(lessonId: string): Promise<Lesson> {
    try {
      const lesson = await apiRequest<Lesson>(`/api/lessons/${lessonId}`)
      // Update local cache
      await db.cachedLessonMetadata.put({
        id: lesson.id,
        courseId: lesson.course_id,
        title: lesson.title,
        updatedAt: new Date().toISOString(),
        payload: lesson,
      }).catch(() => {})
      return lesson
    } catch (err) {
      // Offline fallback: check Dexie cache
      const cached = await db.cachedLessonMetadata.get(lessonId)
      if (cached?.payload) {
        return cached.payload
      }
      throw err
    }
  },

  async getLessonAssets(lessonId: string): Promise<Material[]> {
    return apiRequest<Material[]>(`/api/lessons/${lessonId}/assets`)
  },
}
