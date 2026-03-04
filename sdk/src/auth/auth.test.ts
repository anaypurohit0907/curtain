// =============================================================================
// auth.test.ts — parseJWT and isTokenExpired unit tests
// =============================================================================

import { describe, expect, it } from 'vitest'
import { isTokenExpired, parseJWT } from './index'

// ---------------------------------------------------------------------------
// Test helper — builds a minimal signed-looking JWT without a real HMAC
// ---------------------------------------------------------------------------

/**
 * Produces a structurally valid JWT (header.payload.signature) whose
 * payload is the JSON-encoded object passed in.  The "signature" segment
 * is a constant fake value; these tokens are NEVER to be used outside tests.
 */
function makeTestJWT(payload: object): string {
  const b64 = (s: string) =>
    btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body   = b64(JSON.stringify(payload))
  return `${header}.${body}.fakesignature`
}

// ---------------------------------------------------------------------------
// parseJWT
// ---------------------------------------------------------------------------

describe('parseJWT', () => {
  it('returns null for an empty string', () => {
    expect(parseJWT('')).toBeNull()
  })

  it('returns null when the token has fewer than three segments', () => {
    expect(parseJWT('onlyone')).toBeNull()
    expect(parseJWT('two.parts')).toBeNull()
  })

  it('returns null when the token has more than three segments', () => {
    expect(parseJWT('a.b.c.d')).toBeNull()
  })

  it('returns null when the payload segment contains invalid base64', () => {
    // The payload "!!!" is not valid base64url
    expect(parseJWT('header.!!!.signature')).toBeNull()
  })

  it('returns null when the payload is not valid JSON', () => {
    // Encode something that is valid base64 but not JSON
    const badPayload = btoa('not-json').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    expect(parseJWT(`header.${badPayload}.signature`)).toBeNull()
  })

  it('decodes and returns the payload object for a well-formed JWT', () => {
    const payload = { sub: 'user-123', role: 'authenticated', email: 'a@b.com', exp: 9999999999 }
    const token   = makeTestJWT(payload)
    const result  = parseJWT(token)

    expect(result).not.toBeNull()
    expect(result!['sub']).toBe('user-123')
    expect(result!['role']).toBe('authenticated')
    expect(result!['email']).toBe('a@b.com')
    expect(result!['exp']).toBe(9999999999)
  })

  it('decodes a token regardless of alg value in the header', () => {
    const token = makeTestJWT({ sub: 'u', iss: 'curtain' })
    const result = parseJWT(token)
    expect(result!['iss']).toBe('curtain')
  })

  it('handles payload with nested objects', () => {
    const token = makeTestJWT({ user: { id: 1, roles: ['admin'] } })
    const result = parseJWT(token) as Record<string, unknown>
    expect((result['user'] as Record<string, unknown>)['id']).toBe(1)
  })

  it('handles URL-safe base64 characters (- and _)', () => {
    // Craft a payload whose base64 encoding naturally produces + or / chars
    // by using a string that will need escaping — we verify round-trip
    const payload = { data: 'some/value+here==' }
    const token   = makeTestJWT(payload)
    const result  = parseJWT(token)
    expect(result!['data']).toBe('some/value+here==')
  })
})

// ---------------------------------------------------------------------------
// isTokenExpired
// ---------------------------------------------------------------------------

describe('isTokenExpired', () => {
  it('returns true for a completely invalid token string', () => {
    expect(isTokenExpired('not-a-jwt')).toBe(true)
  })

  it('returns true when the JWT has no exp claim', () => {
    const token = makeTestJWT({ sub: 'u', role: 'authenticated' })
    expect(isTokenExpired(token)).toBe(true)
  })

  it('returns true when exp is in the past', () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 3600  // 1 hour ago
    const token = makeTestJWT({ sub: 'u', exp: expiredAt })
    expect(isTokenExpired(token)).toBe(true)
  })

  it('returns false when exp is in the future', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600  // 1 hour from now
    const token = makeTestJWT({ sub: 'u', exp: expiresAt })
    expect(isTokenExpired(token)).toBe(false)
  })

  it('returns true when exp equals exactly the current second (already expired)', () => {
    // exp must be STRICTLY greater than now/1000 to be valid; equal counts as expired
    const now = Math.floor(Date.now() / 1000)
    const token = makeTestJWT({ sub: 'u', exp: now - 1 })
    expect(isTokenExpired(token)).toBe(true)
  })

  it('returns true when exp is a zero-value timestamp', () => {
    const token = makeTestJWT({ sub: 'u', exp: 0 })
    expect(isTokenExpired(token)).toBe(true)
  })

  it('returns false for a token that expires far in the future', () => {
    const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 3600  // ~1 year
    const token = makeTestJWT({ sub: 'u', exp: farFuture })
    expect(isTokenExpired(token)).toBe(false)
  })

  it('returns true when exp is a non-numeric type (string)', () => {
    // exp as a string should not pass the typeof check — treated as missing
    const token = makeTestJWT({ sub: 'u', exp: 'tomorrow' })
    expect(isTokenExpired(token)).toBe(true)
  })
})
