/**
 * Resumable, verified file downloads for offline use.
 *
 * - The file is fetched in byte-range chunks; every chunk is persisted in IndexedDB as soon as it
 *   arrives, so an interruption (network loss, closed tab, pause) resumes from the last stored
 *   chunk instead of restarting.
 * - Nothing is reported as complete until the assembled file has the expected size (and SHA-256
 *   when the server supplied one). A failed or corrupt download leaves no "complete" record.
 * - Storage is checked before starting; quota errors surface as STORAGE_LIMIT, never silently.
 *
 * Storage choice: IndexedDB Blob parts. They are browser-managed (file-backed in modern engines),
 * work in every supported browser including iOS Safari, and let a resumed download append without
 * rewriting earlier bytes. OPFS would avoid the final Blob assembly but is not universally
 * available, so it is not required. Persistent storage is requested (best effort) to resist eviction.
 */

import { db } from '../db/db'

export type DownloadState = 'queued' | 'downloading' | 'paused' | 'verifying' | 'completed' | 'failed'

export type DownloadErrorCode =
  | 'STORAGE_LIMIT'
  | 'UNAVAILABLE' // removed, unpublished or no longer authorized (401/403/404/410)
  | 'NETWORK'
  | 'INTEGRITY'
  | 'ABORTED'
  | 'BAD_RESPONSE'

export class DownloadError extends Error {
  code: DownloadErrorCode
  constructor(code: DownloadErrorCode, message: string) {
    super(message)
    this.name = 'DownloadError'
    this.code = code
  }
}

export interface DownloadJob {
  id: string
  url: string
  credentials: boolean
  totalBytes: number
  bytesDownloaded: number
  chunkSize: number
  version: number
  checksum?: string
  mimeType?: string
  status: DownloadState
  error?: string
  errorCode?: DownloadErrorCode
  updatedAt: string
}

export interface DownloadPart {
  jobId: string
  index: number
  blob: Blob
}

export interface DownloadSpec {
  id: string
  url: string
  /** true for same-origin API URLs (session cookie); false for signed storage URLs. */
  credentials: boolean
  totalBytes: number
  version: number
  checksum?: string
  mimeType?: string
}

export interface DownloadOptions {
  onProgress?: (info: { percent: number; bytes: number; total: number; state: DownloadState }) => void
  signal?: AbortSignal
  chunkSize?: number
  maxRetries?: number
  /** injectable for tests */
  sleep?: (ms: number) => Promise<void>
  fetchImpl?: typeof fetch
}

export const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024
const STORAGE_MARGIN_BYTES = 20 * 1024 * 1024
const MAX_HASH_BYTES = 256 * 1024 * 1024 // hashing needs the bytes in memory; larger files are verified by size only
const NO_RETRY_STATUS = new Set([401, 403, 404, 410])

const inFlight = new Map<string, { promise: Promise<Blob>; controller: AbortController }>()

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function sha256Hex(blob: Blob): Promise<string> {
  const buffer: ArrayBuffer =
    typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(reader.error)
          reader.readAsArrayBuffer(blob)
        })
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted?.())) {
      await navigator.storage.persist()
    }
  } catch {
    // Persistence is best effort; the browser may refuse and that is fine.
  }
}

async function assertEnoughStorage(remainingBytes: number): Promise<void> {
  if (!navigator.storage?.estimate) return // unknown: proceed and handle quota errors when they happen
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    if (quota > 0 && quota - usage < remainingBytes + STORAGE_MARGIN_BYTES) {
      const needMb = Math.ceil(remainingBytes / (1024 * 1024))
      const freeMb = Math.max(0, Math.floor((quota - usage) / (1024 * 1024)))
      throw new DownloadError('STORAGE_LIMIT', `Not enough storage: about ${needMb} MB needed, ${freeMb} MB free on this device.`)
    }
  } catch (err) {
    if (err instanceof DownloadError) throw err
  }
}

function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; inner?: { name?: string } }
  return e?.name === 'QuotaExceededError' || e?.inner?.name === 'QuotaExceededError'
}

async function saveJob(job: DownloadJob): Promise<void> {
  job.updatedAt = new Date().toISOString()
  await db.downloadJobs.put(job)
}

