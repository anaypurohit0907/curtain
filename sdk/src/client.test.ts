// =============================================================================
// client.test.ts — CurtainClient integration tests
// =============================================================================
// Scope: every method on client.auth plus the channel/storage/from accessors.
// fetch is stubbed globally; localStorage is cleared before every test.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, CurtainClient } from './client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = 'http://localhost:8080'

/** Build a minimal fetch mock that always resolves to a JSON body. */
function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json:  vi.fn().mockResolvedValue(body),
    text:  vi.fn().mockResolvedValue(JSON.stringify(body)),
    blob:  vi.fn().mockResolvedValue(new Blob()),
  })
}

/** A fetch mock whose .json() rejects (e.g. 204 No Content). */
function mockFetchNoContent(ok = true, status = 204) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockRejectedValue(new Error('no body')),
    text: vi.fn().mockResolvedValue(''),
  })
}

/** Cast to any to reach private fields in tests. */
const priv = (c: CurtainClient) => c as unknown as Record<string, unknown>

// ---------------------------------------------------------------------------
// Auth — signUp
// ---------------------------------------------------------------------------

describe('CurtainClient.auth.signUp', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /auth/v1/signup and returns the session', async () => {
    const sessionPayload = {
      access_token:  'tok-access',
      refresh_token: 'tok-refresh',
      token_type:    'bearer',
      expires_in:    3600,
      user: { id: '123', email: 'a@b.com', role: 'authenticated' },
    }
    vi.stubGlobal('fetch', mockFetch(sessionPayload))

    const client = createClient(BASE)
    const { data, error } = await client.auth.signUp({ email: 'a@b.com', password: 'secret' })

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.access_token).toBe('tok-access')

    // Token must be persisted on the client instance
    expect(priv(client)._accessToken).toBe('tok-access')

    // localStorage must also be populated
    expect(localStorage.getItem('curtain.access_token')).toBe('tok-access')
    expect(localStorage.getItem('curtain.refresh_token')).toBe('tok-refresh')

    // Verify the correct URL was called
    const calledUrl = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe(`${BASE}/auth/v1/signup`)
  })

  it('returns error when the server responds with 400', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ error: 'email_exists', message: 'E-mail already in use' }, false, 400),
    )

    const client = createClient(BASE)
    const { data, error } = await client.auth.signUp({ email: 'dup@b.com', password: 'secret' })

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error!.error).toBe('email_exists')
    // Token must NOT be stored
    expect(priv(client)._accessToken).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Auth — signIn
// ---------------------------------------------------------------------------

describe('CurtainClient.auth.signIn', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /auth/v1/signin and stores the access token', async () => {
    const sessionPayload = {
      access_token:  'signin-tok',
      refresh_token: 'signin-ref',
      token_type:    'bearer',
      expires_in:    3600,
      user: { id: 'u1', email: 'a@b.com', role: 'authenticated' },
    }
    vi.stubGlobal('fetch', mockFetch(sessionPayload))

    const client = createClient(BASE)
    const { data, error } = await client.auth.signIn({ email: 'a@b.com', password: 'secret' })

    expect(error).toBeNull()
    expect(data!.access_token).toBe('signin-tok')
    expect(priv(client)._accessToken).toBe('signin-tok')
    expect(priv(client)._refreshToken).toBe('signin-ref')

    const calledUrl = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe(`${BASE}/auth/v1/signin`)
  })

  it('sends Authorization header on subsequent calls after signIn', async () => {
    const sessionPayload = {
      access_token:  'bearer-abc',
      refresh_token: 'ref-abc',
      token_type:    'bearer',
      expires_in:    3600,
      user: { id: 'u2', email: 'b@c.com', role: 'authenticated' },
    }
    const fetchMock = mockFetch(sessionPayload)
    vi.stubGlobal('fetch', fetchMock)

    const client = createClient(BASE)
    await client.auth.signIn({ email: 'b@c.com', password: 'pw' })

    // Make a second call — should carry the bearer token
    await client.auth.getUser()

    const secondCallHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>
    expect(secondCallHeaders['Authorization']).toBe('Bearer bearer-abc')
  })
})

