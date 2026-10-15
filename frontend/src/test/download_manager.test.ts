import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { db } from '../db/db'
import { downloadManager } from '../services/downloadManager'
import { ApiError } from '../services/apiClient'
import type { Material, Recording, Summary } from '../types'

const FILE = new Uint8Array(Array.from({ length: 5000 }, (_, i) => (i * 3 + 1) % 251))
const SHA = createHash('sha256').update(FILE).digest('hex')

const material: Material = {
  id: 'mat-1', course_id: 'c-1', title: 'Week 1 Notes', file_url: '/api/v1/resources/mat-1/download', file_type: 'application/pdf',
  file_size: FILE.length, is_published: true, created_at: '', resource_type: 'document', version: 2,
}

interface World {
  version: number
  checksum: string
  infoStatus: number
  dataCalls: string[]
  infoCalls: number
  offline: boolean
  file: Uint8Array
}
const world: World = { version: 2, checksum: SHA, infoStatus: 200, dataCalls: [], infoCalls: 0, offline: false, file: FILE }

/** Routes the API's download-info call and the file's range requests like the real server does. */
const server = vi.fn(async (url: string, init: RequestInit = {}) => {
  if (world.offline) throw new TypeError('Failed to fetch')
  if (url.includes('/download-info')) {
    world.infoCalls++
    if (world.infoStatus !== 200) {
      return { ok: false, status: world.infoStatus, json: async () => ({ error: { code: 'NOT_FOUND', message: 'gone' } }) }
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        url: '/api/v1/resources/download-content/k1', same_origin: true, version: world.version,
        size_bytes: world.file.length, checksum_sha256: world.checksum, mime_type: 'application/pdf',
      }),
    }
  }
  const range = new Headers(init.headers).get('Range')!
  world.dataCalls.push(range)
  const [, s, e] = range.match(/bytes=(\d+)-(\d+)/)!
  const start = Number(s), end = Math.min(Number(e), world.file.length - 1)
  return {
    ok: true, status: 206,
    headers: new Headers({ 'content-range': `bytes ${start}-${end}/${world.file.length}` }),
    blob: async () => new Blob([world.file.slice(start, end + 1)]),
  }
})

beforeEach(async () => {
  vi.unstubAllGlobals()
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('fetch', server)
  Object.assign(world, { version: 2, checksum: SHA, infoStatus: 200, dataCalls: [], infoCalls: 0, offline: false, file: FILE })
  server.mockClear()
  await Promise.all([db.downloadedResources.clear(), db.downloadedRecordings.clear(), db.downloadedSummaries.clear(), db.downloadJobs.clear(), db.downloadParts.clear()])
})

