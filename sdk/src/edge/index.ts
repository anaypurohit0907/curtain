// =============================================================================
// Edge Functions — types and client for deployed server-side functions
// =============================================================================

// ── Domain types ─────────────────────────────────────────────────────────────

export interface EdgeFunction {
  id:         string
  name:       string
  slug:       string
  code:       string
  env_vars:   Record<string, string>
  active:     boolean
  created_at: string
  updated_at: string
}

/** Options forwarded to the function when calling invoke(). */
export interface InvokeOptions {
  /** Request body — will be JSON-serialised unless already a string. */
  body?:    unknown
  /** Extra HTTP headers merged on top of Authorization / Content-Type. */
  headers?: Record<string, string>
}

/**
 * The return shape for every invoke() call.
 * `statusCode` and `durationMs` are populated on success *and* HTTP error
 * responses; they are absent only when a network-level error prevents the
 * request from completing at all.
 */
export interface InvokeResult<T = unknown> {
  data:        T | null
  error:       { error: string; message: string } | null
  statusCode?: number
  durationMs?: number
}

// ── FunctionsClient ──────────────────────────────────────────────────────────

/**
 * Low-level client for managing and invoking edge functions.
 * An instance is created internally by CurtainClient but can also be
 * instantiated directly for use in admin / CLI tooling.
 *
 * @example
 * const fc = new FunctionsClient('https://baas.example.com', () => token)
 * const { data } = await fc.invoke<{ sent: boolean }>('send-email', {
 *   body: { to: 'user@example.com' }
 * })
 */
export class FunctionsClient {
  constructor(
    private baseURL:   string,
    private getToken:  () => string | null,
  ) {
    // Normalise trailing slash once.
    this.baseURL = baseURL.replace(/\/$/, '')
  }

  // ── Invoking ───────────────────────────────────────────────────────────────

  /**
   * Invoke an edge function by its slug.
   * Always returns an InvokeResult — never throws.
   */
  async invoke<T = unknown>(
    slug:     string,
    options?: InvokeOptions,
  ): Promise<InvokeResult<T>> {
    const token = this.getToken()
    const hdrs: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    }
    if (token) hdrs['Authorization'] = `Bearer ${token}`

    const startMs = Date.now()
    try {
      const res = await fetch(
        `${this.baseURL}/functions/v1/invoke/${slug}`,
        {
          method:  'POST',
          headers: hdrs,
          body:    options?.body !== undefined ? JSON.stringify(options.body) : undefined,
        },
      )

      const durationMs  = Date.now() - startMs
      const statusCode  = res.status
      const text        = await res.text()

      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }

      if (!res.ok) {
        const err =
          typeof data === 'object' && data !== null && 'error' in data
            ? (data as { error: string; message: string })
            : { error: 'function_error', message: String(data) }
        return { data: null, error: err, statusCode, durationMs }
      }

      return { data: data as T, error: null, statusCode, durationMs }
    } catch (e) {
      return {
        data:       null,
        error:      { error: 'network_error', message: String(e) },
        durationMs: Date.now() - startMs,
      }
    }
  }

  // ── Management ─────────────────────────────────────────────────────────────

  /** List all deployed edge functions. */
  async list(): Promise<{ data: EdgeFunction[] | null; error: unknown }> {
    try {
      const res  = await fetch(`${this.baseURL}/functions/v1`, {
        headers: this._authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      return { data: data as EdgeFunction[], error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  /** Deploy a new edge function. */
  async create(
    name: string,
    slug: string,
    code: string,
  ): Promise<{ data: EdgeFunction | null; error: unknown }> {
    try {
      const res  = await fetch(`${this.baseURL}/functions/v1`, {
        method:  'POST',
        headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, slug, code }),
      })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      return { data: data as EdgeFunction, error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  /** Update (re-deploy) the code of an existing function by id. */
  async update(
    id:   string,
    code: string,
  ): Promise<{ data: EdgeFunction | null; error: unknown }> {
    try {
      const res  = await fetch(`${this.baseURL}/functions/v1/${id}`, {
        method:  'PATCH',
        headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      return { data: data as EdgeFunction, error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  /** Delete a deployed edge function by id. */
  async delete(id: string): Promise<{ data: null; error: unknown }> {
    try {
      const res = await fetch(`${this.baseURL}/functions/v1/${id}`, {
        method:  'DELETE',
        headers: this._authHeaders(),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        return { data: null, error: err }
      }
      return { data: null, error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _authHeaders(): Record<string, string> {
    const token = this.getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
}
