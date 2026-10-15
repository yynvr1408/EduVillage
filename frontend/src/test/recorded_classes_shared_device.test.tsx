import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecordedLecturePlayer } from '../components/recording/RecordedLecturePlayer'
import { ClassCard } from '../components/class/ClassCard'
import { AppHeader } from '../components/layout/AppHeader'
import { AuthProvider } from '../context/AuthContext'
import { NetworkProvider } from '../context/NetworkContext'
import { SyncProvider } from '../context/SyncContext'
import { authService } from '../services/authService'
import { db } from '../db/db'
import type { Recording, ClassRoom, User } from '../types'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})

describe('Recorded Classes, Shared Devices & Multi-Section Workflows', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    await db.assignmentDrafts.clear()
    await db.syncOperations.clear()
  })

  it('renders RecordedLecturePlayer for a READY recording with controls and audio-only toggle', () => {
    const readyRecording: Recording = {
      id: 'rec-1',
      classroom_id: 'cls-1',
      course_id: 'course-1',
      course_code: 'STEM-201',
      course_title: 'Solar Micro-Grids',
      teacher_id: 't-1',
      teacher_name: 'Dr. Elena Rostova',
      title: 'Solar Micro-Grids: Battery Chemistry & Storage',
      description: 'Understanding cycle degradation and charge controllers in rural mini-grids.',
      status: 'READY',
      video_url: 'https://example.com/recording.mp4',
      duration_seconds: 3600,
      file_size_bytes: 45000000,
      created_at: new Date().toISOString(),
      is_published: true,
      has_transcript: true,
      has_summary: true,
      user_progress_seconds: 300,
      section_ids: ['sec-1'],
    }

    render(
      <QueryClientProvider client={queryClient}>
        <RecordedLecturePlayer recording={readyRecording} />
      </QueryClientProvider>
    )

    // Verify controls
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rewind 10 seconds/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fast forward 10 seconds/i })).toBeInTheDocument()
    expect(screen.getByTitle(/audio-only/i)).toBeInTheDocument()
  })

  it('displays honest processing state when recording is still being prepared', () => {
    const processingRecording: Recording = {
      id: 'rec-2',
      course_id: 'course-1',
      course_code: 'STEM-201',
      course_title: 'Solar Micro-Grids',
      teacher_id: 't-1',
      teacher_name: 'Dr. Elena Rostova',
      title: 'Photovoltaic MPPT Controllers',
      status: 'PROCESSING',
      duration_seconds: 2400,
      file_size_bytes: 0,
      created_at: new Date().toISOString(),
      is_published: false,
      has_transcript: false,
      has_summary: false,
      section_ids: ['sec-1'],
    }

    render(
      <QueryClientProvider client={queryClient}>
        <RecordedLecturePlayer recording={processingRecording} />
      </QueryClientProvider>
    )

    // Must show exact honest message according to specification
    expect(
      screen.getByText(/Your lecture recording is being prepared/i)
    ).toBeInTheDocument()
    // Should NOT have play button
    expect(screen.queryByTitle('Play (Space)')).not.toBeInTheDocument()
  })

  it('renders multi-section badge on ClassCard when section_name is present', () => {
    const classRoom: ClassRoom = {
      id: 'cls-101',
      course_id: 'c-1',
      course_title: 'Soil Mechanics',
      teacher_id: 't-1',
      teacher_name: 'Prof. Miller',
      title: 'Hydraulic Conductivity Laboratory',
      status: 'SCHEDULED',
      scheduled_start: new Date(Date.now() + 3600000).toISOString(),
      section_id: 'sec-a',
      section_name: 'Section A (Cohort 2026)',
    }

    render(
      <BrowserRouter>
        <ClassCard classroom={classRoom} isTeacher={true} />
      </BrowserRouter>
    )

    expect(screen.getByText('Hydraulic Conductivity Laboratory')).toBeInTheDocument()
    expect(screen.getByText('Section: Section A (Cohort 2026)')).toBeInTheDocument()
  })

  it('manages shared-device storage isolation and switch user workflow', async () => {
    // Default is personal device
    expect(authService.isSharedDevice()).toBe(false)

    // Turn on shared-device mode
    authService.setSharedDevice(true)
    expect(authService.isSharedDevice()).toBe(true)

    // Storing token in shared device mode routes to sessionStorage
    authService.getStorage().setItem('eduvillage_token', 'shared-session-token')
    expect(sessionStorage.getItem('eduvillage_token')).toBe('shared-session-token')
    expect(localStorage.getItem('eduvillage_token')).toBeNull()

    // Logging out clears session tokens
    authService.logout()
    expect(sessionStorage.getItem('eduvillage_token')).toBeNull()
  })

  it('prompts warning when unsaved assignment draft exists before logging out on shared device', async () => {
    const studentUser: User = {
      id: 'std-1',
      full_name: 'Priya Sharma',
      email: 'priya@eduvillage.org',
      role: 'student',
      created_at: new Date().toISOString(),
    }

    localStorage.setItem('eduvillage_shared_device', 'true')
    sessionStorage.setItem('eduvillage_user', JSON.stringify(studentUser))
    sessionStorage.setItem('eduvillage_token', 'token-123')

    // Add an unsynchronized assignment draft in IndexedDB
    await db.assignmentDrafts.put({
      id: 'asg-solar-01',
      assignmentId: 'asg-solar-01',
      studentId: 'std-1',
      courseId: 'c-1',
      assignmentTitle: 'Solar Calculations',
      content: 'Calculations for battery capacity: 400Ah @ 24V...',
      wordCount: 15,
      savedAt: new Date().toISOString(),
      syncStatus: 'pending_sync',
    })

    render(
      <BrowserRouter>
        <AuthProvider>
          <NetworkProvider>
            <SyncProvider>
              <AppHeader onToggleSidebar={() => {}} />
            </SyncProvider>
          </NetworkProvider>
        </AuthProvider>
      </BrowserRouter>
    )

    // Click Log out or switch user button
    const switchUserBtn = await screen.findByTitle(/log out or switch user/i)
    fireEvent.click(switchUserBtn)

    // The modal warning should appear
    await waitFor(() => {
      expect(screen.getByText('Unsynchronized Work on Device')).toBeInTheDocument()
      expect(
        screen.getByText(/You have an assignment waiting to sync/i)
      ).toBeInTheDocument()
    })
  })
})
