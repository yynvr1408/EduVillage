import { api } from './apiClient'
import { db } from '../db/db'
import type { Course, Lesson, Material } from '../types'

export const courseService = {
  async getCourses(): Promise<Course[]> {
    return api.getCourses()
  },

  getCatalog(): Promise<Course[]> {
    return api.getCourseCatalog()
  },

  async enroll(courseId: string): Promise<void> {
    await api.enroll(courseId)
  },

  async getCourseById(courseId: string): Promise<Course> {
    const course = await api.getCourse(courseId)
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

  async createCourse(data: {
    title: string
    code: string
    description?: string
    grade_level?: string
    language?: string
    institution?: string
    region?: string
  }): Promise<Course> {
    return api.createCourse(data)
  },

  async updateCourse(
    id: string,
    data: { title?: string; description?: string; code?: string; status?: 'draft' | 'published' }
  ): Promise<Course> {
    return api.updateCourse(id, data)
  },

  async archiveCourse(id: string): Promise<Course> {
    return api.archiveCourse(id)
  },

  async createLesson(courseId: string, data: {
    title: string
    description?: string
    order_index: number
    content?: string
    offline_ready?: boolean
  }): Promise<Lesson> {
    return api.createLesson(courseId, data)
  },

  async getLessonById(lessonId: string): Promise<Lesson> {
    try {
      const lesson = await api.getLesson(lessonId)
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
    return api.getLessonAssets(lessonId)
  },
}
