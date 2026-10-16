import { api } from './apiClient'
import { db } from '../db/db'
import type { Course, CourseEnrollment, Lesson, Material } from '../types'

export interface ProposedLesson {
  title: string
  content: string | null
}

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

  /** Teacher-only: the real course roster (name/email/branch/section from the backend). */
  async getEnrollments(courseId: string): Promise<CourseEnrollment[]> {
    return api.getEnrollments(courseId)
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
  }): Promise<Course> {
    return api.createCourse(data)
  },

  async updateCourse(
    id: string,
    data: { title?: string; description?: string; code?: string; status?: 'draft' | 'published' }
  ): Promise<Course> {
    return api.updateCourse(id, data)
  },

  /** Permanently deletes an empty course; archives (keeps, never destroys) one with real
   * activity. force=true permanently deletes an already-archived course regardless of history. */
  async deleteCourse(id: string, force: boolean = false): Promise<{ deleted: boolean; course: Course | null }> {
    return api.deleteCourse(id, force)
  },

  /** Proposes lessons from pasted text. Saves nothing. */
  async previewSyllabusText(courseId: string, text: string): Promise<ProposedLesson[]> {
    return api.previewSyllabusText(courseId, text)
  },

  /** Proposes lessons from a syllabus PDF (text PDFs). Saves nothing. */
  async previewSyllabusPdf(courseId: string, file: File): Promise<ProposedLesson[]> {
    return api.previewSyllabusPdf(courseId, file)
  },

  /** Creates the confirmed lessons in one transaction; resolves to how many were added. */
  async createLessonsBulk(courseId: string, lessons: ProposedLesson[]): Promise<number> {
    return api.createLessonsBulk(courseId, lessons)
  },

  /** Archives (hides from the catalogue, deletes nothing). Reversible with restoreCourse. */
  async archiveCourse(id: string): Promise<Course> {
    return api.archiveCourse(id)
  },

  /** Reverts an archive. */
  async restoreCourse(id: string): Promise<Course> {
    return api.restoreCourse(id)
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