// ---------------------------------------------------------------------------
// Auth — signOut
// ---------------------------------------------------------------------------

describe('CurtainClient.auth.signOut', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears the access token after signOut', async () => {
    // First stub a successful signIn so we have a token
    const sessionPayload = {
      access_token:  'tok-to-clear',
      refresh_token: 'ref-to-clear',
      token_type:    'bearer',
      expires_in:    3600,
      user: { id: 'u3', email: 'c@d.com', role: 'authenticated' },
    }
    vi.stubGlobal('fetch', mockFetch(sessionPayload))

    const client = createClient(BASE)
    await client.auth.signIn({ email: 'c@d.com', password: 'pw' })

    expect(priv(client)._accessToken).toBe('tok-to-clear')

    // Now stub 204 for signOut
    vi.stubGlobal('fetch', mockFetchNoContent())

    const { data, error } = await client.auth.signOut()

    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(priv(client)._accessToken).toBeNull()
    expect(priv(client)._refreshToken).toBeNull()
    expect(localStorage.getItem('curtain.access_token')).toBeNull()
    expect(localStorage.getItem('curtain.refresh_token')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Auth — refreshSession
// ---------------------------------------------------------------------------

describe('CurtainClient.auth.refreshSession', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an error without calling fetch when no refresh token is stored', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const client = createClient(BASE)
    const { data, error } = await client.auth.refreshSession()

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error!.error).toBe('no_session')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs to /auth/v1/token/refresh and updates the stored token', async () => {
    const client = createClient(BASE)

    // Manually set a refresh token (simulates a prior signIn)
    client.auth.setSession('old-access', 'old-refresh')

    const newSession = {
      access_token:  'new-access',
      refresh_token: 'new-refresh',
      token_type:    'bearer',
      expires_in:    3600,
      user: { id: 'u4', email: 'd@e.com', role: 'authenticated' },
    }
    vi.stubGlobal('fetch', mockFetch(newSession))

    const { data, error } = await client.auth.refreshSession()

    expect(error).toBeNull()
    expect(data!.access_token).toBe('new-access')
    expect(priv(client)._accessToken).toBe('new-access')

    const calledUrl = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe(`${BASE}/auth/v1/token/refresh`)
  })
})

// ---------------------------------------------------------------------------
// Auth — getUser
// ---------------------------------------------------------------------------

describe('CurtainClient.auth.getUser', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('GETs /auth/v1/user and returns the user object', async () => {
    const user = {
      id:        'u5',
      email:     'e@f.com',
      provider:  'email',
      role:      'authenticated',
      metadata:  {},
      confirmed: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }
    vi.stubGlobal('fetch', mockFetch(user))

    const client = createClient(BASE)
    const { data, error } = await client.auth.getUser()

    expect(error).toBeNull()
    expect(data!.id).toBe('u5')
    expect(data!.email).toBe('e@f.com')

    const call = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe(`${BASE}/auth/v1/user`)
    expect(call[1].method).toBe('GET')
  })
})

// ---------------------------------------------------------------------------
// Auth — getSessionFromURL
// ---------------------------------------------------------------------------