describe('downloadManager.downloadResource', () => {
  it('downloads the real bytes, verifies them, and only then reports available offline', async () => {
    expect((await downloadManager.getResourceStatus('mat-1')).state).toBe('not_downloaded')
    const percents: number[] = []
    const record = await downloadManager.downloadResource(material, undefined, (p) => percents.push(p), { chunkSize: 2000 })

    expect(world.dataCalls).toEqual(['bytes=0-1999', 'bytes=2000-3999', 'bytes=4000-4999'])
    expect(record).toMatchObject({ id: 'mat-1', version: 2, checksum: SHA, sizeBytes: 5000 })
    expect(new Uint8Array(await record.blob!.arrayBuffer())).toEqual(FILE)
    expect(percents.at(-1)).toBe(100)
    expect(await downloadManager.getResourceStatus('mat-1', 2)).toMatchObject({ state: 'available_offline', percent: 100 })
    expect(await db.downloadJobs.count()).toBe(0) // temporary chunks are cleaned up
    expect(await db.downloadParts.count()).toBe(0)
  })

  it('does not download again when a verified copy of the current version is already stored', async () => {
    await downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000 })
    world.dataCalls = []
    const again = await downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000 })
    expect(world.dataCalls).toEqual([]) // only the cheap metadata check hit the network
    expect(again.version).toBe(2)
  })

  it('still opens the existing copy when offline (no error, no data loss)', async () => {
    await downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000 })
    world.offline = true
    const again = await downloadManager.downloadResource(material)
    expect(again.id).toBe('mat-1')
    expect(await downloadManager.isDownloaded('mat-1')).toBe(true)
  })

  it('detects a newer server version and re-downloads only then', async () => {
    await downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000 })
    expect((await downloadManager.getResourceStatus('mat-1', 3)).state).toBe('update_available')

    world.version = 3
    world.file = FILE.map((b) => (b + 5) % 251)
    world.checksum = createHash('sha256').update(world.file).digest('hex')
    const updated = await downloadManager.downloadResource({ ...material, version: 3 }, undefined, undefined, { chunkSize: 2000 })
    expect(updated.version).toBe(3)
    expect(new Uint8Array(await updated.blob!.arrayBuffer())).toEqual(world.file)
  })

  it('reports a removed/unpublished file as unavailable and stores nothing', async () => {
    world.infoStatus = 404
    await expect(downloadManager.downloadResource(material)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(await downloadManager.isDownloaded('mat-1')).toBe(false)
    expect((await downloadManager.getResourceStatus('mat-1')).state).toBe('not_downloaded')
  })

  it('a corrupted download never becomes "available offline"', async () => {
    world.checksum = 'f'.repeat(64)
    await expect(downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000 })).rejects.toMatchObject({ code: 'INTEGRITY' })
    expect(await downloadManager.isDownloaded('mat-1')).toBe(false)
    expect((await downloadManager.getResourceStatus('mat-1')).state).toBe('not_downloaded')
  })

  it('an interrupted download shows as paused with its progress and can be resumed', async () => {
    const controller = new AbortController()
    server.mockImplementationOnce(server.getMockImplementation()!) // info
    const original = server.getMockImplementation()!
    let data = 0
    server.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (!url.includes('/download-info') && ++data === 2) controller.abort()
      return original(url, init)
    })
    await expect(downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000, signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' })
    const status = await downloadManager.getResourceStatus('mat-1')
    expect(status.state).toBe('paused')
    expect(status.percent).toBe(80) // two of three chunks were safely stored

    server.mockImplementation(original)
    world.dataCalls = []
    const record = await downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000 })
    expect(world.dataCalls).toEqual(['bytes=4000-4999']) // resumed after the two stored chunks, not restarted
    expect(record.sizeBytes).toBe(5000)
  })

  it('deleting a download frees both the file and any partial data', async () => {
    await downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000 })
    await downloadManager.deleteDownload('mat-1')
    expect(await downloadManager.isDownloaded('mat-1')).toBe(false)
    expect(await downloadManager.getResourceBlobUrl('mat-1')).toBeNull()
  })
})

