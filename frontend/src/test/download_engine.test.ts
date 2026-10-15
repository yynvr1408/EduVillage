import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { db } from '../db/db'
import { startDownload, pauseDownload, getJob, DownloadError, type DownloadSpec } from '../services/downloadEngine'

// jsdom's Blob can't survive fake-indexeddb's structured clone (real browsers' IndexedDB stores Blobs
// natively); Node's Blob can, so use it here to get realistic stored-chunk behavior.
beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

const CHUNK = 1000
const sleep = async () => {}

/** Deterministic file content so any byte offset is checkable. */
const makeFile = (n: number) => {
  const bytes = new Uint8Array(n)
  for (let i = 0; i < n; i++) bytes[i] = (i * 7 + 13) % 251
  return bytes
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface ServerOptions {
  honorRange?: boolean
  failChunks?: number[] // fail (HTTP 503) the first N calls overall
  status?: number // fixed error status for every call
  onCall?: (rangeHeader: string | null, call: number) => void
}

/** A fake file server speaking HTTP Range, so the client logic runs against real byte arithmetic. */
function fakeServer(file: Uint8Array, opts: ServerOptions = {}) {
  let call = 0
  const calls: string[] = []
  const impl = vi.fn(async (_url: string, init: RequestInit) => {
    call++
    const range = new Headers(init.headers).get('Range')
    calls.push(range ?? 'none')
    opts.onCall?.(range, call)
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (opts.status) return { ok: false, status: opts.status, headers: new Headers(), blob: async () => new Blob([]) }
    if (opts.failChunks && call <= opts.failChunks[0]) return { ok: false, status: 503, headers: new Headers(), blob: async () => new Blob([]) }
    if (opts.honorRange === false || !range) {
      return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob([file]) }
    }
    const m = range.match(/bytes=(\d+)-(\d+)/)!
    const start = Number(m[1])
    const end = Math.min(Number(m[2]), file.length - 1)
    if (start >= file.length) return { ok: false, status: 416, headers: new Headers(), blob: async () => new Blob([]) }
    return {
      ok: true,
      status: 206,
      headers: new Headers({ 'content-range': `bytes ${start}-${end}/${file.length}` }),
      blob: async () => new Blob([file.slice(start, end + 1)]),
    }
  })
  return { impl: impl as unknown as typeof fetch, calls, mock: impl }
}

const spec = (file: Uint8Array, over: Partial<DownloadSpec> = {}): DownloadSpec => ({
  id: 'res-1',
  url: 'https://files.example/res-1',
  credentials: false,
  totalBytes: file.length,
  version: 1,
  checksum: sha256(file),
  mimeType: 'application/pdf',
  ...over,
})

const readBack = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

beforeEach(async () => {
  await db.downloadJobs.clear()
  await db.downloadParts.clear()
  vi.restoreAllMocks()
})

