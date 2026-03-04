# Services Deep Dive

This guide explains each service in Curtain: what it does, how it's structured, how to run it, and how to modify it. Even if you've never written Go before, you'll understand how each piece fits together.

---

## Table of Contents

- [Auth Service](#auth-service)
- [PostgREST](#postgrest)
- [Realtime Service](#realtime-service)
- [Edge Service](#edge-service)
- [Storage Gateway](#storage-gateway)
- [Dashboard](#dashboard)
- [Infrastructure services](#infrastructure-services-postgresql-minio)

---

## Auth Service

**Location**: `services/auth/`
**Language**: Go
**Port**: 9999
**Purpose**: Everything related to user identity — sign up, sign in, token management

### Directory structure

```
services/auth/
├── cmd/
│   └── main.go          # Entry point — router setup, server start
├── internal/
│   ├── handler/
│   │   ├── auth.go      # HTTP handlers (e.g. SignUp, SignIn, RunQuery)
│   │   ├── oauth.go     # Google OAuth handlers
│   │   ├── helpers.go   # Shared utilities (JWT middleware, JSON helpers)
│   │   ├── auth_test.go # Tests for auth handlers
│   │   └── middleware_test.go
│   ├── model/
│   │   └── user.go      # User struct definition
│   └── store/
│       └── postgres.go  # Database queries (SQL operations)
├── Dockerfile
├── go.mod               # Dependencies list
└── go.sum               # Dependency lock file (checksums)
```

**"internal" convention**: In Go, putting code inside `internal/` means it can only be imported by code in the same module. This prevents accidental dependency on private implementation details.

### API Routes

All routes are registered in `cmd/main.go`:

```
Public routes (no token needed):
  POST /signup              — Create a new account
  POST /signin              — Log in, get tokens
  POST /signout             — Invalidate tokens
  POST /token/refresh       — Exchange refresh token for new access token
  GET  /oauth/google         — Start Google OAuth flow
  GET  /oauth/google/callback — Handle Google OAuth response

Authenticated routes (Bearer token required):
  GET  /user                — Get current user profile
  PUT  /user                — Update current user profile
  GET  /admin/users         — List ALL users (admin use)
  POST /query               — Execute raw SQL (admin use)

Internal routes (not exposed via nginx):
  POST /internal/verify     — Verify a token (called by other services)
  GET  /health              — Health check
```

### How a sign-in works (code walkthrough)

`services/auth/internal/handler/auth.go`:

```go
func (h *AuthHandler) SignIn(w http.ResponseWriter, r *http.Request) {
    // 1. Parse the JSON request body
    var req struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }
    if !decodeJSON(w, r, &req) {
        return  // decodeJSON already wrote an error response
    }

    // 2. Look up the user by email in the database
    user, err := h.Store.GetUserByEmail(r.Context(), req.Email)
    if errors.Is(err, store.ErrNotFound) {
        writeError(w, 401, "invalid_credentials", "email or password incorrect")
        return
    }

    // 3. Compare the submitted password against the stored bcrypt hash
    if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
        writeError(w, 401, "invalid_credentials", "email or password incorrect")
        return
    }

    // 4. Create a JWT access token
    accessToken := createJWT(user.ID, user.Role, h.JWTSecret, h.JWTExpiry)

    // 5. Create a refresh token (stored in DB so we can revoke it)
    refreshToken := generateSecureToken()
    h.Store.SaveRefreshToken(r.Context(), user.ID, refreshToken, time.Now().Add(7*24*time.Hour))

    // 6. Return both tokens
    writeJSON(w, 200, SignInResponse{
        AccessToken:  accessToken,
        RefreshToken: refreshToken,
        User:         publicUser(user),
    })
}
```

### The database layer

`services/auth/internal/store/postgres.go` contains all SQL queries. Each database operation is a function on the `Store` struct, which holds the connection pool.

**Connection pool** = a set of pre-opened database connections kept ready to use. Instead of opening a new connection for every request (slow), we reuse connections from the pool. The pool is configured with `MaxConns: 10` (never more than 10 simultaneous database connections).

### The JWT middleware

`services/auth/internal/handler/helpers.go`:

The `JWTMiddleware` function wraps any route that requires authentication. It:
1. Reads the `Authorization: Bearer <token>` header
2. Parses and validates the JWT signature (using `JWT_SECRET`)
3. Extracts the user ID and role from the token's payload
4. Stores them in the request context for the handler to use
5. If anything is wrong, returns 401 Unauthorized

### Running auth tests

```bash
make test-auth
# or
cd services/auth && go test ./... -v
```

The tests use `net/http/httptest` — a Go standard library package that lets you test HTTP handlers without actually starting a server. No database required; the store is mocked.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | e.g. `postgres://curtain:pass@postgres:5432/curtain` |
| `JWT_SECRET` | Yes | 32+ character random string |
| `JWT_EXPIRY` | No | Token lifetime in seconds (default: 3600 = 1 hour) |
| `REFRESH_TOKEN_EXPIRY` | No | Refresh token lifetime (default: 604800 = 7 days) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth app credentials |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth app credentials |
| `SITE_URL` | No | For OAuth redirect URLs |
| `PORT` | No | Listen port (default: 9999) |

---

## PostgREST

**Location**: Not part of our source code — it's a pre-built Docker image
**Port**: 3000
**Purpose**: Auto-generates a REST API from your PostgreSQL schema

### How it works

PostgREST reads your database schema and automatically creates endpoints:

```
GET    /products              — SELECT * FROM products
GET    /products?active=eq.true&limit=10  — filtered query
POST   /products              — INSERT INTO products
PATCH  /products?id=eq.5     — UPDATE products WHERE id=5
DELETE /products?id=eq.5     — DELETE FROM products WHERE id=5
```

PostgREST uses PostgreSQL's **role system** for authorization. The JWT token you send contains a `role` claim (e.g. `"authenticated"`). PostgREST switches to that PostgreSQL role before running the query — so PostgreSQL's row-level security policies apply automatically.

### Configuration in docker-compose

PostgREST is configured entirely through environment variables in the compose file:

```yaml
environment:
  PGRST_DB_URI: postgres://curtain:password@postgres:5432/curtain
  PGRST_DB_SCHEMA: public          # only expose the public schema
  PGRST_DB_ANON_ROLE: anon        # role used for unauthenticated requests
  PGRST_JWT_SECRET: ${JWT_SECRET} # validates the JWT
  PGRST_SERVER_PORT: "3000"
```

### Querying from curl

```bash
# Read all rows (anonymous access — only works if anon role has SELECT permission)
curl http://localhost:8080/rest/v1/products

# Read with JWT (authenticated user)
TOKEN="eyJ..."
curl http://localhost:8080/rest/v1/products \
  -H "Authorization: Bearer $TOKEN"

# Filter — products where price < 1000
curl "http://localhost:8080/rest/v1/products?price=lt.1000" \
  -H "Authorization: Bearer $TOKEN"

# Insert
curl -X POST http://localhost:8080/rest/v1/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Widget", "price": 500}'
```

### PostgREST operators

| PostgREST syntax | SQL equivalent |
|---|---|
| `?name=eq.Alice` | `WHERE name = 'Alice'` |
| `?age=gt.18` | `WHERE age > 18` |
| `?age=lt.65` | `WHERE age < 65` |
| `?name=like.*ali*` | `WHERE name LIKE '%ali%'` |
| `?tags=cs.{go}` | `WHERE 'go' = ANY(tags)` |
| `?select=id,name` | `SELECT id, name` |
| `?order=created_at.desc` | `ORDER BY created_at DESC` |
| `?limit=20&offset=40` | `LIMIT 20 OFFSET 40` |

---

## Realtime Service

**Location**: `services/realtime/`
**Language**: Go
**Port**: 4000
**Purpose**: Push database changes to browser clients via WebSocket

### Directory structure

```
services/realtime/
├── cmd/
│   └── main.go              # Entry point
├── internal/
│   ├── hub/
│   │   ├── hub.go           # Connection manager — tracks all WebSocket clients
│   │   └── hub_test.go
│   ├── listener/
│   │   ├── postgres.go      # Listens to PostgreSQL NOTIFY channel
│   │   └── postgres_test.go
│   └── ws/
│       └── handler.go       # WebSocket upgrade + client management
├── Dockerfile
├── go.mod
└── go.sum
```

### How it works end to end

**Step 1 — Client connects**

A browser opens a WebSocket connection to `ws://localhost:8080/realtime/v1/websocket?token=eyJ...`

The WebSocket handler (`ws/handler.go`):
1. Upgrades the HTTP connection to a WebSocket connection (using the `gorilla/websocket` library)
2. Validates the JWT token from the query parameter
3. Registers the client in the Hub

**Step 2 — PostgreSQL trigger fires**

When a row is inserted/updated/deleted in a realtime-enabled table, a PostgreSQL trigger fires:

```sql
-- This trigger is installed when you call:
SELECT enable_realtime('public', 'orders');

-- The trigger function (defined in init.sql):
CREATE FUNCTION notify_table_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'curtain_changes',
    json_build_object(
      'schema', TG_TABLE_SCHEMA,
      'table', TG_TABLE_NAME,
      'event', TG_OP,           -- 'INSERT', 'UPDATE', or 'DELETE'
      'new', row_to_json(NEW),  -- new row data
      'old', row_to_json(OLD)   -- old row data (for UPDATE/DELETE)
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

`pg_notify()` is a PostgreSQL built-in function that broadcasts a message to all listeners on the `curtain_changes` channel.

**Step 3 — Listener receives the notification**

`listener/postgres.go` uses a persistent PostgreSQL connection to `LISTEN` on the `curtain_changes` channel. When a notification arrives, it sends the payload to the Hub.

**Step 4 — Hub broadcasts to clients**

`hub/hub.go` receives the notification from the listener and sends it to all registered WebSocket clients.

**Step 5 — Browser receives the update**

The browser's WebSocket receives the JSON message and your callback fires:

```typescript
client.channel('public:orders')
  .on('INSERT', (payload) => {
    console.log('New order:', payload.new)
    // Update your UI here
  })
  .subscribe()
```

### Enabling realtime on a table

Realtime is **off by default** for all tables. Enable it by running this SQL (via the dashboard SQL editor or `make psql`):

```sql
SELECT enable_realtime('public', 'orders');
```

To disable:
```sql
SELECT disable_realtime('public', 'orders');
```

---

## Edge Service

**Location**: `services/edge/`
**Language**: Go (orchestrator) + Deno (function runtime)
**Port**: 5555
**Purpose**: Run user-defined TypeScript/JavaScript functions on the server

### Directory structure

```
services/edge/
├── cmd/
│   └── main.go               # Entry point
├── internal/
│   ├── runner/
│   │   ├── deno.go           # Executes functions using Deno subprocess
│   │   └── deno_test.go
│   └── store/
│       ├── functions.go      # CRUD for edge.functions table
│       └── functions_test.go
├── Dockerfile                # Multi-stage: Go + Deno binaries both included
├── go.mod
└── go.sum
```

### The Dockerfile (multi-stage build)

The Edge service's Dockerfile is interesting because it needs both Go and Deno:

```dockerfile
# Stage 1: Copy Deno binary
FROM denoland/deno:alpine-1.40.5 AS deno

# Stage 2: Build Go binary
FROM golang:1.23-alpine AS go-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o edge ./cmd/

# Stage 3: Final image — combine both
FROM debian:12-slim
COPY --from=deno /bin/deno /usr/local/bin/deno
COPY --from=go-builder /app/edge /edge
CMD ["/edge"]
```

**Why Debian instead of Alpine?** Deno is compiled against glibc (the standard C library on most Linux systems). Alpine Linux uses musl instead. Deno binaries from the official Alpine image won't run on an Alpine base — they need an image with glibc, hence Debian.

### How function execution works

```
1. Dashboard sends:
   POST /functions/v1/functions
   {"name": "hello", "slug": "hello", "code": "export async function handler(req){...}"}

2. Edge Service stores in PostgreSQL:
   INSERT INTO edge.functions (id, name, slug, code, active) VALUES (...)

3. Client invokes:
   POST /functions/v1/invoke/hello
   Authorization: Bearer <jwt>
   Body: {"name": "World"}

4. Edge Service fetches code from DB for slug "hello"

5. Writes code to a temp file (/tmp/fn/<uuid>.ts)

6. Runs: deno run --allow-net <temp-file>
   (Deno runs the TypeScript code in isolation)

7. Function returns: Response object with JSON body

8. Edge Service reads Deno's stdout, returns result to client
```

### Writing an edge function

Functions must export a `handler` function:

```typescript
export async function handler(req: Request): Promise<Response> {
  const body = await req.json()

  // You can call external HTTP APIs
  const result = await fetch('https://api.example.com/data')
  const data = await result.json()

  return new Response(
    JSON.stringify({ message: 'Hello!', received: body, external: data }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  )
}
```

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | For validating Bearer tokens on management routes |
| `DENO_EXEC` | Path to Deno binary (default: `/usr/local/bin/deno`) |
| `FUNCTION_DIR` | Temp directory for function files (default: `/tmp/fn`) |
| `FUNCTION_TIMEOUT_MS` | Max execution time per function in ms (default: 5000) |
| `PORT` | Listen port (default: 5555) |

---

## Storage Gateway

**Location**: `services/storage-gw/`
**Language**: Go
**Port**: 6333
**Purpose**: Translate JWT auth requests to MinIO S3 credentials

### The problem it solves

MinIO speaks S3 — a protocol that uses AWS-style access keys for authentication (AWS Signature V4). Your browser and the dashboard use JWT Bearer tokens. These are completely different systems.

Without the gateway, the browser would send:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
And MinIO would return 403 Forbidden because it has no idea what a JWT is.

### How it works

```
Browser ──► Nginx ──► Storage Gateway ──► MinIO
              /storage/v1/*   JWT validated   S3 credentials used
```

The gateway (`services/storage-gw/main.go`) is a single Go file that:

1. Receives any request to `/` (Nginx strips `storage/v1/` before forwarding)
2. Extracts the `Authorization: Bearer <jwt>` header
3. Validates the JWT using `JWT_SECRET`
4. If valid, makes the equivalent S3 request to MinIO using root credentials
5. Returns the response (translated to JSON where needed)

### API it exposes

| Method | Path | What it does | Returns |
|---|---|---|---|
| `GET` | `/` | List all buckets | `[{Name, CreationDate, public}]` |
| `GET` | `/{bucket}` | List objects in bucket | `[{Key, Size, LastModified, ETag}]` |
| `PUT` | `/{bucket}/{key}` | Upload a file | 200 OK |
| `DELETE` | `/{bucket}/{key}` | Delete a file | 204 No Content |

### Environment variables

| Variable | Description |
|---|---|
| `MINIO_ENDPOINT` | MinIO address (default: `storage:9000`) |
| `MINIO_ROOT_USER` | MinIO access key |
| `MINIO_ROOT_PASSWORD` | MinIO secret key |
| `JWT_SECRET` | Same secret as auth service |
| `PORT` | Gateway listen port (default: 6333) |

---

## Dashboard

**Location**: `dashboard/`
**Language**: TypeScript + React
**Port**: 80 (inside container), accessed via Nginx at `:8080`
**Purpose**: Admin panel for managing all Curtain features

### Technology choices

- **React**: A JavaScript library for building UIs as components
- **Vite**: A fast build tool that compiles TypeScript + JSX and bundles everything for production
- **Tailwind CSS**: A utility-first CSS framework — instead of writing CSS files, you add classes like `flex`, `p-4`, `text-blue-500` directly on HTML elements
- **TypeScript**: Typed JavaScript — catches bugs before you run the code

### Key files

```
dashboard/src/
├── App.tsx         # Root component — login page, sidebar, page routing
├── lib/
│   └── api.ts      # All HTTP calls to the Curtain backend
├── pages/
│   ├── database.tsx  # SQL editor
│   ├── auth.tsx      # User management
│   ├── storage.tsx   # File storage
│   └── edge.tsx      # Edge functions
└── components/
    ├── TableBrowser.tsx  # Reusable table component
    └── AuthUsers.tsx     # User list component
```

### How routing works

React SPA routing is done entirely in JavaScript — there's no server-side routing. `App.tsx` tracks which page is active in state:

```typescript
const [page, setPage] = useState<'database' | 'auth' | 'storage' | 'functions'>('database')
```

Clicking a sidebar nav item calls `setPage(...)`, which re-renders the right page component — no page reload, instant navigation.

The Nginx config inside the dashboard container (`dashboard/nginx.conf`) has:
```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```
This means any URL (e.g. `/functions`) that doesn't match a static file gets served `index.html`, letting React Router handle it.

### The API client (`lib/api.ts`)

All backend communication goes through `api.ts`. It uses the browser's built-in `fetch()` API (no external HTTP library needed). Every function follows the same pattern:

```typescript
export async function signIn(email: string, password: string) {
  // apiFetch adds the Authorization header automatically from localStorage
  return apiFetch<SignInResponse>('/auth/v1/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}
```

`apiFetch` always returns `{ data: T | null, error: string | null }`. All components check `error` before using `data`.

### Running the dashboard in dev mode (fast iteration)

The `make dev` command rebuilds and restarts the dashboard container on every change, which takes ~15 seconds. For active frontend development, run Vite's dev server directly:

```bash
cd dashboard
VITE_API_URL=http://localhost:8080 npm run dev
# Opens http://localhost:5173 with hot module replacement (instant updates)
```

### Running dashboard tests

```bash
cd dashboard && npm test
# or
make test-dashboard
```

Tests are in `components/TableBrowser.test.tsx`. They use:
- **Vitest**: A test runner compatible with Vite
- **React Testing Library**: Simulates how a user interacts with the UI
- **jsdom**: A fake browser DOM that runs in Node.js

---

## Infrastructure services (PostgreSQL, MinIO)

These are pre-built images we configure, not code we write.

### PostgreSQL

The database uses the official `postgres:15-alpine` Docker image, configured with:
- `infra/postgres/init.sql` — sets up schemas, tables, roles, and triggers
- `infra/postgres/postgresql.conf` — performance tuning for a 2GB VPS

**Data is persisted** in a Docker volume named `postgres-data`. Even if you `docker compose down` without `-v`, your data is not lost.

### MinIO

MinIO uses the official `minio/minio` Docker image. Configuration:
- `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` — admin credentials
- Data persisted in `minio-data` Docker volume

The `storage-init` container runs `infra/minio/init-buckets.sh` on first startup to create the `public`, `private`, and `system` buckets.

The **MinIO Console** (web UI) is available at `http://localhost:9001`. Log in with `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` from your `.env`.

---

Next: [Database](./05-database.md) — the schema, SQL editor, and realtime subscriptions.