describe('offline summaries and recordings', () => {
  const summary: Summary = {
    id: 's-1', class_id: 'cls-1', course_id: 'c-1', status: 'COMPLETED', review_status: 'APPROVED', overview: 'Photosynthesis',
    key_concepts: ['Chlorophyll'], revision_questions: ['What is a chloroplast?'], created_at: '',
  }

  it('downloads an approved summary and reads it back without any network request', async () => {
    await downloadManager.downloadSummary(summary, 'Biology L1')
    server.mockClear()
    world.offline = true
    const saved = await downloadManager.getDownloadedSummaryForClass('cls-1')
    expect(saved?.payload.overview).toBe('Photosynthesis')
    expect(saved?.payload.revision_questions).toEqual(['What is a chloroplast?'])
    expect(server).not.toHaveBeenCalled()
  })

  it('refuses to download a summary the teacher has not approved', async () => {
    await expect(downloadManager.downloadSummary({ ...summary, status: 'NEEDS_REVIEW' })).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(await db.downloadedSummaries.count()).toBe(0)
  })

  it('downloads a ready recording through the same verified engine and refuses one that is still processing', async () => {
    const recording = {
      id: 'rec-1', course_id: 'c-1', title: 'Lecture 1', duration_seconds: 60, file_size_bytes: FILE.length, status: 'READY',
      video_url: 'https://files.example/rec-1.mp4?sig=abc', download_url: 'https://files.example/rec-1.mp4?sig=abc',
    } as unknown as Recording
    const saved = await downloadManager.downloadRecording(recording, undefined, { chunkSize: 2000 })
    expect(saved.fileSizeBytes).toBe(5000)
    expect(await downloadManager.isRecordingDownloaded('rec-1')).toBe(true)
    expect(world.dataCalls).toHaveLength(3)

    await expect(downloadManager.downloadRecording({ ...recording, id: 'rec-2', status: 'PROCESSING' } as Recording)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })

  it('saves a downloaded resource and a downloaded recording to the real device, not just IndexedDB', async () => {
    const createdUrls: string[] = []
    const revokedUrls: string[] = []
    const clicks: HTMLAnchorElement[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((b: Blob) => {
        const u = `blob:fake-${createdUrls.length}`
        createdUrls.push(u)
        return u
      }),
      revokeObjectURL: vi.fn((u: string) => revokedUrls.push(u)),
    })
    const realClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = vi.fn(function (this: HTMLAnchorElement) {
      clicks.push(this)
    })

    try {
      await downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000 })
      await downloadManager.saveResourceToDevice('mat-1')
      expect(clicks).toHaveLength(1)
      expect(clicks[0].download).toBe('Week 1 Notes.pdf')
      expect(clicks[0].href).toBe(createdUrls[0])

      const recording = {
        id: 'rec-save-1', course_id: 'c-1', title: 'Lecture: Mitochondria', duration_seconds: 60, file_size_bytes: FILE.length,
        status: 'READY', video_url: 'https://files.example/rec-save-1.mp4?sig=x', download_url: 'https://files.example/rec-save-1.mp4?sig=x',
      } as unknown as Recording
      await downloadManager.downloadRecording(recording, undefined, { chunkSize: 2000 })
      await downloadManager.saveRecordingToDevice('rec-save-1')
      expect(clicks).toHaveLength(2)
      // Filesystem-unsafe characters (the colon) are sanitized out of the suggested filename.
      expect(clicks[1].download).toBe('Lecture_ Mitochondria.mp4')

      // Never downloaded -> a clear error, not a silent no-op.
      await expect(downloadManager.saveRecordingToDevice('never-downloaded')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    } finally {
      HTMLAnchorElement.prototype.click = realClick
    }
  })

  it('shared-device sign-out removes downloads, partial downloads and saved summaries', async () => {
    await downloadManager.downloadResource(material, undefined, undefined, { chunkSize: 2000 })
    await downloadManager.downloadSummary(summary)
    await db.downloadJobs.put({ id: 'x', url: 'u', credentials: false, totalBytes: 1, bytesDownloaded: 0, chunkSize: 1, version: 1, status: 'paused', updatedAt: '' })
    await db.downloadParts.put({ jobId: 'x', index: 0, blob: new Blob(['a']) })
    await db.clearPrivateUserData({ includeDownloads: true })
    expect([await db.downloadedResources.count(), await db.downloadedSummaries.count(), await db.downloadJobs.count(), await db.downloadParts.count()]).toEqual([0, 0, 0, 0])
  })
})

describe('storage reporting', () => {
  it('reports unsupported browsers honestly and real numbers when available', async () => {
    vi.stubGlobal('navigator', { storage: undefined })
    expect((await downloadManager.getStorageEstimate()).supported).toBe(false)
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 50 * 1024 * 1024, quota: 500 * 1024 * 1024 }), persisted: async () => true } })
    expect(await downloadManager.getStorageEstimate()).toMatchObject({ supported: true, availableMB: 450, percentageUsed: 10, persisted: true })
  })
})

describe('API errors', () => {
  it('ApiError carries the HTTP status the manager relies on', () => {
    expect(new ApiError('x', 404).status).toBe(404)
  })
})
