# SDK Reference

The TypeScript SDK (`src/lib/api.ts` in the dashboard) is a thin wrapper around the Curtain HTTP APIs. This page documents every function so you can use this pattern in your own apps.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Configuration](#configuration)
- [Auth functions](#auth-functions)
- [Database functions](#database-functions)
- [Storage functions](#storage-functions)
- [Edge function functions](#edge-function-functions)
- [Token management](#token-management)
- [Core helper: apiFetch](#core-helper-apifetch)
- [Error handling pattern](#error-handling-pattern)
- [Full TypeScript types reference](#full-typescript-types-reference)

---

## Overview

The SDK follows a consistent pattern: every function returns a `{ data, error }` object. You never need a `try/catch` — errors are always returned, never thrown.

```typescript
const { data, error } = await signIn("alice@example.com", "password123")

if (error) {
  console.error("Login failed:", error)
  return
}

console.log("Logged in as:", data.user.email)
```

This pattern (inspired by Go's error handling and Supabase's SDK) makes it clear at every call site where errors can occur.

---

## Installation

The SDK is not published as an npm package yet. Copy the `api.ts` file into your project:

```bash
# Copy from this repo:
cp dashboard/src/lib/api.ts your-project/src/lib/api.ts
```

Or write your own wrapper — the SDK is just typed `fetch()` calls, nothing special.

**Dependencies**: None. Uses the browser's built-in `fetch()` API.

---

## Configuration

The base URL is read from the environment variable `VITE_API_URL`. If not set, it defaults to `http://localhost` (port 80, the default HTTP port).

In development with the dev stack (port 8080):
```env
# .env.local (your frontend project)
VITE_API_URL=http://localhost:8080
```

In production:
```env
VITE_API_URL=https://baas.yourdomain.com
```

The token is automatically read from `localStorage` at key `curtain.access_token`. You can either:
- Use `saveToken(token)` to store it
- Pass a `token` option directly in individual calls

---

## Auth functions

### `signIn(email, password)`

Signs in a user with email and password.

```typescript
import { signIn, saveToken } from './lib/api'

const { data, error } = await signIn("alice@example.com", "mysecretpassword")

if (error) {
  showError(error)  // e.g. "invalid email or password"
  return
}

// Save token for future requests
saveToken(data.access_token)
localStorage.setItem('refresh_token', data.refresh_token)

console.log("Signed in:", data.user.email)
```

**Returns**: `SignInResponse`
```typescript
{
  access_token:  string    // JWT, valid for 1 hour
  refresh_token: string    // Opaque token, valid for 7 days
  token_type:    string    // "bearer"
  expires_in:    number    // Seconds until access_token expires (3600)
  user: {
    id:         string   // UUID
    email:      string
    provider:   string   // "email" or "google"
    role:       string   // "authenticated"
    confirmed:  boolean
    created_at: string   // ISO timestamp
  }
}
```

---

### `signOut()`

Signs out the current user (invalidates the stored token).

```typescript
import { signOut, clearToken } from './lib/api'

const { error } = await signOut()
// clearToken() is called automatically inside signOut
// Redirect to login page
window.location.href = '/login'
```

---

### `listUsers(token)`

Returns all registered users. For admin/dashboard use.

```typescript
import { listUsers, getStoredToken } from './lib/api'

const token = getStoredToken()!
const { data: users, error } = await listUsers(token)

if (users) {
  console.log(`${users.length} users registered`)
  users.forEach(u => console.log(u.email, u.created_at))
}
```

---

## Database functions

### `queryTable(token, table, limit?)`

Fetches rows from a table via PostgREST. Returns up to `limit` rows (default 100).

```typescript
import { queryTable, getStoredToken } from './lib/api'

const token = getStoredToken()!

// Fetch products
const { data: products, error } = await queryTable(token, 'products', 50)

if (products) {
  products.forEach(p => {
    console.log(p.name, p.price)
  })
}
```

This calls `GET /rest/v1/{table}?select=*&limit={limit}` under the hood.

**For filtering, sorting, and joins**, call PostgREST directly (PostgREST has a rich query language that goes beyond what this helper wraps):

```typescript
import { apiFetch, getStoredToken } from './lib/api'

const token = getStoredToken()!

// Get active products under ₹1000, sorted by price
const { data } = await apiFetch<Product[]>(
  '/rest/v1/products?active=eq.true&price=lt.100000&order=price.asc',
  { token }
)
```

---

### `executeQuery(token, query)`

Executes any raw SQL query against the database. This is what the dashboard's SQL editor uses.

```typescript
import { executeQuery, getStoredToken } from './lib/api'

const token = getStoredToken()!

// SELECT query — returns rows and column names
const { data, error } = await executeQuery(token, `
  SELECT id, name, price FROM products WHERE active = true LIMIT 10
`)

if (data) {
  console.log("Columns:", data.columns)  // ["id", "name", "price"]
  console.log("Rows:", data.rows)        // [{id: 1, name: "Widget", price: 500}, ...]
}

// DDL query — returns command info
const { data: ddlResult } = await executeQuery(token, `
  CREATE TABLE IF NOT EXISTS todos (
    id         SERIAL PRIMARY KEY,
    text       TEXT NOT NULL,
    done       BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`)

if (ddlResult) {
  console.log(ddlResult.command)       // "CREATE TABLE"
  console.log(ddlResult.rowsAffected)  // 0
}
```

**Returns**: `QueryResult`
```typescript
{
  columns:      string[]                    // Column names (empty for DDL/DML)
  rows:         Record<string, unknown>[]   // Data rows (empty for DDL/DML)
  command:      string                      // e.g. "SELECT 10", "CREATE TABLE", "INSERT 0 1"
  rowsAffected: number                      // Rows affected for INSERT/UPDATE/DELETE
}
```

---

## Storage functions

### `listBuckets(token)`

```typescript
import { listBuckets, getStoredToken } from './lib/api'

const { data: buckets, error } = await listBuckets(getStoredToken()!)

buckets?.forEach(b => {
  console.log(b.Name, b.public ? "(public)" : "(private)")
})
```

**Returns**: `StorageBucket[]`
```typescript
{
  Name:          string
  CreationDate?: string
  public?:       boolean
}
```

---

### `listObjects(token, bucket)`

```typescript
import { listObjects, getStoredToken } from './lib/api'

const { data: files } = await listObjects(getStoredToken()!, 'avatars')

files?.forEach(f => {
  const sizeKB = ((f.Size ?? 0) / 1024).toFixed(1)
  console.log(`${f.Key} (${sizeKB} KB)`)
})
```

**Returns**: `StorageObject[]`
```typescript
{
  Key:          string   // File path (e.g. "user-123/photo.jpg")
  Size?:        number   // Bytes
  LastModified?: string  // ISO timestamp
  ETag?:        string   // File fingerprint
}
```

---

### `uploadObject(token, bucket, filename, file)`

```typescript
import { uploadObject, getStoredToken } from './lib/api'

// From a file input element
const fileInput = document.getElementById('file-input') as HTMLInputElement
const file = fileInput.files![0]

const { error } = await uploadObject(
  getStoredToken()!,
  'avatars',
  `user-123/${file.name}`,
  file
)

if (error) {
  console.error("Upload failed:", error)
} else {
  console.log("Upload successful!")
}
```

The `file` parameter is a `Blob` — any `File` object from a file input also works since `File` extends `Blob`.

---

### `deleteObject(token, bucket, key)`

```typescript
import { deleteObject, getStoredToken } from './lib/api'

const { error } = await deleteObject(getStoredToken()!, 'avatars', 'user-123/photo.jpg')

if (!error) {
  console.log("File deleted")
}
```

---

## Edge function functions

### `listFunctions(token)`

```typescript
import { listFunctions, getStoredToken } from './lib/api'

const { data: functions } = await listFunctions(getStoredToken()!)

functions?.forEach(fn => {
  console.log(`${fn.name} → /invoke/${fn.slug}`)
})
```

**Returns**: `EdgeFunction[]`
```typescript
{
  id:          string
  name:        string
  slug:        string
  active?:     boolean
  code?:       string   // May be omitted in list responses
  created_at?: string
  updated_at?: string
}
```

---

### `createFunction(token, name, slug, code)`

```typescript
import { createFunction, getStoredToken } from './lib/api'

const code = `
export default async function handler(req) {
  const { name } = await req.json()
  return new Response(JSON.stringify({ greeting: \`Hello, \${name}!\` }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
}
`.trim()

const { data: fn, error } = await createFunction(
  getStoredToken()!,
  'greeting',
  'greeting',
  code
)

if (fn) {
  console.log("Deployed:", fn.slug)
}
```

---

### `updateFunction(token, id, code)`

```typescript
const { data } = await updateFunction(getStoredToken()!, functionId, newCode)
```

---

### `deleteFunction(token, id)`

```typescript
const { error } = await deleteFunction(getStoredToken()!, functionId)
```

---

### `invokeFunction(token, slug, body?)`

```typescript
import { invokeFunction, getStoredToken } from './lib/api'

const { data, error } = await invokeFunction(
  getStoredToken()!,
  'greeting',
  { name: 'Alice' }
)

console.log(data)  // { greeting: "Hello, Alice!" }
```

The `body` defaults to `{}`. The function receives it as the JSON request body.

---

## Token management

```typescript
import { saveToken, clearToken, getStoredToken } from './lib/api'

// Save after login
saveToken(accessToken)

// Read (returns null if not logged in)
const token = getStoredToken()
if (!token) {
  // Redirect to login
}

// Remove on logout
clearToken()
```

Tokens are stored in `localStorage` at the key `curtain.access_token`.

---

## Core helper: apiFetch

All the functions above ultimately call `apiFetch`. You can use it directly for any endpoint not covered by the higher-level helpers.

```typescript
import { apiFetch, getStoredToken } from './lib/api'

// Custom PostgREST query with filters
const { data, error } = await apiFetch<Order[]>(
  '/rest/v1/orders?user_id=eq.550e8400&status=eq.pending&order=created_at.desc',
  {
    token: getStoredToken()!,
    headers: {
      Accept: 'application/json',
    }
  }
)

// POST with a custom body
const { data: result } = await apiFetch<{ ok: boolean }>(
  '/rest/v1/rpc/my_postgres_function',
  {
    method: 'POST',
    token: getStoredToken()!,
    body: JSON.stringify({ param1: 'value1' }),
  }
)
```

**Signature**:
```typescript
apiFetch<T>(
  path: string,
  options?: RequestInit & { token?: string }
): Promise<{ data: T | null; error: string | null }>
```

- `path` — URL path starting with `/`, appended to `VITE_API_URL`
- `options.token` — JWT token. Falls back to `localStorage.getItem('curtain.access_token')`
- All other `RequestInit` options (method, body, headers) are passed to `fetch()`

---

## Error handling pattern

Every function returns `{ data, error }`:

```typescript
// Pattern 1: early return on error
const { data, error } = await signIn(email, password)
if (error) {
  setErrorMessage(error)
  return
}
// data is guaranteed non-null here
doSomethingWith(data.access_token)

// Pattern 2: conditional use
const { data: users } = await listUsers(token)
const count = users?.length ?? 0  // safe even if data is null

// Pattern 3: parallel requests
const [productsResult, ordersResult] = await Promise.all([
  queryTable(token, 'products'),
  queryTable(token, 'orders'),
])
if (productsResult.error || ordersResult.error) {
  // handle error
}
```

---

## Full TypeScript types reference

```typescript
// Auth
interface AuthUser {
  id: string
  email: string
  provider?: string       // "email" | "google"
  role?: string           // "authenticated"
  confirmed_at?: string | null
  created_at?: string
}

interface SignInResponse {
  access_token:  string
  refresh_token: string
  token_type:    string
  expires_in?:   number
  user?:         AuthUser
}

// Storage
interface StorageBucket {
  Name:          string
  CreationDate?: string
  public?:       boolean
  objectCount?:  number
}

interface StorageObject {
  Key:           string
  Size?:         number
  LastModified?: string
  ETag?:         string
}

// Edge Functions
interface EdgeFunction {
  id:          string
  name:        string
  slug:        string
  active?:     boolean
  code?:       string
  created_at?: string
  updated_at?: string
}

// Database
interface QueryResult {
  columns:      string[]
  rows:         Record<string, unknown>[]
  command:      string
  rowsAffected: number
}
```

---

Next: [Deployment](./10-deployment.md) — setting up Curtain on a production VPS.