describe('resumable verified downloads', () => {
  it('downloads in range chunks, reports progress, and assembles a byte-exact verified file', async () => {
    const file = makeFile(3500)
    const server = fakeServer(file)
    const progress: number[] = []
    const blob = await startDownload(spec(file), { fetchImpl: server.impl, chunkSize: CHUNK, sleep, onProgress: (p) => progress.push(p.percent) })

    expect(server.calls).toEqual(['bytes=0-999', 'bytes=1000-1999', 'bytes=2000-2999', 'bytes=3000-3499'])
    expect(blob.size).toBe(3500)
    expect(await readBack(blob)).toEqual(file)
    expect(progress.filter((p) => p > 0 && p < 100)).toEqual([28, 57, 85])
    expect(progress.at(-1)).toBe(100)
  })

  it('resumes from the last stored chunk after a pause instead of restarting', async () => {
    const file = makeFile(5000)
    const controller = new AbortController()
    const server = fakeServer(file, { onCall: (_r, call) => call === 3 && controller.abort() })

    await expect(startDownload(spec(file), { fetchImpl: server.impl, chunkSize: CHUNK, sleep, signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' })
    const paused = await getJob('res-1')
    expect(paused?.status).toBe('paused')
    expect(paused?.bytesDownloaded).toBe(2000) // two whole chunks are safely stored

    const second = fakeServer(file)
    const blob = await startDownload(spec(file), { fetchImpl: second.impl, chunkSize: CHUNK, sleep })
    expect(second.calls).toEqual(['bytes=2000-2999', 'bytes=3000-3999', 'bytes=4000-4999']) // nothing re-downloaded
    expect(await readBack(blob)).toEqual(file)
  })

  it('retries transient failures with backoff and still completes', async () => {
    const file = makeFile(1500)
    const server = fakeServer(file, { failChunks: [2] })
    const waits: number[] = []
    const blob = await startDownload(spec(file), {
      fetchImpl: server.impl, chunkSize: CHUNK, sleep: async (ms) => void waits.push(ms),
    })
    expect(waits).toEqual([500, 1000]) // exponential backoff
    expect(blob.size).toBe(1500)
  })

  it('gives up after bounded retries, keeps progress, and reports a network failure (no endless loop)', async () => {
    const file = makeFile(3000)
    let ok = 0
    const base = fakeServer(file)
    const flaky = vi.fn(async (url: string, init: RequestInit) => {
      if (ok < 1) { ok++; return base.impl(url, init) }
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    await expect(startDownload(spec(file), { fetchImpl: flaky, chunkSize: CHUNK, sleep, maxRetries: 2 })).rejects.toMatchObject({ code: 'NETWORK' })
    expect((flaky as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1 + 3) // 1 success + (1 try + 2 retries)
    const job = await getJob('res-1')
    expect(job?.status).toBe('failed')
    expect(job?.bytesDownloaded).toBe(1000) // never marked complete; progress kept for retry
  })

  it.each([401, 403, 404, 410])('does not retry HTTP %i and discards partial data (file unavailable)', async (status) => {
    const file = makeFile(2000)
    const server = fakeServer(file, { status })
    await expect(startDownload(spec(file), { fetchImpl: server.impl, chunkSize: CHUNK, sleep })).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(server.calls).toHaveLength(1)
    expect(await getJob('res-1')).toBeUndefined()
    expect(await db.downloadParts.count()).toBe(0)
  })

  it('rejects a file whose checksum does not match and stores nothing as complete', async () => {
    const file = makeFile(2500)
    const server = fakeServer(file)
    await expect(startDownload(spec(file, { checksum: 'a'.repeat(64) }), { fetchImpl: server.impl, chunkSize: CHUNK, sleep })).rejects.toMatchObject({ code: 'INTEGRITY' })
    expect(await db.downloadParts.count()).toBe(0)
    expect(await getJob('res-1')).toBeUndefined()
  })

  it('rejects a file that is shorter than the size the server announced', async () => {
    const file = makeFile(2000)
    const server = fakeServer(file)
    await expect(startDownload(spec(file, { totalBytes: 2600, checksum: undefined }), { fetchImpl: server.impl, chunkSize: CHUNK, sleep })).rejects.toBeInstanceOf(DownloadError)
    expect(await db.downloadParts.count()).toBeLessThanOrEqual(2) // partial progress may be kept for a retry, but nothing is complete
    expect((await getJob('res-1'))?.status).not.toBe('completed')
  })

  it('discards stored chunks when the file version changed on the server', async () => {
    const v1 = makeFile(3000)
    const controller = new AbortController()
    const s1 = fakeServer(v1, { onCall: (_r, c) => c === 2 && controller.abort() })
    await expect(startDownload(spec(v1), { fetchImpl: s1.impl, chunkSize: CHUNK, sleep, signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' })
    expect(await db.downloadParts.count()).toBe(1)

    const v2 = makeFile(3000).map((b) => (b + 1) % 251)
    const s2 = fakeServer(v2)
    const blob = await startDownload(spec(v2, { version: 2 }), { fetchImpl: s2.impl, chunkSize: CHUNK, sleep })
    expect(s2.calls[0]).toBe('bytes=0-999') // started over: old bytes were not trusted
    expect(await readBack(blob)).toEqual(v2)
  })

  it('handles a server that ignores Range by taking the whole body and still verifying it', async () => {
    const file = makeFile(2200)
    const server = fakeServer(file, { honorRange: false })
    const blob = await startDownload(spec(file), { fetchImpl: server.impl, chunkSize: CHUNK, sleep })
    expect(server.calls).toHaveLength(1)
    expect(await readBack(blob)).toEqual(file)
  })

  it('refuses to start when the device does not have enough storage', async () => {
    const file = makeFile(2000)
    const server = fakeServer(file)
    vi.stubGlobal('navigator', { ...navigator, storage: { estimate: async () => ({ usage: 99_000_000, quota: 100_000_000 }) } })
    await expect(startDownload(spec(file, { totalBytes: 50 * 1024 * 1024, checksum: undefined }), { fetchImpl: server.impl, chunkSize: CHUNK, sleep })).rejects.toMatchObject({ code: 'STORAGE_LIMIT' })
    expect(server.calls).toHaveLength(0) // nothing was fetched
    vi.unstubAllGlobals()
  })

  it('turns a browser quota error into STORAGE_LIMIT instead of pretending success', async () => {
    const file = makeFile(2000)
    const server = fakeServer(file)
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' })
    vi.spyOn(db.downloadParts, 'put').mockRejectedValueOnce(quota)
    await expect(startDownload(spec(file), { fetchImpl: server.impl, chunkSize: CHUNK, sleep })).rejects.toMatchObject({ code: 'STORAGE_LIMIT' })
    expect((await getJob('res-1'))?.status).toBe('failed')
  })

  it('never runs the same download twice at once', async () => {
    const file = makeFile(2000)
    const server = fakeServer(file)
    const a = startDownload(spec(file), { fetchImpl: server.impl, chunkSize: CHUNK, sleep })
    const b = startDownload(spec(file), { fetchImpl: server.impl, chunkSize: CHUNK, sleep })
    await Promise.all([a, b])
    expect(server.calls).toHaveLength(2) // 2 chunks total, not 4
  })

  it('pauseDownload stops an active download and keeps what was stored', async () => {
    const file = makeFile(4000)
    const server = fakeServer(file, { onCall: (_r, c) => c === 2 && pauseDownload('res-1') })
    await expect(startDownload(spec(file), { fetchImpl: server.impl, chunkSize: CHUNK, sleep })).rejects.toMatchObject({ code: 'ABORTED' })
    expect((await getJob('res-1'))?.status).toBe('paused')
  })
})
