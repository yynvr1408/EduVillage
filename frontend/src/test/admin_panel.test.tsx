import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { AdminApp } from '../pages/admin/AdminApp'

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown }

let handler: Handler
let calls: { url: string; method: string; headers: Record<string, string>; body: any; credentials?: RequestCredentials }[]

const college = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Rural Science College',
  location: 'Pune',
  contact_email: null,
  contact_phone: null,
  code: 'EV-ABCD-2345',
  code_generated_at: '2026-01-01T00:00:00Z',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        credentials: init.credentials,
      })
      const r = handler(url, init)
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body ?? null,
      } as Response
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const signedOut: Handler = (url) =>
  url.endsWith('/auth/me') ? { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } } } : { status: 404 }

describe('admin panel', () => {
  it('shows the sign-in form when there is no session and shows the generic error on failure', async () => {
    handler = (url, init) => {
      if (url.endsWith('/auth/login')) return { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect username or password.' } } }
      return signedOut(url, init)
    }
    render(<AdminApp />)
    fireEvent.change(await screen.findByLabelText(/username/i), { target: { value: 'someone' } })
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.')
    const login = calls.find((c) => c.url.endsWith('/auth/login'))!
    expect(login.credentials).toBe('include')
    expect(login.headers['X-EduVillage-Admin']).toBe('1')
  })

  it('signs in, lists colleges, and only reports a creation after the server confirms it', async () => {
    let created = false
    handler = (url, init) => {
      const method = init.method ?? 'GET'
      if (url.endsWith('/auth/login')) return { status: 200, body: { username: 'admin', display_name: 'Administrator' } }
      if (url.endsWith('/auth/me')) return { status: 401, body: { error: { message: 'x' } } }
      if (url.includes('/overview')) return { status: 200, body: { total_colleges: created ? 1 : 0, active_colleges: created ? 1 : 0, inactive_colleges: 0, total_codes_generated: created ? 1 : 0 } }
      if (url.includes('/colleges') && method === 'POST') {
        created = true
        return { status: 201, body: college() }
      }
      if (url.includes('/colleges')) return { status: 200, body: { items: created ? [college()] : [], total: created ? 1 : 0, limit: 10, offset: 0 } }
      return { status: 404 }
    }
    render(<AdminApp />)
    fireEvent.change(await screen.findByLabelText(/username/i), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'any-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(await screen.findByText('No colleges yet')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /create college/i })[0])
    fireEvent.change(await screen.findByLabelText(/college name/i), { target: { value: 'Rural Science College' } })
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/colleges'))).toBe(false)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create college' }))

    const codeDialog = (await screen.findByRole('heading', { name: 'College code' })).closest('[role="dialog"]') as HTMLElement
    expect(within(codeDialog).getByText('EV-ABCD-2345')).toBeInTheDocument()
    expect(await screen.findByText(/Rural Science College was created/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('stat-total-colleges')).toHaveTextContent('1'))
  })

  it('validates the name on the client and shows server errors without claiming success', async () => {
    handler = (url, init) => {
      const method = init.method ?? 'GET'
      if (url.endsWith('/auth/me')) return { status: 200, body: { username: 'admin', display_name: 'Administrator' } }
      if (url.includes('/overview')) return { status: 200, body: { total_colleges: 0, active_colleges: 0, inactive_colleges: 0, total_codes_generated: 0 } }
      if (url.includes('/colleges') && method === 'POST') return { status: 409, body: { error: { code: 'COLLEGE_EXISTS', message: 'A college with this name and location already exists.' } } }
      if (url.includes('/college-requests')) return { status: 200, body: [] }
      return { status: 200, body: { items: [], total: 0, limit: 10, offset: 0 } }
    }
    render(<AdminApp />)
    fireEvent.click((await screen.findAllByRole('button', { name: /create college/i }))[0])
    await screen.findByRole('dialog')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create college' }))
    expect(await screen.findByText(/Enter the college name/)).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    fireEvent.change(screen.getByLabelText(/college name/i), { target: { value: 'Existing College' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create college' }))
    expect(await screen.findByText('A college with this name and location already exists.')).toBeInTheDocument()
    expect(screen.queryByText(/was created/)).not.toBeInTheDocument()
  })

  it('returns to sign-in when the session expires mid-use', async () => {
    let expired = false
    handler = (url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: { username: 'admin', display_name: 'Administrator' } }
      if (expired) return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } } }
      if (url.includes('/overview')) return { status: 200, body: { total_colleges: 1, active_colleges: 1, inactive_colleges: 0, total_codes_generated: 1 } }
      if (url.includes('/college-requests')) return { status: 200, body: [] }
      return { status: 200, body: { items: [college()], total: 1, limit: 10, offset: 0 } }
    }
    render(<AdminApp />)
    await screen.findByText('Rural Science College')
    expired = true
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('never stores credentials in browser storage', async () => {
    handler = (url) => (url.endsWith('/auth/login') ? { status: 200, body: { username: 'admin', display_name: 'A' } } : { status: 401, body: { error: { message: 'x' } } })
    const secret = 'unit-test-only-password'
    render(<AdminApp />)
    fireEvent.change(await screen.findByLabelText(/username/i), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: secret } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/login'))).toBe(true))
    expect(JSON.stringify({ ...localStorage })).not.toContain(secret)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(secret)
  })
})