describe('CurtainClient.auth.getSessionFromURL', () => {
  afterEach(() => {
    // Reset hash
    window.location.hash = ''
    localStorage.clear()
  })

  it('parses access_token and refresh_token from window.location.hash', () => {
    window.location.hash = '#access_token=mytoken&refresh_token=myref'

    const client = createClient(BASE)
    const session = client.auth.getSessionFromURL()

    expect(session).not.toBeNull()
    expect(session!.access_token).toBe('mytoken')
    expect(session!.refresh_token).toBe('myref')
    expect(priv(client)._accessToken).toBe('mytoken')
    expect(priv(client)._refreshToken).toBe('myref')
  })

  it('returns null when the hash contains no access_token', () => {
    window.location.hash = '#some_other_param=value'

    const client = createClient(BASE)
    const session = client.auth.getSessionFromURL()

    expect(session).toBeNull()
  })

  it('returns null when there is no hash at all', () => {
    window.location.hash = ''

    const client = createClient(BASE)
    const session = client.auth.getSessionFromURL()

    expect(session).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Auth — setSession / getAccessToken
// ---------------------------------------------------------------------------

describe('CurtainClient.auth.setSession and getAccessToken', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('setSession updates _accessToken and localStorage', () => {
    const client = createClient(BASE)
    client.auth.setSession('manual-tok', 'manual-ref')

    expect(priv(client)._accessToken).toBe('manual-tok')
    expect(priv(client)._refreshToken).toBe('manual-ref')
    expect(localStorage.getItem('curtain.access_token')).toBe('manual-tok')
    expect(client.auth.getAccessToken()).toBe('manual-tok')
  })

  it('setSession without refresh token preserves existing refresh token', () => {
    const client = createClient(BASE)
    client.auth.setSession('tok-a', 'ref-a')
    client.auth.setSession('tok-b')

    expect(priv(client)._accessToken).toBe('tok-b')
    expect(priv(client)._refreshToken).toBe('ref-a')  // unchanged
  })
})

// ---------------------------------------------------------------------------
// Client constructor — session restored from localStorage
// ---------------------------------------------------------------------------

describe('CurtainClient constructor — localStorage restore', () => {
  it('reads stored tokens from localStorage on construction', () => {
    localStorage.setItem('curtain.access_token',  'stored-tok')
    localStorage.setItem('curtain.refresh_token', 'stored-ref')

    const client = createClient(BASE)

    expect(priv(client)._accessToken).toBe('stored-tok')
    expect(priv(client)._refreshToken).toBe('stored-ref')

    localStorage.clear()
  })
})

// ---------------------------------------------------------------------------
// client.from — delegates to QueryBuilder
// ---------------------------------------------------------------------------

describe('CurtainClient.from', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delegates to QueryBuilder and returns data on GET', async () => {
    const rows = [{ id: 1, name: 'Laptop' }]
    vi.stubGlobal('fetch', mockFetch(rows))

    const client = createClient(BASE)
    const { data, error } = await client.from('products').select('*').get()

    expect(error).toBeNull()
    expect(data).toEqual(rows)

    const calledUrl = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('/rest/v1/products')
    expect(calledUrl).toContain('select=*')
  })
})

// ---------------------------------------------------------------------------
// client.storage — delegates to StorageBucket
// ---------------------------------------------------------------------------

describe('CurtainClient.storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('storage.from returns a StorageBucket that resolves getPublicUrl', () => {
    const client = createClient(BASE)
    const { data } = client.storage.from('avatars').getPublicUrl('user.png')
    expect(data.publicUrl).toBe(`${BASE}/storage/v1/avatars/user.png`)
  })
})

// ---------------------------------------------------------------------------
// client.functions.invoke
// ---------------------------------------------------------------------------

describe('CurtainClient.functions.invoke', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('POSTs to /functions/v1/invoke/:name with JSON body', async () => {
    const responseBody = { sent: true }
    vi.stubGlobal('fetch', mockFetch(responseBody))

    const client = createClient(BASE)
    const { data, error } = await client.functions.invoke<{ sent: boolean }>('send-email', {
      body: { to: 'x@y.com' },
    })

    expect(error).toBeNull()
    expect(data!.sent).toBe(true)

    const call   = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0]
    const calledUrl = call[0] as string
    expect(calledUrl).toBe(`${BASE}/functions/v1/invoke/send-email`)

    const calledInit = call[1] as RequestInit
    expect(calledInit.method).toBe('POST')
    expect(JSON.parse(calledInit.body as string)).toEqual({ to: 'x@y.com' })
  })

  it('includes Authorization header when a token is set', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: true }))

    const client = createClient(BASE)
    client.auth.setSession('fn-tok')
    await client.functions.invoke('do-something')

    const headers = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer fn-tok')
  })

  it('returns error on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'fn_error', message: 'bad input' }, false, 422))

    const client = createClient(BASE)
    const { data, error } = await client.functions.invoke('broken-fn')

    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })
})