export function getInFlight(id: string): boolean {
  return inFlight.has(id)
}

/** Stops an active download but keeps the stored chunks, so it can be resumed later. */
export function pauseDownload(id: string): void {
  inFlight.get(id)?.controller.abort()
}

export async function getJob(id: string): Promise<DownloadJob | undefined> {
  return db.downloadJobs.get(id)
}

/** Removes a job and every stored chunk (cancel, stale version, integrity failure, or after completion). */
export async function clearJob(id: string): Promise<void> {
  await db.transaction('rw', [db.downloadJobs, db.downloadParts], async () => {
    await db.downloadParts.where('jobId').equals(id).delete()
    await db.downloadJobs.delete(id)
  })
}

async function storedBytes(jobId: string): Promise<number> {
  let total = 0
  await db.downloadParts.where('jobId').equals(jobId).each((p) => {
    total += p.blob.size
  })
  return total
}

export function startDownload(spec: DownloadSpec, options: DownloadOptions = {}): Promise<Blob> {
  const existing = inFlight.get(spec.id)
  if (existing) return existing.promise // never run the same download twice at once

  const controller = new AbortController()
  options.signal?.addEventListener('abort', () => controller.abort())
  const promise = run(spec, options, controller.signal).finally(() => inFlight.delete(spec.id))
  inFlight.set(spec.id, { promise, controller })
  return promise
}

