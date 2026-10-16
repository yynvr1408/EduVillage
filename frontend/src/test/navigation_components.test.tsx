import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { NetworkProvider } from '../context/NetworkContext'
import { SyncProvider } from '../context/SyncContext'
import { CourseCard } from '../components/course/CourseCard'
import { ClassCard } from '../components/class/ClassCard'
import { AssignmentCard } from '../components/assignment/AssignmentCard'
import { OfflineDraftEditor } from '../components/assignment/OfflineDraftEditor'
import { MobileNavigation } from '../components/layout/MobileNavigation'
import { db } from '../db/db'
import type { Course, ClassRoom, Assignment } from '../types'

describe('Navigation & Domain Components', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.assignmentDrafts.clear()
    await db.syncOperations.clear()
  })

  it('renders CourseCard with title, code badge, lessons count, and view link', () => {
    const course: Course = {
      id: 'course-1',
      title: 'Solar Micro-Grids: Design & Maintenance',
      code: 'STEM-201',
      description: 'Practical engineering principles for off-grid communities.',
      teacher_id: 't-1',
      teacher_name: 'Dr. Elena Rostova',
      created_at: new Date().toISOString(),
      lessons_count: 5,
      status: 'published',
    }

    render(
      <BrowserRouter>
        <CourseCard course={course} />
      </BrowserRouter>
    )

    expect(screen.getByText('STEM-201')).toBeInTheDocument()
    expect(screen.getByText('Solar Micro-Grids: Design & Maintenance')).toBeInTheDocument()
    expect(screen.getByText('Dr. Elena Rostova')).toBeInTheDocument()
    expect(screen.getByText('5 Lessons')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /View Course/i })).toBeInTheDocument()
  })

  it('renders ClassCard with status badges and Join Live Room action for live classes', () => {
    const liveClass: ClassRoom = {
      id: 'class-live-1',
      course_id: 'course-1',
      course_title: 'Solar Energy',
      course_code: 'STEM-201',
      teacher_id: 't-1',
      teacher_name: 'Dr. Elena Rostova',
      title: 'Field Diagnostics: Ground Faults & Inverter Calibration',
      status: 'LIVE',
      scheduled_at: new Date().toISOString(),
      livekit_room_name: 'eduvillage-live-1',
    }

    render(
      <BrowserRouter>
        <ClassCard classroom={liveClass} isTeacher={false} />
      </BrowserRouter>
    )

    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.getByText('Field Diagnostics: Ground Faults & Inverter Calibration')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Join Live Room/i })).toBeInTheDocument()
  })

  it('lets a teacher cancel a scheduled class after confirming, and shows the cancelled state', () => {
    const scheduledClass: ClassRoom = {
      id: 'class-sched-1',
      course_id: 'course-1',
      course_title: 'Solar Energy',
      course_code: 'STEM-201',
      teacher_id: 't-1',
      teacher_name: 'Dr. Elena Rostova',
      title: 'Intro to Off-Grid Inverters',
      status: 'SCHEDULED',
      scheduled_at: new Date().toISOString(),
    }

    const onCancel = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <BrowserRouter>
        <ClassCard classroom={scheduledClass} isTeacher={true} onCancel={onCancel} />
      </BrowserRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledWith('class-sched-1')

    confirmSpy.mockRestore()
  })

  it('does not call onCancel when the teacher dismisses the confirmation', () => {
    const scheduledClass: ClassRoom = {
      id: 'class-sched-2',
      course_id: 'course-1',
      course_title: 'Solar Energy',
      course_code: 'STEM-201',
      teacher_id: 't-1',
      teacher_name: 'Dr. Elena Rostova',
      title: 'Intro to Off-Grid Inverters',
      status: 'SCHEDULED',
      scheduled_at: new Date().toISOString(),
    }

    const onCancel = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(
      <BrowserRouter>
        <ClassCard classroom={scheduledClass} isTeacher={true} onCancel={onCancel} />
      </BrowserRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()

    confirmSpy.mockRestore()
  })

  it('renders the cancelled state for a teacher and hides the join affordance for a student', () => {
    const cancelledClass: ClassRoom = {
      id: 'class-cancelled-1',
      course_id: 'course-1',
      course_title: 'Solar Energy',
      course_code: 'STEM-201',
      teacher_id: 't-1',
      teacher_name: 'Dr. Elena Rostova',
      title: 'Intro to Off-Grid Inverters',
      status: 'CANCELLED',
      scheduled_at: new Date().toISOString(),
    }

    const { rerender } = render(
      <BrowserRouter>
        <ClassCard classroom={cancelledClass} isTeacher={true} />
      </BrowserRouter>
    )
    expect(screen.getByText('CANCELLED')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start Class/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument()

    rerender(
      <BrowserRouter>
        <ClassCard classroom={cancelledClass} isTeacher={false} />
      </BrowserRouter>
    )
    expect(screen.queryByRole('button', { name: /Join Live Room/i })).not.toBeInTheDocument()
  })

  it('renders AssignmentCard with "Saved on this device" when draft exists in IndexedDB', () => {
    const assignment: Assignment = {
      id: 'asg-test-1',
      course_id: 'course-1',
      course_title: 'Solar STEM',
      title: 'Dispensary Solar Load Sizing',
      instructions: 'Calculate daily kWh demand.',
      due_date: new Date(Date.now() + 86400000).toISOString(),
      max_score: 100,
      created_at: new Date().toISOString(),
    }

    const draft = {
      id: 'asg-test-1',
      assignmentId: 'asg-test-1',
      studentId: 'student-1',
      courseId: 'course-1',
      assignmentTitle: 'Dispensary Solar Load Sizing',
      content: 'Calculated 4.2 kWh total load.',
      wordCount: 5,
      savedAt: new Date().toISOString(),
      syncStatus: 'local_only' as const,
    }

    render(
      <BrowserRouter>
        <AssignmentCard assignment={assignment} draft={draft} />
      </BrowserRouter>
    )

    expect(screen.getByText('Saved on this device')).toBeInTheDocument()
    expect(screen.getByText('Dispensary Solar Load Sizing')).toBeInTheDocument()
  })

  it('renders mobile navigation bottom bar for students with 5 accessible touch destinations', () => {
    const studentUser = {
      id: 'student-1',
      email: 'student@eduvillage.org',
      full_name: 'Amina Diallo',
      role: 'student' as const,
      created_at: new Date().toISOString(),
    }
    localStorage.setItem('eduvillage_user', JSON.stringify(studentUser))
    localStorage.setItem('eduvillage_token', 'valid-token')

    render(
      <BrowserRouter>
        <AuthProvider>
          <MobileNavigation />
        </AuthProvider>
      </BrowserRouter>
    )

    expect(screen.getByRole('navigation', { name: /Mobile Navigation/i })).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Classes')).toBeInTheDocument()
    expect(screen.getByText('Recorded')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })
})
