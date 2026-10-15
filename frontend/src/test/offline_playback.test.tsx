import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { renderHook } from '@testing-library/react'
import { Blob as NodeBlob } from 'node:buffer'
import { db } from '../db/db'
import { OfflineViewerPage } from '../pages/student/OfflineViewerPage'
import { playbackStore } from '../services/playbackStore'
import { useConnectionRecovery } from '../hooks/useConnectionRecovery'
import { ConnectionLostPanel } from '../components/class/ConnectionLostPanel'
import { apiRequest } from '../services/apiClient'

const base = { courseId: 'c1', title: 'Week 1 Lecture', sizeBytes: 10, downloadedAt: new Date().toISOString(), version: 1 }

function renderViewer(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/student/downloads/${id}`]}>
      <Routes>
        <Route path="/student/downloads/:resourceId" element={<OfflineViewerPage />} />
        <Route path="/student/downloads" element={<div>Downloads list</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(async () => {
  // IndexedDB in real browsers stores Blobs natively; Node's Blob survives fake-indexeddb's clone, jsdom's doesn't.
  vi.stubGlobal('Blob', NodeBlob)
  await Promise.all([db.downloadedResources.clear(), db.playbackPositions.clear()])
  URL.createObjectURL = vi.fn(() => 'blob:local-copy')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

describe('offline viewer', () => {
  it('plays a downloaded video from the local copy without any network request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await db.downloadedResources.put({ ...base, id: 'v1', resourceId: 'v1', fileType: 'video', blob: new Blob(['x'], { type: 'video/mp4' }) })

    renderViewer('v1')
    const media = await screen.findByTestId('offline-media')
    expect(media.tagName).toBe('VIDEO')
    expect(media.getAttribute('src')).toBe('blob:local-copy') // the local blob, not a remote URL
    expect(screen.getByText('Playing from this device')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('plays downloaded audio and shows PDFs and notes from local storage', async () => {
    await db.downloadedResources.put({ ...base, id: 'a1', resourceId: 'a1', fileType: 'audio', blob: new Blob(['x'], { type: 'audio/mpeg' }) })
    const audio = renderViewer('a1')
    expect((await screen.findByTestId('offline-media')).tagName).toBe('AUDIO')
    audio.unmount()

    await db.downloadedResources.put({ ...base, id: 'p1', resourceId: 'p1', fileType: 'document', blob: new Blob(['%PDF'], { type: 'application/pdf' }) })
    const pdf = renderViewer('p1')
    expect(await screen.findByTestId('offline-pdf')).toHaveAttribute('src', 'blob:local-copy')
    pdf.unmount()

    await db.downloadedResources.put({ ...base, id: 't1', resourceId: 't1', fileType: 'notes', blob: new Blob(['Chlorophyll absorbs light.'], { type: 'text/plain' }) })
    renderViewer('t1')
    expect(await screen.findByTestId('offline-text')).toHaveTextContent('Chlorophyll absorbs light.')
  })

  it('tells the student when the file is not on this device instead of loading forever', async () => {
    renderViewer('missing')
    expect(await screen.findByText(/not saved on this device/i)).toBeInTheDocument()
  })

  it('resumes where the student left off and saves progress locally', async () => {
    await db.downloadedResources.put({ ...base, id: 'v2', resourceId: 'v2', fileType: 'video', blob: new Blob(['x'], { type: 'video/mp4' }) })
    await playbackStore.save('res:v2', 125, 600)

    renderViewer('v2')
    const media = (await screen.findByTestId('offline-media')) as HTMLVideoElement
    Object.defineProperty(media, 'duration', { value: 600, configurable: true })
    await act(async () => {
      fireEvent.loadedMetadata(media)
    })
    await waitFor(() => expect(media.currentTime).toBe(125))
    expect(screen.getByText(/Resumed from 2:05/)).toBeInTheDocument()

    media.currentTime = 300
    await act(async () => {
      fireEvent.pause(media)
    })
    await waitFor(async () => expect((await db.playbackPositions.get('res:v2'))?.positionSeconds).toBe(300))
  })

  it('reports an unplayable or damaged file with a clear message', async () => {
    await db.downloadedResources.put({ ...base, id: 'v3', resourceId: 'v3', fileType: 'video', blob: new Blob(['junk'], { type: 'video/mp4' }) })
    renderViewer('v3')
    const media = await screen.findByTestId('offline-media')
    Object.defineProperty(media, 'error', { value: { code: 3 }, configurable: true })
    await act(async () => {
      fireEvent.error(media)
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(/damaged or could not be decoded/i)
  })

  it('releases the local object URL when leaving the page', async () => {
    await db.downloadedResources.put({ ...base, id: 'v4', resourceId: 'v4', fileType: 'video', blob: new Blob(['x'], { type: 'video/mp4' }) })
    const view = renderViewer('v4')
    await screen.findByTestId('offline-media')
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-copy')
  })
})

describe('playback positions', () => {
  it('restarts a finished lecture and ignores positions at the very end', async () => {
    await playbackStore.save('res:x', 598, 600)
    expect(await playbackStore.resumeAt('res:x', 600)).toBe(0)
    await playbackStore.save('res:y', 100, 600, true)
    expect(await playbackStore.resumeAt('res:y', 600)).toBe(0)
    await playbackStore.save('res:z', 100, 600)
    expect(await playbackStore.resumeAt('res:z', 600)).toBe(100)
  })

  it('does not write on every tick', async () => {
    const put = vi.spyOn(db.playbackPositions, 'put')
    await playbackStore.save('res:w', 10, 600)
    await playbackStore.save('res:w', 11, 600)
    await playbackStore.save('res:w', 12, 600)
    expect(put).toHaveBeenCalledTimes(1)
  })
})

describe('connection recovery gate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ignores brief drops and offers recovery only after a sustained outage', () => {
    const { result, rerender } = renderHook(({ s }) => useConnectionRecovery(s, { graceMs: 20_000 }), { initialProps: { s: 'connected' } })
    expect(result.current.recoveryRequired).toBe(false)

    rerender({ s: 'reconnecting' })
    act(() => void vi.advanceTimersByTime(10_000))
    expect(result.current.recoveryRequired).toBe(false) // still within the grace period

    rerender({ s: 'connected' }) // LiveKit recovered by itself
    act(() => void vi.advanceTimersByTime(60_000))
    expect(result.current.recoveryRequired).toBe(false)

    rerender({ s: 'disconnected' })
    act(() => void vi.advanceTimersByTime(20_000))
    expect(result.current.recoveryRequired).toBe(true)
  })

  it('goes away on its own when the connection returns, and can be dismissed without reappearing', () => {
    const { result, rerender } = renderHook(({ s }) => useConnectionRecovery(s, { graceMs: 1000 }), { initialProps: { s: 'disconnected' } })
    act(() => void vi.advanceTimersByTime(1000))
    expect(result.current.recoveryRequired).toBe(true)

    act(() => result.current.dismiss())
    expect(result.current.recoveryRequired).toBe(false)
    rerender({ s: 'reconnecting' })
    act(() => void vi.advanceTimersByTime(5000))
    expect(result.current.recoveryRequired).toBe(false) // stays dismissed for this outage

    rerender({ s: 'connected' })
    rerender({ s: 'disconnected' })
    act(() => void vi.advanceTimersByTime(1000))
    expect(result.current.recoveryRequired).toBe(true) // a new outage is announced again
  })
})

describe('connection lost panel', () => {
  it('offers Go to Downloads as a plain client-side link that needs no server', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(
      <MemoryRouter>
        <ConnectionLostPanel showDownloads onKeepWaiting={() => {}} onLeave={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/not connected to the live class/i)
    expect(screen.getByRole('link', { name: /go to downloads/i })).toHaveAttribute('href', '/student/downloads')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not show a Downloads shortcut to teachers', () => {
    render(
      <MemoryRouter>
        <ConnectionLostPanel showDownloads={false} onKeepWaiting={() => {}} onLeave={() => {}} />
      </MemoryRouter>
    )
    expect(screen.queryByRole('link', { name: /go to downloads/i })).toBeNull()
  })
})

describe('requests never hang forever', () => {
  it('turns a request that never answers into a network error after the timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))))
    )
    const pending = apiRequest('/users/me', { timeoutMs: 5000 })
    const assertion = expect(pending).rejects.toMatchObject({ isNetworkError: true })
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
    vi.useRealTimers()
  })
})