async function run(spec: DownloadSpec, options: DownloadOptions, signal: AbortSignal): Promise<Blob> {
  const doFetch = options.fetchImpl ?? fetch.bind(globalThis)
  const sleep = options.sleep ?? defaultSleep
  const maxRetries = options.maxRetries ?? 3
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE

  // --- resume or start fresh -------------------------------------------------------------
  let job = await db.downloadJobs.get(spec.id)
  if (job && (job.version !== spec.version || job.chunkSize !== chunkSize || job.url.split('?')[0] !== spec.url.split('?')[0])) {
    await clearJob(spec.id) // the file changed (or the chunking did): stored bytes are not trustworthy
    job = undefined
  }
  if (!job) {
    job = {
      id: spec.id,
      url: spec.url,
      credentials: spec.credentials,
      totalBytes: spec.totalBytes,
      bytesDownloaded: 0,
      chunkSize,
      version: spec.version,
      checksum: spec.checksum,
      mimeType: spec.mimeType,
      status: 'queued',
      updatedAt: new Date().toISOString(),
    }
  }
  job.url = spec.url // signed URLs rotate; the path identity was checked above
  job.credentials = spec.credentials
  job.totalBytes = spec.totalBytes || job.totalBytes
  job.bytesDownloaded = await storedBytes(spec.id)
  job.error = undefined
  job.errorCode = undefined

  const report = (state: DownloadState) => {
    const total = job!.totalBytes
    options.onProgress?.({
      percent: total > 0 ? Math.min(100, Math.floor((job!.bytesDownloaded / total) * 100)) : 0,
      bytes: job!.bytesDownloaded,
      total,
      state,
    })
  }

  const fail = async (code: DownloadErrorCode, message: string, keepParts: boolean): Promise<never> => {
    job!.status = code === 'ABORTED' ? 'paused' : 'failed'
    job!.error = message
    job!.errorCode = code
    if (keepParts) await saveJob(job!)
    else await clearJob(spec.id)
    report(job!.status)
    throw new DownloadError(code, message)
  }

  try {
    await assertEnoughStorage(Math.max(0, job.totalBytes - job.bytesDownloaded))
  } catch (err) {
    if (err instanceof DownloadError) return fail(err.code, err.message, true)
    throw err
  }
  void requestPersistence()

  job.status = 'downloading'
  await saveJob(job)
  report('downloading')

  // --- fetch missing chunks --------------------------------------------------------------
  let nextIndex = Math.floor(job.bytesDownloaded / chunkSize)
  // a partially written trailing chunk can't exist (chunks are stored whole), so offsets are exact
  while (job.totalBytes === 0 || job.bytesDownloaded < job.totalBytes) {
    if (signal.aborted) return fail('ABORTED', 'Download paused.', true)
    const start = nextIndex * chunkSize
    const end = job.totalBytes > 0 ? Math.min(start + chunkSize, job.totalBytes) - 1 : start + chunkSize - 1

    let response: Response | undefined
    for (let attempt = 0; ; attempt++) {
      try {
        response = await doFetch(job.url, {
          headers: { Range: `bytes=${start}-${end}` },
          credentials: job.credentials ? 'include' : 'omit',
          signal,
        })
        if (response.ok || response.status === 206) break
        if (NO_RETRY_STATUS.has(response.status)) {
          return fail('UNAVAILABLE', 'This file is no longer available to you (removed, unpublished, or access changed).', false)
        }
        if (response.status === 416 && job.totalBytes === 0) break // asked past the end of an unknown-size file
        throw new Error(`HTTP ${response.status}`)
      } catch (err) {
        if (err instanceof DownloadError) throw err
        if (signal.aborted) return fail('ABORTED', 'Download paused.', true)
        if (attempt >= maxRetries) {
          return fail('NETWORK', 'The connection was interrupted. Your progress is saved; try again when you are back online.', true)
        }
        await sleep(500 * 2 ** attempt)
      }
    }
    if (!response) return fail('NETWORK', 'No response from the server.', true)

    if (response.status === 416) break

    let body: Blob
    try {
      body = await response.blob()
    } catch {
      if (signal.aborted) return fail('ABORTED', 'Download paused.', true)
      return fail('NETWORK', 'The connection was interrupted. Your progress is saved; try again when you are back online.', true)
    }

    if (response.status === 200) {
      // The server ignored Range and sent the whole file: store it as a single part and finish.
      await db.downloadParts.where('jobId').equals(spec.id).delete()
      job.chunkSize = Math.max(body.size, 1)
      job.totalBytes = body.size
      try {
        await db.downloadParts.put({ jobId: spec.id, index: 0, blob: body })
      } catch (err) {
        if (isQuotaError(err)) return fail('STORAGE_LIMIT', 'The browser refused to store this file (storage is full).', false)
        throw err
      }
      job.bytesDownloaded = body.size
      break
    }

    const range = response.headers.get('content-range')?.match(/bytes (\d+)-(\d+)\/(\d+|\*)/)
    if (range && range[3] !== '*') {
      const announced = Number(range[3])
      if (job.totalBytes > 0 && announced !== job.totalBytes) {
        return fail('INTEGRITY', 'The file changed on the server while downloading; it was discarded. Please download it again.', false)
      }
      job.totalBytes = announced
    }
    const expected = job.totalBytes > 0 ? Math.min(chunkSize, job.totalBytes - start) : chunkSize
    if (body.size === 0 || (job.totalBytes > 0 && body.size !== expected)) {
      return fail('BAD_RESPONSE', 'The server returned an incomplete piece of the file.', true)
    }

    try {
      await db.downloadParts.put({ jobId: spec.id, index: nextIndex, blob: body })
    } catch (err) {
      if (isQuotaError(err)) return fail('STORAGE_LIMIT', 'The browser refused to store more data (storage is full). Free some space and retry.', true)
      throw err
    }
    job.bytesDownloaded = start + body.size
    nextIndex += 1
    await saveJob(job)
    report('downloading')
    if (job.totalBytes === 0 && body.size < chunkSize) {
      job.totalBytes = job.bytesDownloaded // unknown-size file: a short final chunk ends it
    }
  }

  // --- verify before declaring success -----------------------------------------------------
  job.status = 'verifying'
  await saveJob(job)
  report('verifying')

  const parts: DownloadPart[] = await db.downloadParts.where('jobId').equals(spec.id).toArray()
  parts.sort((a, b) => a.index - b.index)
  const assembled = new Blob(parts.map((p) => p.blob), { type: spec.mimeType || 'application/octet-stream' })

  if (job.totalBytes > 0 && assembled.size !== job.totalBytes) {
    return fail('INTEGRITY', 'The downloaded file is incomplete; it was discarded.', false)
  }
  if (spec.checksum && assembled.size <= MAX_HASH_BYTES) {
    const actual = await sha256Hex(assembled)
    if (actual !== spec.checksum) {
      return fail('INTEGRITY', 'The downloaded file failed its integrity check and was discarded.', false)
    }
  }

  job.status = 'completed'
  report('completed')
  return assembled
}
