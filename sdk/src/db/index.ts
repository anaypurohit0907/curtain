import type { ApiResponse } from '../types'

// =============================================================================
// QueryBuilder — PostgREST-compatible database query builder
// =============================================================================

type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'is'

export class QueryBuilder<T = Record<string, unknown>> {
  private _select  = '*'
  private _filters: string[] = []
  private _orderCol: string | null = null
  private _orderAsc = true
  private _limitVal: number | null = null
  private _offsetVal: number | null = null
  private _single  = false

  constructor(
    private baseURL: string,
    private table:   string,
    private token:   string | null,
  ) {}

  // ── Column selection ────────────────────────────────────────────────────────

  select(columns: string): this {
    this._select = columns
    return this
  }

  // ── Filters ─────────────────────────────────────────────────────────────────

  eq   (col: string, val: unknown): this { return this._filter(col, 'eq',    val) }
  neq  (col: string, val: unknown): this { return this._filter(col, 'neq',   val) }
  gt   (col: string, val: unknown): this { return this._filter(col, 'gt',    val) }
  gte  (col: string, val: unknown): this { return this._filter(col, 'gte',   val) }
  lt   (col: string, val: unknown): this { return this._filter(col, 'lt',    val) }
  lte  (col: string, val: unknown): this { return this._filter(col, 'lte',   val) }
  like (col: string, pattern: string): this { return this._filter(col, 'like',  pattern) }
  ilike(col: string, pattern: string): this { return this._filter(col, 'ilike', pattern) }
  is   (col: string, val: null | boolean): this { return this._filter(col, 'is', val) }

  in(col: string, vals: unknown[]): this {
    this._filters.push(`${col}=in.(${vals.join(',')})`)
    return this
  }

  private _filter(col: string, op: FilterOperator, val: unknown): this {
    this._filters.push(`${col}=${op}.${val}`)
    return this
  }

  // ── Sorting & pagination ────────────────────────────────────────────────────

  order(column: string, options?: { ascending?: boolean }): this {
    this._orderCol = column
    this._orderAsc = options?.ascending !== false
    return this
  }

  limit(n: number): this {
    this._limitVal = n
    return this
  }

  range(from: number, to: number): this {
    this._offsetVal = from
    this._limitVal  = to - from + 1
    return this
  }

  /** Return a single row (throws if 0 or >1 rows). */
  single(): this {
    this._single = true
    return this
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  async get(): Promise<ApiResponse<T[]>> {
    const url  = this._buildURL()
    const hdrs = this._headers()
    if (this._single) {
      hdrs['Accept'] = 'application/vnd.pgrst.object+json'
    }
    try {
      const res  = await fetch(url, { method: 'GET', headers: hdrs })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      return { data: this._single ? [data] : data, error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  async insert(
    values: Partial<T> | Partial<T>[],
    options?: { returning?: 'minimal' | 'representation' },
  ): Promise<ApiResponse<T[]>> {
    const hdrs = this._headers()
    hdrs['Prefer'] = `return=${options?.returning ?? 'representation'}`
    try {
      const res  = await fetch(`${this.baseURL}/rest/v1/${this.table}`, {
        method:  'POST',
        headers: hdrs,
        body:    JSON.stringify(values),
      })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      return { data: Array.isArray(data) ? data : [data], error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  async update(
    values: Partial<T>,
    options?: { returning?: 'minimal' | 'representation' },
  ): Promise<ApiResponse<T[]>> {
    if (this._filters.length === 0) {
      console.warn('curtain: calling update() without any filters will update ALL rows!')
    }
    const hdrs = this._headers()
    hdrs['Prefer'] = `return=${options?.returning ?? 'representation'}`
    try {
      const res  = await fetch(this._buildURL(), {
        method:  'PATCH',
        headers: hdrs,
        body:    JSON.stringify(values),
      })
      const data = await res.json()
      if (!res.ok) return { data: null, error: data }
      return { data: Array.isArray(data) ? data : [data], error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  async delete(): Promise<ApiResponse<null>> {
    if (this._filters.length === 0) {
      console.warn('curtain: calling delete() without any filters will delete ALL rows!')
    }
    try {
      const res = await fetch(this._buildURL(), {
        method:  'DELETE',
        headers: this._headers(),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        return { data: null, error: data }
      }
      return { data: null, error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _buildURL(): string {
    const params = new URLSearchParams()
    params.set('select', this._select)
    for (const f of this._filters) {
      const eqIdx = f.indexOf('=')
      params.append(f.slice(0, eqIdx), f.slice(eqIdx + 1))
    }
    if (this._orderCol) {
      params.set('order', `${this._orderCol}.${this._orderAsc ? 'asc' : 'desc'}`)
    }
    if (this._limitVal  !== null) params.set('limit',  String(this._limitVal))
    if (this._offsetVal !== null) params.set('offset', String(this._offsetVal))
    return `${this.baseURL}/rest/v1/${this.table}?${params}`
  }

  private _headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    }
    if (this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }
}
