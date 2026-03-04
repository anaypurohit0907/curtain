// =============================================================================
// db.test.ts — QueryBuilder tests
// =============================================================================
// Every test stubs the global fetch, exercises the builder, and asserts that
// the correct URL / method / body was passed to fetch.
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryBuilder } from './index'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE = 'http://localhost:8080'

/** Returns a minimal fetch mock that resolves to the given JSON body. */
function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  })
}

/** Convenience: create a QueryBuilder for `table` with no auth token. */
function qb<T = Record<string, unknown>>(table: string): QueryBuilder<T> {
  return new QueryBuilder<T>(BASE, table, null)
}

/** Parse the search params from a fetch-call URL string. */
function searchParams(url: string) {
  return new URLSearchParams(new URL(url).search)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// SELECT / GET
// ---------------------------------------------------------------------------

describe('QueryBuilder.get', () => {
  it('select("*").get() — builds correct URL and returns rows', async () => {
    const rows = [{ id: 1, name: 'Laptop' }]
    vi.stubGlobal('fetch', mockFetch(rows))

    const { data, error } = await qb('products').select('*').get()

    expect(error).toBeNull()
    expect(data).toEqual(rows)

    const calledUrl = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('/rest/v1/products')
    expect(searchParams(calledUrl).get('select')).toBe('*')
  })

  it('select with specific columns', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('products').select('id,name,price').get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(searchParams(url).get('select')).toBe('id,name,price')
  })

  it('.eq("id", 5) — appends id=eq.5 filter to URL', async () => {
    vi.stubGlobal('fetch', mockFetch([{ id: 5 }]))

    await qb('products').select('*').eq('id', 5).get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(searchParams(url).get('id')).toBe('eq.5')
  })

  it('.neq("status", "inactive") — appends status=neq.inactive', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('orders').select('*').neq('status', 'inactive').get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(searchParams(url).get('status')).toBe('neq.inactive')
  })

  it('.gt("price", 1000) — appends price=gt.1000', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('products').select('*').gt('price', 1000).get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(searchParams(url).get('price')).toBe('gt.1000')
  })

  it('.gte / .lt / .lte filters', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('orders').select('*').gte('amount', 100).lt('amount', 500).lte('qty', 10).get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const sp  = searchParams(url)
    expect(sp.get('amount')).toBe('gte.100')   // first occurrence
    // URLSearchParams.get returns only the FIRST value; use getAll for multi
    expect(sp.getAll('amount')[1]).toBe('lt.500')
    expect(sp.get('qty')).toBe('lte.10')
  })

  it('.like and .ilike filters', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('users').select('*').like('email', '%@example.com').ilike('name', 'john%').get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const sp  = searchParams(url)
    expect(sp.get('email')).toBe('like.%@example.com')
    expect(sp.get('name')).toBe('ilike.john%')
  })

  it('.in("role", [...]) — builds in.(...) filter', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('users').select('*').in('role', ['admin', 'editor']).get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(searchParams(url).get('role')).toBe('in.(admin,editor)')
  })

  it('.is("deleted_at", null)', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('posts').select('*').is('deleted_at', null).get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(searchParams(url).get('deleted_at')).toBe('is.null')
  })

  it('.order("created_at", { ascending: false }) — appends order=created_at.desc', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('posts').select('*').order('created_at', { ascending: false }).get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(searchParams(url).get('order')).toBe('created_at.desc')
  })

  it('.order("name") — defaults to ascending', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('products').select('*').order('name').get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(searchParams(url).get('order')).toBe('name.asc')
  })

  it('.limit(10) — appends limit=10', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('products').select('*').limit(10).get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(searchParams(url).get('limit')).toBe('10')
  })

  it('.range(0, 9) — produces limit=10&offset=0', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('products').select('*').range(0, 9).get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const sp  = searchParams(url)
    expect(sp.get('limit')).toBe('10')
    expect(sp.get('offset')).toBe('0')
  })

  it('.range(20, 29) — produces limit=10&offset=20', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('products').select('*').range(20, 29).get()

    const url = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const sp  = searchParams(url)
    expect(sp.get('limit')).toBe('10')
    expect(sp.get('offset')).toBe('20')
  })

  it('.single() — sets Accept: application/vnd.pgrst.object+json header', async () => {
    vi.stubGlobal('fetch', mockFetch({ id: 1, name: 'solo' }))

    await qb('products').select('*').eq('id', 1).single().get()

    const initArg = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect((initArg.headers as Record<string, string>)['Accept']).toBe(
      'application/vnd.pgrst.object+json',
    )
  })

  it('returns error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const { data, error } = await qb('products').select('*').get()

    expect(data).toBeNull()
    expect(error!.error).toBe('network_error')
  })

  it('returns error when server responds with 500', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'server_error', message: 'oops' }, false, 500))

    const { data, error } = await qb('products').select('*').get()

    expect(data).toBeNull()
    expect(error!.error).toBe('server_error')
  })
})

