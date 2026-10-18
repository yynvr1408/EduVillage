import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ProtectedRoute } from './ProtectedRoute'
import { StudentLayout } from '../components/layout/StudentLayout'
import { TeacherLayout } from '../components/layout/TeacherLayout'

// Auth Pages
import { LoginPage } from '../pages/auth/LoginPage'
import { LoginChoicePage } from '../pages/auth/LoginChoicePage'
import { RegisterPage } from '../pages/auth/RegisterPage'
import { RegisterChoicePage } from '../pages/auth/RegisterChoicePage'
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage'
import { VerifyOtpPage } from '../pages/auth/VerifyOtpPage'
import { ResetPasswordPage } from '../pages/auth/ResetPasswordPage'

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
import { OfflineViewerPage } from '../pages/student/OfflineViewerPage'
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
import { TeacherInstitutionAdminPage } from '../pages/teacher/TeacherInstitutionAdminPage'

// Real-Time Classroom
import { ClassroomPage } from '../pages/classroom/ClassroomPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { AdminApp } from '../pages/admin/AdminApp'

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
      <Route path="/login" element={<LoginChoicePage />} />
      <Route path="/login/student" element={<LoginPage portal="student" />} />
      <Route path="/login/teacher" element={<LoginPage portal="teacher" />} />
      <Route path="/register" element={<RegisterChoicePage />} />
      <Route path="/register/student" element={<RegisterPage portal="student" />} />
      <Route path="/register/teacher" element={<RegisterPage portal="teacher" />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/verify-otp" element={<VerifyOtpPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

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
        <Route path="downloads/:resourceId" element={<OfflineViewerPage />} />
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
        <Route path="institution" element={<TeacherInstitutionAdminPage />} />
        <Route path="profile" element={<TeacherProfilePage />} />
      </Route>

      {/* Admin panel: outside the student/teacher guards; access is enforced by the backend session, not the
          URL. The path itself is just not a guessable word like "admin" — kept off public nav/links too, so
          it isn't discoverable by Browse, only by whoever's told the URL. */}
      <Route path="/platform-console" element={<AdminApp />} />

      {/* 404 Catch-All */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
