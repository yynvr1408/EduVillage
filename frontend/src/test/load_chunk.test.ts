import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadChunk } from '../utils/loadChunk'

describe('loadChunk (stale deploy recovery for dynamic imports)', () => {
  const originalReload = window.location.reload

  beforeEach(() => {
    sessionStorage.clear()
    // jsdom's window.location.reload is not implemented; stub it so we can assert on it.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: originalReload }, writable: true })
  })

  it('resolves normally when the import succeeds', async () => {
    const result = await loadChunk(async () => ({ value: 42 }))
    expect(result).toEqual({ value: 42 })
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('reloads the page once on a stale-chunk MIME error, instead of rejecting', async () => {
    const importer = vi.fn().mockRejectedValue(new TypeError('Failed to load module script: ... MIME type of "text/html"'))
    const pending = loadChunk(importer)
    // The reload is "in flight": the promise intentionally never settles, so no error reaches the caller.
    const raced = await Promise.race([pending.then(() => 'resolved'), pending.catch(() => 'rejected'), Promise.resolve('neither')])
    expect(raced).toBe('neither')
    expect(window.location.reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('eduvillage:chunk-reload-guard')).toBe('1')
  })

  it('does not reload a second time in the same session; the error surfaces normally instead', async () => {
    sessionStorage.setItem('eduvillage:chunk-reload-guard', '1')
    const err = new TypeError('error loading dynamically imported module')
    await expect(loadChunk(async () => { throw err })).rejects.toBe(err)
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('a genuinely unrelated error is rethrown untouched, never triggers a reload', async () => {
    const err = new Error('background-blur: WebGL context creation failed')
    await expect(loadChunk(async () => { throw err })).rejects.toBe(err)
    expect(window.location.reload).not.toHaveBeenCalled()
  })
})
