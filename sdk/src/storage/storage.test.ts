// =============================================================================
// storage.test.ts — StorageBucket tests
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageBucket } from './index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE   = 'http://localhost:8080'
const BUCKET = 'avatars'
const TOKEN  = 'storage-token'

/** Returns a StorageBucket using the shared BASE / BUCKET. */
function bucket(token: string | null = TOKEN): StorageBucket {
  return new StorageBucket(BASE, BUCKET, token)
}

/** Minimal fetch mock that resolves to the given body. */
function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    blob: vi.fn().mockResolvedValue(new Blob(['image-data'], { type: 'image/png' })),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    statusText: ok ? 'OK' : 'Bad Request',
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// getPublicUrl
// ---------------------------------------------------------------------------

describe('StorageBucket.getPublicUrl', () => {
  it('returns the correct public URL for a file', () => {
    const { data } = bucket().getPublicUrl('user/profile.png')
    expect(data.publicUrl).toBe(`${BASE}/storage/v1/${BUCKET}/user/profile.png`)
  })

  it('handles filenames with spaces and special characters', () => {
    const { data } = bucket().getPublicUrl('my file (1).png')
    expect(data.publicUrl).toBe(`${BASE}/storage/v1/${BUCKET}/my file (1).png`)
  })

  it('handles nested paths', () => {
    const { data } = bucket().getPublicUrl('2024/01/report.pdf')
    expect(data.publicUrl).toBe(`${BASE}/storage/v1/${BUCKET}/2024/01/report.pdf`)
  })
})

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

describe('StorageBucket.upload', () => {
  it('POSTs to the correct URL and returns path + publicUrl on success', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    const blob = new Blob(['data'], { type: 'image/png' })
    const { data, error } = await bucket().upload('user.png', blob)

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.path).toBe('user.png')
    expect(data!.url).toBe(`${BASE}/storage/v1/${BUCKET}/user.png`)

    const call = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe(`${BASE}/storage/v1/${BUCKET}/user.png`)
    expect(call[1].method).toBe('POST')   // default (no upsert)
  })

  it('uses PUT when upsert: true is passed', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    const blob = new Blob(['data'])
    await bucket().upload('user.png', blob, { upsert: true })

    const method = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1].method
    expect(method).toBe('PUT')
  })

  it('includes Authorization header when token is set', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    await bucket(TOKEN).upload('file.png', new Blob(['x']))

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('does not include Authorization header when no token is set', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    await bucket(null).upload('file.png', new Blob(['x']))

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })

  it('sets Content-Type header when contentType option is provided', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    await bucket().upload('doc.pdf', new Blob([]), { contentType: 'application/pdf' })

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/pdf')
  })

  it('sets Cache-Control header when cacheControl option is provided', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    await bucket().upload('img.png', new Blob([]), { cacheControl: '3600' })

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Cache-Control']).toBe('max-age=3600')
  })

  it('returns error when the server responds with 400', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'file_too_large' }, false, 400))

    const { data, error } = await bucket().upload('big.png', new Blob(['x']))

    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('returns network_error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    const { data, error } = await bucket().upload('img.png', new Blob(['x']))

    expect(data).toBeNull()
    expect(error!.error).toBe('network_error')
  })
})

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

describe('StorageBucket.download', () => {
  it('GETs the file and returns a Blob on success', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    const { data, error } = await bucket().download('file.png')

    expect(error).toBeNull()
    expect(data).toBeInstanceOf(Blob)

    const call = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe(`${BASE}/storage/v1/${BUCKET}/file.png`)
    // Default method for fetch is GET (no method in init)
    expect(call[1].method).toBeUndefined()
  })

  it('includes Authorization header when token is set', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    await bucket(TOKEN).download('file.png')

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('returns download_failed error on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok:         false,
        statusText: 'Not Found',
        blob:       vi.fn(),
      }),
    )

    const { data, error } = await bucket().download('missing.png')

    expect(data).toBeNull()
    expect(error!.error).toBe('download_failed')
    expect(error!.message).toBe('Not Found')
  })

  it('returns network_error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const { data, error } = await bucket().download('file.png')

    expect(data).toBeNull()
    expect(error!.error).toBe('network_error')
  })
})

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('StorageBucket.remove', () => {
  it('sends DELETE for each path in the array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 204, json: vi.fn() }),
    )

    const { data, error } = await bucket().remove(['a.png', 'b.png', 'c.png'])

    expect(error).toBeNull()
    expect(data).toBeNull()

    const calls = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(3)

    const methods   = calls.map((c) => c[1].method)
    const calledUrls = calls.map((c) => c[0] as string)

    expect(methods.every((m) => m === 'DELETE')).toBe(true)
    expect(calledUrls[0]).toBe(`${BASE}/storage/v1/${BUCKET}/a.png`)
    expect(calledUrls[1]).toBe(`${BASE}/storage/v1/${BUCKET}/b.png`)
    expect(calledUrls[2]).toBe(`${BASE}/storage/v1/${BUCKET}/c.png`)
  })

  it('sends DELETE to the correct URL for a single file', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: vi.fn() })
    vi.stubGlobal('fetch', fetchMock)

    await bucket().remove(['file.png'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/storage/v1/${BUCKET}/file.png`)
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('includes Authorization header in DELETE requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 204, json: vi.fn() }),
    )

    await bucket(TOKEN).remove(['secure.png'])

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('returns delete_partial error when one or more DELETEs fail', async () => {
    // First call succeeds, second fails
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true,  status: 204, json: vi.fn() })
      .mockResolvedValueOnce({ ok: false, status: 404, json: vi.fn() })
    vi.stubGlobal('fetch', fetchMock)

    const { data, error } = await bucket().remove(['good.png', 'missing.png'])

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error!.error).toBe('delete_partial')
    expect(error!.message).toContain('missing.png')
  })

  it('handles an empty paths array gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const { data, error } = await bucket().remove([])

    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
