import { QueryBuilder } from './db'
import { RealtimeChannel } from './realtime'
import { StorageBucket } from './storage'
import type { ApiResponse, CurtainConfig, Session, User } from './types'

// =============================================================================
// CurtainClient — main entry point
// =============================================================================

export class CurtainClient {
  private baseURL: string
  private _accessToken: string | null = null
  private _refreshToken: string | null = null

  constructor(private config: CurtainConfig) {
    this.baseURL = config.url.replace(/\/$/, '')
    // Restore session from localStorage (browser environments)
    if (typeof localStorage !== 'undefined') {
      this._accessToken  = localStorage.getItem('curtain.access_token')
      this._refreshToken = localStorage.getItem('curtain.refresh_token')
    }
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  auth = {
    /** Create a new user account with email and password. */
    signUp: async (credentials: {
      email: string
      password: string
    }): Promise<ApiResponse<Session>> => {
      const res = await this._fetch('/auth/v1/signup', 'POST', credentials)
      if (res.data) this._storeSession(res.data as Session)
      return res as ApiResponse<Session>
    },

    /** Sign in with email and password. */
    signIn: async (credentials: {
      email: string
      password: string
    }): Promise<ApiResponse<Session>> => {
      const res = await this._fetch('/auth/v1/signin', 'POST', credentials)
      if (res.data) this._storeSession(res.data as Session)
      return res as ApiResponse<Session>
    },

    /** Sign out and revoke refresh token. */
    signOut: async (): Promise<ApiResponse<null>> => {
      await this._fetch('/auth/v1/signout', 'POST', {
        refresh_token: this._refreshToken,
      })
      this._clearSession()
      return { data: null, error: null }
    },

    /** Get the currently authenticated user. */
    getUser: async (): Promise<ApiResponse<User>> => {
      return this._fetch('/auth/v1/user', 'GET', null) as Promise<ApiResponse<User>>
    },

    /** Refresh the access token using the stored refresh token. */
    refreshSession: async (): Promise<ApiResponse<Session>> => {
      if (!this._refreshToken) {
        return { data: null, error: { error: 'no_session', message: 'no refresh token' } }
      }
      const res = await this._fetch('/auth/v1/token/refresh', 'POST', {
        refresh_token: this._refreshToken,
      })
      if (res.data) this._storeSession(res.data as Session)
      return res as ApiResponse<Session>
    },

    /** Manually set session tokens (useful after OAuth redirect callback). */
    setSession: (accessToken: string, refreshToken?: string) => {
      this._accessToken  = accessToken
      this._refreshToken = refreshToken ?? this._refreshToken
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('curtain.access_token', accessToken)
        if (refreshToken) {
          localStorage.setItem('curtain.refresh_token', refreshToken)
        }
      }
    },

    /** Returns the current stored access token or null. */
    getAccessToken: (): string | null => this._accessToken,

    /** Build the Google OAuth redirect URL. */
    signInWithGoogle: () => {
      window.location.href = `${this.baseURL}/auth/v1/oauth/google`
    },

    /** Parse OAuth tokens from the URL hash after redirect callback. */
    getSessionFromURL: (): Session | null => {
      if (typeof window === 'undefined') return null
      const hash = window.location.hash.slice(1)
      const params = new URLSearchParams(hash)
      const accessToken  = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      if (!accessToken) return null
      this._accessToken  = accessToken
      this._refreshToken = refreshToken
      if (refreshToken && typeof localStorage !== 'undefined') {
        localStorage.setItem('curtain.access_token', accessToken)
        localStorage.setItem('curtain.refresh_token', refreshToken)
      }
      return { access_token: accessToken, refresh_token: refreshToken ?? '' } as unknown as Session
    },
  }

  // ── Database ────────────────────────────────────────────────────────────────

  /**
   * Start a database query on the given table.
   * Returns a QueryBuilder for chaining filters.
   *
   * @example
   * const { data } = await client.from('products').select('*').eq('active', true).get()
   */
  from<T = Record<string, unknown>>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this.baseURL, table, this._accessToken)
  }

  // ── Realtime ────────────────────────────────────────────────────────────────

  /**
   * Subscribe to real-time changes on a Postgres table.
   *
   * @example
   * client.channel('public:orders')
   *   .on('INSERT', payload => console.log('new order:', payload.new))
   *   .subscribe()
   */
  channel(channelName: string): RealtimeChannel {
    return new RealtimeChannel(this.baseURL, channelName, this._accessToken)
  }

  // ── Storage ─────────────────────────────────────────────────────────────────

  storage = {
    /**
     * Get a storage bucket client.
     *
     * @example
     * await client.storage.from('avatars').upload('user123.png', file)
     */
    from: (bucket: string): StorageBucket =>
      new StorageBucket(this.baseURL, bucket, this._accessToken),
  }

  // ── Edge Functions ─────────────────────────────────────────────────────────

  functions = {
    /**
     * Invoke a deployed edge function by name.
     *
     * @example
     * const { data } = await client.functions.invoke('send-email', {
     *   body: { to: 'user@example.com', subject: 'Hello!' }
     * })
     */
    invoke: async <T = unknown>(
      functionName: string,
      options?: { body?: unknown; headers?: Record<string, string> },
    ): Promise<ApiResponse<T>> => {
      const hdrs: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      }
      if (this._accessToken) {
        hdrs['Authorization'] = `Bearer ${this._accessToken}`
      }
      try {
        const res = await fetch(`${this.baseURL}/functions/v1/invoke/${functionName}`, {
          method: 'POST',
          headers: hdrs,
          body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
        })
        const text = await res.text()
        let data: unknown
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
        if (!res.ok) return { data: null, error: data as ApiError }
        return { data: data as T, error: null }
      } catch (e) {
        return { data: null, error: { error: 'network_error', message: String(e) } }
      }
    },
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async _fetch(path: string, method: string, body: unknown): Promise<ApiResponse<unknown>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this._accessToken) {
      headers['Authorization'] = `Bearer ${this._accessToken}`
    }
    try {
      const res = await fetch(this.baseURL + path, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) return { data: null, error: data }
      return { data, error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  private _storeSession(session: Session) {
    this._accessToken  = session.access_token
    this._refreshToken = session.refresh_token
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('curtain.access_token',  session.access_token)
      localStorage.setItem('curtain.refresh_token', session.refresh_token)
    }
  }

  private _clearSession() {
    this._accessToken  = null
    this._refreshToken = null
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('curtain.access_token')
      localStorage.removeItem('curtain.refresh_token')
    }
  }
}

/**
 * Create an Curtain client instance.
 *
 * @example
 * import { createClient } from 'curtain'
 * const client = createClient('https://baas.example.com')
 */
export function createClient(url: string, anonKey?: string): CurtainClient {
  return new CurtainClient({ url, anonKey })
}

// Re-export ApiError for downstream use
import type { ApiError } from './types'
