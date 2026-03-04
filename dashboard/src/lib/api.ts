// src/lib/api.ts
// Thin fetch wrapper for Curtain REST APIs.
// No SDK import — plain fetch to avoid circular dependencies.

const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost'

const TOKEN_KEY = 'curtain.access_token'

// ---------------------------------------------------------------------------
// Core helper
// ---------------------------------------------------------------------------

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { token?: string },
): Promise<{ data: T | null; error: string | null }> {
  const { token: explicitToken, ...fetchOptions } = options ?? {}

  // Resolve token: caller-supplied > localStorage
  const token = explicitToken ?? localStorage.getItem(TOKEN_KEY) ?? undefined

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> | undefined),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      headers,
    })

    if (!res.ok) {
      let errMsg = `HTTP ${res.status} ${res.statusText}`
      try {
        const errBody = (await res.json()) as { message?: string; error?: string }
        errMsg = errBody.message ?? errBody.error ?? errMsg
      } catch {
        // ignore JSON parse errors on error body
      }
      return { data: null, error: errMsg }
    }

    // Handle 204 No Content
    if (res.status === 204) {
      return { data: null, error: null }
    }

    const contentType = res.headers.get('Content-Type') ?? ''
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as T
      return { data, error: null }
    }

    // Return raw text wrapped in unknown for non-JSON responses
    const text = await res.text()
    return { data: text as unknown as T, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { data: null, error: message }
  }
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  provider?: string
  role?: string
  confirmed_at?: string | null
  created_at?: string
}

export interface SignInResponse {
  access_token: string
  token_type: string
  expires_in?: number
  user?: AuthUser
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ data: SignInResponse | null; error: string | null }> {
  return apiFetch<SignInResponse>('/auth/v1/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function signOut(): Promise<{ data: null; error: string | null }> {
  const result = await apiFetch<null>('/auth/v1/signout', { method: 'POST' })
  clearToken()
  return result
}

export async function listUsers(
  token: string,
): Promise<{ data: AuthUser[] | null; error: string | null }> {
  return apiFetch<AuthUser[]>('/auth/v1/admin/users', { token })
}

// ---------------------------------------------------------------------------
// Storage endpoints  (MinIO S3-compatible via the storage gateway)
// ---------------------------------------------------------------------------

export interface StorageBucket {
  Name: string
  CreationDate?: string
  // Additional metadata may come from the gateway layer
  public?: boolean
  objectCount?: number
}

export interface StorageObject {
  Key: string
  Size?: number
  LastModified?: string
  ETag?: string
}

export async function listBuckets(
  token: string,
): Promise<{ data: StorageBucket[] | null; error: string | null }> {
  // The gateway returns JSON-wrapped bucket list
  return apiFetch<StorageBucket[]>('/storage/v1/', { token })
}

export async function listObjects(
  token: string,
  bucket: string,
): Promise<{ data: StorageObject[] | null; error: string | null }> {
  return apiFetch<StorageObject[]>(`/storage/v1/${bucket}?list-type=2`, { token })
}

export async function uploadObject(
  token: string,
  bucket: string,
  filename: string,
  file: Blob,
): Promise<{ data: null; error: string | null }> {
  // PUT /storage/v1/{bucket}/{filename}
  const res = await fetch(`${API_URL}/storage/v1/${bucket}/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  })
  if (!res.ok) {
    return { data: null, error: `HTTP ${res.status} ${res.statusText}` }
  }
  return { data: null, error: null }
}

export async function deleteObject(
  token: string,
  bucket: string,
  key: string,
): Promise<{ data: null; error: string | null }> {
  return apiFetch<null>(`/storage/v1/${bucket}/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    token,
  })
}

// ---------------------------------------------------------------------------
// Functions / Edge endpoints
// ---------------------------------------------------------------------------

export interface EdgeFunction {
  id: string
  name: string
  slug: string
  active?: boolean
  code?: string
  created_at?: string
  updated_at?: string
}

export async function listFunctions(
  token: string,
): Promise<{ data: EdgeFunction[] | null; error: string | null }> {
  return apiFetch<EdgeFunction[]>('/functions/v1/functions', { token })
}

export async function createFunction(
  token: string,
  name: string,
  slug: string,
  code: string,
): Promise<{ data: EdgeFunction | null; error: string | null }> {
  return apiFetch<EdgeFunction>('/functions/v1/functions', {
    method: 'POST',
    token,
    body: JSON.stringify({ name, slug, code, active: true }),
  })
}

export async function updateFunction(
  token: string,
  id: string,
  code: string,
): Promise<{ data: EdgeFunction | null; error: string | null }> {
  return apiFetch<EdgeFunction>(`/functions/v1/functions/${id}`, {
    method: 'PUT',
    token,
    body: JSON.stringify({ code }),
  })
}

export async function deleteFunction(
  token: string,
  id: string,
): Promise<{ data: null; error: string | null }> {
  return apiFetch<null>(`/functions/v1/functions/${id}`, {
    method: 'DELETE',
    token,
  })
}

export async function invokeFunction(
  token: string,
  slug: string,
  body: unknown = {},
): Promise<{ data: unknown; error: string | null }> {
  return apiFetch<unknown>(`/functions/v1/invoke/${slug}`, {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Database / PostgREST endpoints
// ---------------------------------------------------------------------------

export async function queryTable(
  token: string,
  table: string,
  limit = 100,
): Promise<{ data: Record<string, unknown>[] | null; error: string | null }> {
  const path = `/rest/v1/${encodeURIComponent(table)}?select=*&limit=${limit}`
  return apiFetch<Record<string, unknown>[]>(path, {
    token,
    headers: {
      // PostgREST requires these headers for proper JSON array response
      Accept: 'application/json',
      'Accept-Profile': 'public',
    },
  })
}

// ---------------------------------------------------------------------------
// Raw SQL query endpoint
// ---------------------------------------------------------------------------

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  command: string
  rowsAffected: number
}

export async function executeQuery(
  token: string,
  query: string,
): Promise<{ data: QueryResult | null; error: string | null }> {
  return apiFetch<QueryResult>('/db/v1/query', {
    method: 'POST',
    token,
    body: JSON.stringify({ query }),
  })
}
