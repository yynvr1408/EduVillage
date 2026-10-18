import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useIsInstitutionAdmin } from '../hooks/useIsInstitutionAdmin'

const myColleges = vi.fn()
vi.mock('../services/institutionAdminApi', () => ({
  institutionAdminApi: { myColleges: (...a: unknown[]) => myColleges(...a) },
}))

let isTeacher = true
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isTeacher }) }))

describe('useIsInstitutionAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTeacher = true
  })

  it('is false while loading and while the teacher administers nothing', async () => {
    myColleges.mockResolvedValue([])
    const { result } = renderHook(() => useIsInstitutionAdmin())
    expect(result.current).toBe(false)
    await waitFor(() => expect(myColleges).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it('becomes true once the teacher is found to administer at least one college', async () => {
    myColleges.mockResolvedValue([{ id: 'col-1' }])
    const { result } = renderHook(() => useIsInstitutionAdmin())
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('never calls the API for a non-teacher, and stays false', async () => {
    isTeacher = false
    const { result } = renderHook(() => useIsInstitutionAdmin())
    expect(myColleges).not.toHaveBeenCalled()
    expect(result.current).toBe(false)
  })

  it('stays false (not an error) when the request fails - e.g. not delegated, or offline', async () => {
    myColleges.mockRejectedValue(new Error('403'))
    const { result } = renderHook(() => useIsInstitutionAdmin())
    await waitFor(() => expect(myColleges).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })
})
