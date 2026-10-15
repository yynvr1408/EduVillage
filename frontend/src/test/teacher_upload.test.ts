import { describe, it, expect, vi, afterEach } from 'vitest'
import { api } from '../services/apiClient'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

afterEach(() => vi.unstubAllGlobals())

describe('teacher resource upload', () => {
  it('sends title/description/type, uploads the real bytes, and only reports success after the server completes it', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method || 'GET', body: init.body })
        if (url.endsWith('/resources/upload-init')) {
          return json({ resource_id: 'r1', upload: { method: 'PUT', url: '/api/v1/resources/upload-content/k1', fields: {} } })
        }
        if (url.includes('/upload-content/')) return { ok: true, status: 204, json: async () => ({}) }
        return json({
          id: 'r1', course_id: 'c1', filename: 'week1.pdf', title: 'Week 1', mime_type: 'application/pdf', size_bytes: 4,
          status: 'available', processing_status: 'ready', is_published: false, resource_type: 'document', version: 1,
        })
      })
    )

    const file = new File(['%PDF'], 'week1.pdf', { type: 'application/pdf' })
    const material = await api.uploadMaterial('c1', file, { title: 'Week 1', description: 'Cells', resourceType: 'document' })

    expect(calls.map((c) => c.method + ' ' + c.url.replace('http://localhost:8000', ''))).toEqual([
      'POST /api/v1/resources/upload-init',
      'PUT /api/v1/resources/upload-content/k1',
      'POST /api/v1/resources/r1/complete',
    ])
    expect(JSON.parse(calls[0].body as string)).toMatchObject({ title: 'Week 1', description: 'Cells', resource_type: 'document', size_bytes: 4 })
    expect(material).toMatchObject({ title: 'Week 1', processing_status: 'ready', is_published: false })
  })

  it('does not report success when the server rejects the content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/resources/upload-init')) {
          return json({ resource_id: 'r2', upload: { method: 'PUT', url: '/api/v1/resources/upload-content/k2', fields: {} } })
        }
        if (url.includes('/upload-content/')) return { ok: true, status: 204, json: async () => ({}) }
        return json({ error: { code: 'CONTENT_MISMATCH', message: "The file's contents do not match its extension; it was rejected." } }, 422)
      })
    )
    await expect(api.uploadMaterial('c1', new File(['MZ'], 'x.pdf', { type: 'application/pdf' }))).rejects.toMatchObject({
      code: 'CONTENT_MISMATCH',
    })
  })

  it('publishes through PATCH and reflects the server state', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ id: 'r1', course_id: 'c1', filename: 'a.pdf', mime_type: 'application/pdf', size_bytes: 1, status: 'available', is_published: true, processing_status: 'ready', version: 2 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const m = await api.setMaterialPublished('r1', true)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH' })
    expect(m).toMatchObject({ is_published: true, version: 2 })
  })
})

describe('uploads to object storage (R2 / S3)', () => {
  it('PUTs straight to the presigned URL with exactly the signed headers and without cookies or the API prefix', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        if (url.endsWith('/resources/upload-init')) {
          return json({
            resource_id: 'r9',
            upload: { method: 'PUT', url: 'https://acct.r2.cloudflarestorage.com/bucket/key?X-Amz-Signature=abc', fields: {}, headers: { 'Content-Type': 'video/mp4' } },
          })
        }
        if (url.startsWith('https://acct.r2')) return { ok: true, status: 200, json: async () => ({}) }
        return json({ id: 'r9', course_id: 'c1', filename: 'a.mp4', mime_type: 'video/mp4', size_bytes: 2, status: 'available', processing_status: 'ready', is_published: false })
      })
    )
    await api.uploadMaterial('c1', new File(['ab'], 'a.mp4', { type: 'video/mp4' }))
    const put = calls.find((c) => c.url.startsWith('https://acct.r2'))!
    expect(put.init.method).toBe('PUT')
    expect(put.init.credentials).toBe('omit') // no session cookie is sent to the storage provider
    expect(put.init.headers).toEqual({ 'Content-Type': 'video/mp4' }) // exactly what was signed
    expect(put.url).not.toContain('/api/v1/')
  })

  it('reports a storage failure instead of pretending the upload worked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/resources/upload-init')) return json({ resource_id: 'r9', upload: { method: 'PUT', url: 'https://s3.example/k', fields: {}, headers: {} } })
        return { ok: false, status: 403, json: async () => ({}) }
      })
    )
    await expect(api.uploadMaterial('c1', new File(['ab'], 'a.mp4', { type: 'video/mp4' }))).rejects.toMatchObject({ status: 403 })
  })
})
