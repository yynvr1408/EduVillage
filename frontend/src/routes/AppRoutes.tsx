import React, { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ProtectedRoute } from './ProtectedRoute'
import { StudentLayout } from '../components/layout/StudentLayout'
import { TeacherLayout } from '../components/layout/TeacherLayout'
import { LoadingState } from '../components/ui/LoadingState'

/** Route-based code splitting: each page ships as its own chunk, fetched only when a user
 * actually navigates to it, instead of one ~1.4 MB bundle every visitor downloads up front
 * regardless of role. The service worker's precache (vite.config.ts globPatterns) still picks
 * up every chunk by glob, so an installed PWA keeps working fully offline exactly as before —
 * this only changes the cost of the first, uncached visit. All of these are named exports, so
 * React.lazy (which wants a default export) goes through this small helper instead. */
function lazyPage<K extends string>(factory: () => Promise<Record<K, React.ComponentType<any>>>, key: K) {
  return React.lazy(() => factory().then((m) => ({ default: m[key] })))
}

// Auth Pages
const LoginPage = lazyPage(() => import('../pages/auth/LoginPage'), 'LoginPage')
const LoginChoicePage = lazyPage(() => import('../pages/auth/LoginChoicePage'), 'LoginChoicePage')
const RegisterPage = lazyPage(() => import('../pages/auth/RegisterPage'), 'RegisterPage')
const RegisterChoicePage = lazyPage(() => import('../pages/auth/RegisterChoicePage'), 'RegisterChoicePage')
const CollegeRegisterPage = lazyPage(() => import('../pages/auth/CollegeRegisterPage'), 'CollegeRegisterPage')
const ForgotPasswordPage = lazyPage(() => import('../pages/auth/ForgotPasswordPage'), 'ForgotPasswordPage')
const VerifyOtpPage = lazyPage(() => import('../pages/auth/VerifyOtpPage'), 'VerifyOtpPage')
const ResetPasswordPage = lazyPage(() => import('../pages/auth/ResetPasswordPage'), 'ResetPasswordPage')

// Student Pages
const StudentDashboard = lazyPage(() => import('../pages/student/StudentDashboard'), 'StudentDashboard')
const StudentCoursesPage = lazyPage(() => import('../pages/student/StudentCoursesPage'), 'StudentCoursesPage')
const StudentCourseDetailPage = lazyPage(() => import('../pages/student/StudentCourseDetailPage'), 'StudentCourseDetailPage')
const StudentLessonPage = lazyPage(() => import('../pages/student/StudentLessonPage'), 'StudentLessonPage')
const StudentClassesPage = lazyPage(() => import('../pages/student/StudentClassesPage'), 'StudentClassesPage')
const StudentClassSummaryPage = lazyPage(() => import('../pages/student/StudentClassSummaryPage'), 'StudentClassSummaryPage')
const StudentAssignmentsPage = lazyPage(() => import('../pages/student/StudentAssignmentsPage'), 'StudentAssignmentsPage')
const StudentAssignmentDetailPage = lazyPage(() => import('../pages/student/StudentAssignmentDetailPage'), 'StudentAssignmentDetailPage')
const StudentDownloadsPage = lazyPage(() => import('../pages/student/StudentDownloadsPage'), 'StudentDownloadsPage')
const OfflineViewerPage = lazyPage(() => import('../pages/student/OfflineViewerPage'), 'OfflineViewerPage')
const StudentProfilePage = lazyPage(() => import('../pages/student/StudentProfilePage'), 'StudentProfilePage')
const StudentRecordedLessonsPage = lazyPage(() => import('../pages/student/StudentRecordedLessonsPage'), 'StudentRecordedLessonsPage')
const StudentRecordedLessonDetailPage = lazyPage(
  () => import('../pages/student/StudentRecordedLessonDetailPage'),
  'StudentRecordedLessonDetailPage',
)

// Teacher Pages
const TeacherDashboard = lazyPage(() => import('../pages/teacher/TeacherDashboard'), 'TeacherDashboard')
const TeacherCoursesPage = lazyPage(() => import('../pages/teacher/TeacherCoursesPage'), 'TeacherCoursesPage')
const TeacherCreateCoursePage = lazyPage(() => import('../pages/teacher/TeacherCreateCoursePage'), 'TeacherCreateCoursePage')
const TeacherManageCoursePage = lazyPage(() => import('../pages/teacher/TeacherManageCoursePage'), 'TeacherManageCoursePage')
const TeacherClassesPage = lazyPage(() => import('../pages/teacher/TeacherClassesPage'), 'TeacherClassesPage')
const TeacherCreateClassPage = lazyPage(() => import('../pages/teacher/TeacherCreateClassPage'), 'TeacherCreateClassPage')
const TeacherRecordedLessonsPage = lazyPage(() => import('../pages/teacher/TeacherRecordedLessonsPage'), 'TeacherRecordedLessonsPage')
const TeacherMaterialsPage = lazyPage(() => import('../pages/teacher/TeacherMaterialsPage'), 'TeacherMaterialsPage')
const TeacherAssignmentsPage = lazyPage(() => import('../pages/teacher/TeacherAssignmentsPage'), 'TeacherAssignmentsPage')
const TeacherSummariesPage = lazyPage(() => import('../pages/teacher/TeacherSummariesPage'), 'TeacherSummariesPage')
const TeacherSummaryDetailPage = lazyPage(() => import('../pages/teacher/TeacherSummaryDetailPage'), 'TeacherSummaryDetailPage')
const TeacherProfilePage = lazyPage(() => import('../pages/teacher/TeacherProfilePage'), 'TeacherProfilePage')
const TeacherInstitutionAdminPage = lazyPage(
  () => import('../pages/teacher/TeacherInstitutionAdminPage'),
  'TeacherInstitutionAdminPage',
)

// Real-Time Classroom and others
const ClassroomPage = lazyPage(() => import('../pages/classroom/ClassroomPage'), 'ClassroomPage')
const NotFoundPage = lazyPage(() => import('../pages/NotFoundPage'), 'NotFoundPage')
const AdminApp = lazyPage(() => import('../pages/admin/AdminApp'), 'AdminApp')

export const AppRoutes: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth()

  // Root redirect logic
  const renderRootRedirect = () => {
    if (isLoading) return null
    if (!isAuthenticated || !user) return <Navigate to="/login" replace />
    return <Navigate to={user.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard'} replace />
  }

  return (
    <Suspense fallback={<LoadingState />}>
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
        <Route path="/register/college" element={<CollegeRegisterPage />} />
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
          <Route path="summaries/:classId" element={<TeacherSummaryDetailPage />} />
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
    </Suspense>
  )
}
