import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ProtectedRoute } from './ProtectedRoute'
import { StudentLayout } from '../components/layout/StudentLayout'
import { TeacherLayout } from '../components/layout/TeacherLayout'

// Auth Pages
import { LoginPage } from '../pages/auth/LoginPage'
import { RegisterPage } from '../pages/auth/RegisterPage'
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage'

// Student Pages
import { StudentDashboard } from '../pages/student/StudentDashboard'
import { StudentCoursesPage } from '../pages/student/StudentCoursesPage'
import { StudentCourseDetailPage } from '../pages/student/StudentCourseDetailPage'
import { StudentLessonPage } from '../pages/student/StudentLessonPage'
import { StudentClassesPage } from '../pages/student/StudentClassesPage'
import { StudentClassSummaryPage } from '../pages/student/StudentClassSummaryPage'
import { StudentAssignmentsPage } from '../pages/student/StudentAssignmentsPage'
import { StudentAssignmentDetailPage } from '../pages/student/StudentAssignmentDetailPage'
import { StudentDownloadsPage } from '../pages/student/StudentDownloadsPage'
import { StudentProfilePage } from '../pages/student/StudentProfilePage'
import { StudentRecordedLessonsPage } from '../pages/student/StudentRecordedLessonsPage'
import { StudentRecordedLessonDetailPage } from '../pages/student/StudentRecordedLessonDetailPage'

// Teacher Pages
import { TeacherDashboard } from '../pages/teacher/TeacherDashboard'
import { TeacherCoursesPage } from '../pages/teacher/TeacherCoursesPage'
import { TeacherCreateCoursePage } from '../pages/teacher/TeacherCreateCoursePage'
import { TeacherManageCoursePage } from '../pages/teacher/TeacherManageCoursePage'
import { TeacherClassesPage } from '../pages/teacher/TeacherClassesPage'
import { TeacherCreateClassPage } from '../pages/teacher/TeacherCreateClassPage'
import { TeacherRecordedLessonsPage } from '../pages/teacher/TeacherRecordedLessonsPage'
import { TeacherMaterialsPage } from '../pages/teacher/TeacherMaterialsPage'
import { TeacherAssignmentsPage } from '../pages/teacher/TeacherAssignmentsPage'
import { TeacherSummariesPage } from '../pages/teacher/TeacherSummariesPage'
import { TeacherProfilePage } from '../pages/teacher/TeacherProfilePage'

// Real-Time Classroom
import { ClassroomPage } from '../pages/classroom/ClassroomPage'
import { NotFoundPage } from '../pages/NotFoundPage'

export const AppRoutes: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth()

  // Root redirect logic
  const renderRootRedirect = () => {
    if (isLoading) return null
    if (!isAuthenticated || !user) return <Navigate to="/login" replace />
    return <Navigate to={user.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard'} replace />
  }

  return (
    <Routes>
      {/* Root */}
      <Route path="/" element={renderRootRedirect()} />

      {/* Public Authentication Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      {/* Real-time Classroom Route (Shared, Role-Scoped) */}
      <Route
        path="/classroom/:classId"
        element={
          <ProtectedRoute>
            <ClassroomPage />
          </ProtectedRoute>
        }
      />

      {/* Student Protected Portal */}
      <Route
        path="/student"
        element={
          <ProtectedRoute allowedRoles={['student']}>
            <StudentLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/student/dashboard" replace />} />
        <Route path="dashboard" element={<StudentDashboard />} />
        <Route path="courses" element={<StudentCoursesPage />} />
        <Route path="courses/:courseId" element={<StudentCourseDetailPage />} />
        <Route path="lessons/:lessonId" element={<StudentLessonPage />} />
        <Route path="classes" element={<StudentClassesPage />} />
        <Route path="classes/:classId" element={<StudentClassesPage />} />
        <Route path="classes/:classId/summary" element={<StudentClassSummaryPage />} />
        <Route path="recorded-lessons" element={<StudentRecordedLessonsPage />} />
        <Route path="recorded-lessons/:recordingId" element={<StudentRecordedLessonDetailPage />} />
        <Route path="assignments" element={<StudentAssignmentsPage />} />
        <Route path="assignments/:assignmentId" element={<StudentAssignmentDetailPage />} />
        <Route path="downloads" element={<StudentDownloadsPage />} />
        <Route path="profile" element={<StudentProfilePage />} />
      </Route>

      {/* Teacher Protected Console */}
      <Route
        path="/teacher"
        element={
          <ProtectedRoute allowedRoles={['teacher']}>
            <TeacherLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/teacher/dashboard" replace />} />
        <Route path="dashboard" element={<TeacherDashboard />} />
        <Route path="courses" element={<TeacherCoursesPage />} />
        <Route path="courses/new" element={<TeacherCreateCoursePage />} />
        <Route path="courses/:courseId/manage" element={<TeacherManageCoursePage />} />
        <Route path="classes" element={<TeacherClassesPage />} />
        <Route path="classes/new" element={<TeacherCreateClassPage />} />
        <Route path="recorded-lessons" element={<TeacherRecordedLessonsPage />} />
        <Route path="recorded-lessons/:recordingId" element={<StudentRecordedLessonDetailPage />} />
        <Route path="materials" element={<TeacherMaterialsPage />} />
        <Route path="assignments" element={<TeacherAssignmentsPage />} />
        <Route path="summaries" element={<TeacherSummariesPage />} />
        <Route path="profile" element={<TeacherProfilePage />} />
      </Route>

      {/* 404 Catch-All */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