// ---------------------------------------------------------------------------
// INSERT / POST
// ---------------------------------------------------------------------------

describe('QueryBuilder.insert', () => {
  it('.insert({ name: "laptop" }) — POSTs JSON body to /rest/v1/products', async () => {
    const created = [{ id: 10, name: 'laptop' }]
    vi.stubGlobal('fetch', mockFetch(created))

    const fetchMock = vi.mocked(fetch) as ReturnType<typeof vi.fn>
    const { data, error } = await qb('products').insert({ name: 'laptop' })

    expect(error).toBeNull()
    expect(data).toEqual(created)

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe(`${BASE}/rest/v1/products`)
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body as string)).toEqual({ name: 'laptop' })
  })

  it('.insert([...]) — accepts an array of rows', async () => {
    vi.stubGlobal('fetch', mockFetch([{ id: 1 }, { id: 2 }]))

    const fetchMock = vi.mocked(fetch) as ReturnType<typeof vi.fn>
    await qb('products').insert([{ name: 'a' }, { name: 'b' }])

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual([{ name: 'a' }, { name: 'b' }])
  })

  it('sends Prefer: return=representation by default', async () => {
    vi.stubGlobal('fetch', mockFetch([{}]))

    await qb('products').insert({ name: 'x' })

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Prefer']).toBe('return=representation')
  })

  it('sends Prefer: return=minimal when requested', async () => {
    vi.stubGlobal('fetch', mockFetch([{}]))

    await qb('products').insert({ name: 'x' }, { returning: 'minimal' })

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Prefer']).toBe('return=minimal')
  })
})

// ---------------------------------------------------------------------------
// UPDATE / PATCH
// ---------------------------------------------------------------------------

describe('QueryBuilder.update', () => {
  it('.eq("id",1).update({ name:"desktop" }) — PATCHes with filter in URL', async () => {
    vi.stubGlobal('fetch', mockFetch([{ id: 1, name: 'desktop' }]))

    const fetchMock = vi.mocked(fetch) as ReturnType<typeof vi.fn>
    const { data, error } = await qb('products').eq('id', 1).update({ name: 'desktop' })

    expect(error).toBeNull()
    expect(data).not.toBeNull()

    const call = fetchMock.mock.calls[0]
    const url  = call[0] as string
    const init = call[1] as RequestInit

    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'desktop' })
    expect(url).toContain('/rest/v1/products')
    expect(searchParams(url).get('id')).toBe('eq.1')
  })

  it('update without filters logs a warning (does not throw)', async () => {
    vi.stubGlobal('fetch', mockFetch([{}]))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await qb('products').update({ active: false })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('update()'))
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('QueryBuilder.delete', () => {
  it('.eq("id",1).delete() — sends DELETE to filtered URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: vi.fn() }))

    const fetchMock = vi.mocked(fetch) as ReturnType<typeof vi.fn>
    const { data, error } = await qb('products').eq('id', 1).delete()

    expect(error).toBeNull()
    expect(data).toBeNull()

    const call = fetchMock.mock.calls[0]
    const url  = call[0] as string
    const init = call[1] as RequestInit

    expect(init.method).toBe('DELETE')
    expect(url).toContain('/rest/v1/products')
    expect(searchParams(url).get('id')).toBe('eq.1')
  })

  it('delete without filters logs a warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: vi.fn() }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await qb('products').delete()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('delete()'))
    warnSpy.mockRestore()
  })

  it('returns error on non-ok DELETE response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok:   false,
        status: 404,
        json: vi.fn().mockResolvedValue({ error: 'not_found', message: 'row not found' }),
      }),
    )

    const { error } = await qb('products').eq('id', 999).delete()

    expect(error).not.toBeNull()
    expect(error!.error).toBe('not_found')
  })
})

// ---------------------------------------------------------------------------
// Authorization header
// ---------------------------------------------------------------------------

describe('QueryBuilder — Authorization header', () => {
  it('includes Bearer token in GET request when token is set', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    const builder = new QueryBuilder('http://localhost', 'products', 'my-token')
    await builder.select('*').get()

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer my-token')
  })

  it('omits Authorization header when token is null', async () => {
    vi.stubGlobal('fetch', mockFetch([]))

    await qb('products').select('*').get()

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })
})
