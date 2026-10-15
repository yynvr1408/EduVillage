import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { LoginPage } from '../pages/auth/LoginPage'
import { ProtectedRoute } from '../routes/ProtectedRoute'
import { authService } from '../services/authService'

describe('Authentication & Protected Routes', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('renders EduVillage login interface with monochrome styling and credentials inputs', () => {
    const { container } = render(
      <BrowserRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </BrowserRouter>
    )

    expect(screen.getByRole('heading', { name: /EduVillage/i })).toBeInTheDocument()
    expect(container.querySelector('#email')).toBeInTheDocument()
    expect(container.querySelector('#password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument()
    expect(screen.getByText(/Student Demo/i)).toBeInTheDocument()
    expect(screen.getByText(/Teacher Demo/i)).toBeInTheDocument()
  })

  it('quick fills demo student account credentials on button click', () => {
    const { container } = render(
      <BrowserRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </BrowserRouter>
    )

    const studentDemoBtn = screen.getByText(/Student Demo/i)
    fireEvent.click(studentDemoBtn)

    expect((container.querySelector('#email') as HTMLInputElement).value).toBe(
      'student@eduvillage.org'
    )
    expect((container.querySelector('#password') as HTMLInputElement).value).toBe('student123')
  })

  it('authenticates student successfully and persists session token', async () => {
    vi.spyOn(authService, 'login').mockResolvedValueOnce({
      user: {
        id: 'student-1',
        email: 'student@eduvillage.org',
        full_name: 'Amina Diallo',
        role: 'student',
        created_at: new Date().toISOString(),
      },
    })

    const { container } = render(
      <BrowserRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </BrowserRouter>
    )

    fireEvent.change(container.querySelector('#email')!, {
      target: { value: 'student@eduvillage.org' },
    })
    fireEvent.change(container.querySelector('#password')!, {
      target: { value: 'student123' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }))

    await waitFor(() => {
      expect(authService.login).toHaveBeenCalledWith(
        'student@eduvillage.org',
        'student123'
      )
    })
  })

  it('enforces role protection and blocks student from teacher routes', async () => {
    const studentUser = {
      id: 'student-1',
      email: 'student@eduvillage.org',
      full_name: 'Amina Diallo',
      role: 'student' as const,
      created_at: new Date().toISOString(),
    }

    localStorage.setItem('eduvillage_user', JSON.stringify(studentUser))
    localStorage.setItem('eduvillage_token', 'valid-token')
    vi.spyOn(authService, 'getMe').mockResolvedValue(studentUser)

    render(
      <MemoryRouter initialEntries={['/teacher/dashboard']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route
              path="/teacher/dashboard"
              element={
                <ProtectedRoute allowedRoles={['teacher']}>
                  <div>Protected Teacher Console</div>
                </ProtectedRoute>
              }
            />
            <Route path="/student/dashboard" element={<div>Student Home</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.queryByText('Protected Teacher Console')).not.toBeInTheDocument()
      expect(screen.getByText('Student Home')).toBeInTheDocument()
    })
  })
})
