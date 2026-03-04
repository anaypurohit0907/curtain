// =============================================================================
// Auth — standalone types and utilities for Curtain authentication
// =============================================================================
//
// The auth *methods* live on CurtainClient.auth, but JWT helpers and type
// definitions that are useful without the full client are exported from here.
// =============================================================================

export type { Session, User } from '../types'

// ── Credential shapes ────────────────────────────────────────────────────────

export interface SignUpCredentials {
  email: string
  password: string
}

export interface SignInCredentials {
  email: string
  password: string
}

// ── Auth-event types for session-change listeners ────────────────────────────

/** Events emitted by the auth subsystem that callers can react to. */
export type AuthEvent =
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'

export interface AuthStateChangeCallback {
  (event: AuthEvent, session: import('../types').Session | null): void
}

// ── JWT helpers ──────────────────────────────────────────────────────────────

/**
 * Decode the payload section of a JWT without signature verification.
 * Intended for client-side use only (e.g. reading the `exp` or `role` claims).
 *
 * Returns `null` when the token is malformed or the JSON cannot be parsed.
 *
 * @example
 * const claims = parseJWT(session.access_token)
 * console.log(claims?.sub)   // user id
 * console.log(claims?.role)  // 'authenticated'
 */
export function parseJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    // Convert base64url → standard base64 before decoding
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload))
  } catch {
    return null
  }
}

/**
 * Returns `true` when a JWT has expired or cannot be decoded.
 *
 * Uses the `exp` claim (seconds since epoch) and compares it against the
 * current time with a 0-second grace period.
 *
 * @example
 * if (isTokenExpired(session.access_token)) {
 *   await client.auth.refreshSession()
 * }
 */
export function isTokenExpired(token: string): boolean {
  const payload = parseJWT(token)
  if (!payload || typeof payload['exp'] !== 'number') return true
  return (payload['exp'] as number) < Date.now() / 1000
}
