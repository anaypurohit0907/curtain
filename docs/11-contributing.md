# Contributing

This guide explains how the codebase is structured, how to run tests, and how to make changes to Curtain.

---

## Table of Contents

- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Setting up for development](#setting-up-for-development)
- [The services at a glance](#the-services-at-a-glance)
- [How to make changes](#how-to-make-changes)
- [Running tests](#running-tests)
- [Code style and quality](#code-style-and-quality)
- [Adding a new API endpoint (auth service walkthrough)](#adding-a-new-api-endpoint-auth-service-walkthrough)
- [Making frontend changes (dashboard)](#making-frontend-changes-dashboard)
- [Useful make commands](#useful-make-commands)
- [Common pitfalls](#common-pitfalls)

---

## Repository layout

```
curtain/
├── README.md                    ← GitHub README
├── Makefile                     ← All developer commands
│
├── services/                    ← Backend Go services
│   ├── auth/                    ← Auth Service (JWT, bcrypt, OAuth)
│   │   ├── cmd/main.go          ← Entrypoint: wires router
│   │   ├── go.mod               ← Go module definition
│   │   ├── Dockerfile
│   │   └── internal/
│   │       ├── handler/         ← HTTP handlers (auth.go, oauth.go)
│   │       ├── store/           ← Database queries (postgres.go)
│   │       └── model/           ← Data types (user.go)
│   │
│   ├── realtime/                ← Realtime WebSocket Service
│   │   ├── cmd/main.go
│   │   ├── go.mod
│   │   ├── Dockerfile
│   │   └── internal/
│   │       ├── hub/             ← WebSocket connection manager
│   │       ├── listener/        ← PostgreSQL LISTEN/NOTIFY
│   │       └── ws/              ← WebSocket upgrade + handler
│   │
│   ├── edge/                    ← Edge Functions Service
│   │   ├── cmd/main.go
│   │   ├── go.mod
│   │   ├── Dockerfile           ← Multi-stage: Go + Deno
│   │   └── internal/
│   │       ├── runner/          ← Deno subprocess execution
│   │       └── store/           ← Function storage in DB
│   │
│   └── storage-gw/              ← Storage Gateway
│       ├── main.go              ← Everything in a single file
│       ├── go.mod
│       └── Dockerfile
│
├── dashboard/                   ← React + Vite frontend
│   ├── src/
│   │   ├── lib/api.ts           ← All HTTP API calls
│   │   ├── pages/               ← One file per page
│   │   │   ├── login.tsx
│   │   │   ├── database.tsx     ← SQL editor
│   │   │   ├── storage.tsx
│   │   │   ├── functions.tsx
│   │   │   └── users.tsx
│   │   └── components/          ← Reusable UI components
│   ├── package.json
│   ├── Dockerfile               ← Multi-stage: Vite build + nginx
│   └── vite.config.ts
│
├── infra/                       ← Infrastructure configuration
│   ├── docker-compose.yml       ← Production stack
│   ├── docker-compose.dev-full.yml  ← Development stack
│   ├── nginx-dev.conf           ← Dev reverse proxy config
│   ├── caddy/Caddyfile          ← Production reverse proxy config
│   ├── postgres/
│   │   ├── init.sql             ← DB schema + helper functions
│   │   └── postgresql.conf      ← PostgreSQL tuning
│   └── minio/init-buckets.sh   ← Create default buckets
│
├── docs/                        ← Documentation (you're here)
│
└── sdk/                         ← TypeScript SDK (npm package)
    ├── src/
    └── package.json
```

---

## Prerequisites

You need:
- **Docker** and **Docker Compose v2** — for running the dev stack
- **Go 1.21+** — for compiling and testing the backend services
- **Node.js 18+** and **npm** — for the dashboard frontend

Check you have everything:
```bash
make setup
```

This command checks for each dependency and copies `infra/.env.example` to `infra/.env` if it doesn't exist.

---

## Setting up for development

```bash
# 1. Clone the repository
git clone https://github.com/anaypurohit0907/curtain.git
cd curtain

# 2. Check prerequisites and create .env
make setup

# 3. Edit infra/.env — fill in secrets
nano infra/.env

# 4. Start the development stack
make dev

# 5. Open the dashboard
# http://localhost:8080
```

The dev stack mounts service code directly and exposes extra ports for debugging. Changes to Go code require rebuilding the container:
```bash
make build  # Rebuild all Docker images
make dev    # Restart the stack
```

---

## The services at a glance

Each service is an **independent Go module** with its own `go.mod`. They share no Go code — they're entirely separate programs that happen to live in the same repository (this pattern is called a **monorepo**).

| Service | Language | Port | Key packages |
|---------|----------|------|-------------|
| auth | Go | 9999 | chi, pgx/v5, golang-jwt, bcrypt |
| realtime | Go | 4000 | pgx/v5, gorilla/websocket |
| edge | Go + Deno | 5555 | chi, pgx/v5 |
| storage-gw | Go | 6333 | golang-jwt, minio-go |
| dashboard | TypeScript (React) | 80 | Vite, React, React Router |

---

## How to make changes

### Go service changes

1. Edit the code in `services/{service-name}/`
2. The service will **not** hot-reload in dev mode — you need to rebuild:
   ```bash
   docker compose -f infra/docker-compose.dev-full.yml build auth
   docker compose -f infra/docker-compose.dev-full.yml restart auth
   ```
   Or just:
   ```bash
   make build && make dev
   ```
3. Check logs for errors:
   ```bash
   docker logs curtain-dev-auth --follow
   ```

### Dashboard changes

The dashboard uses **Vite** which hot-reloads automatically in dev mode. However, in the Docker stack, it runs the compiled static build, not the dev server.

For dashboard development, run Vite outside Docker:
```bash
cd dashboard
npm install
VITE_API_URL=http://localhost:8080 npm run dev
# Opens at http://localhost:5173
# The dev server proxies API calls to the Docker stack running at :8080
```

Any changes to `.tsx` files are reflected immediately in the browser.

### Infrastructure changes (nginx, docker-compose)

After editing `infra/nginx-dev.conf`:
```bash
docker restart curtain-dev-nginx
```

After editing `infra/docker-compose.dev-full.yml`:
```bash
make dev  # Recreates containers with new config
```

---

## Running tests

```bash
# Run all tests
make test

# Run auth service tests only
make test-auth

# Run a specific test
cd services/auth
go test -v -run TestSignUp ./internal/handler/...
```

The test suite runs with `-race` (detects race conditions) and a 60-second timeout.

### What the tests cover

- **`auth_test.go`** — HTTP handler tests: sign up, sign in, error cases, token validation
- **`middleware_test.go`** — JWT middleware tests: valid tokens, expired tokens, missing tokens

Tests use a real PostgreSQL database against the dev container. Make sure the dev stack is running before running tests:
```bash
make dev           # Start the stack
cd services/auth
go test ./...      # Run tests
```

### Writing new tests

Tests follow the standard Go testing pattern:

```go
// services/auth/internal/handler/auth_test.go

func TestMyNewFeature(t *testing.T) {
    // Set up test server
    h := setupTestHandler(t)

    // Create request
    body := `{"key": "value"}`
    req := httptest.NewRequest("POST", "/my-endpoint", strings.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    w := httptest.NewRecorder()

    // Call handler
    h.MyEndpoint(w, req)

    // Assert response
    if w.Code != http.StatusOK {
        t.Errorf("expected 200, got %d\nbody: %s", w.Code, w.Body.String())
    }
}
```

---

## Code style and quality

```bash
# Check for code issues
make vet       # Runs "go vet" (catches common mistakes)

# Tidy up dependency files
make tidy      # Runs "go mod tidy" (removes unused dependencies)
```

Go vet catches bugs like:
- Wrong format verbs in `fmt.Sprintf` (`%d` for a string)
- Unreachable code
- Misuse of `sync.Mutex`

**No linter is enforced** right now, but standard Go style applies:
- Use `gofmt` to format code: `gofmt -w file.go`
- Error strings should be lowercase without periods: `"user not found"` not `"User not found."`
- Prefer early returns over deeply nested `if` blocks

---

## Adding a new API endpoint (auth service walkthrough)

Let's say you want to add `POST /auth/v1/reset-password`. This is a walkthrough of all the places to touch.

### 1. Add the handler (`internal/handler/auth.go`)

```go
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
    var req struct {
        Email string `json:"email"`
    }
    if !decodeJSON(w, r, &req) {
        return
    }
    if req.Email == "" {
        writeError(w, http.StatusBadRequest, "missing_email", "email is required")
        return
    }
    // ... your logic here
    writeJSON(w, http.StatusOK, map[string]string{"message": "reset email sent"})
}
```

### 2. Register the route (`cmd/main.go`)

```go
// In the r.Group or at the top level (public routes don't need JWT):
r.Post("/reset-password", authH.ResetPassword)
```

### 3. Add nginx routing (if new path prefix)

If you're adding a new HTTP path prefix that nginx doesn't proxy yet, edit `infra/nginx-dev.conf` (for development) and `infra/caddy/Caddyfile` (for production). For routes under `/auth/v1/`, no changes needed — they already route to the auth service.

### 4. Update `api.ts` in the dashboard

```typescript
// dashboard/src/lib/api.ts
export async function resetPassword(
  email: string,
): Promise<{ data: { message: string } | null; error: string | null }> {
  return apiFetch<{ message: string }>('/auth/v1/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}
```

### 5. Write a test

Add a test in `services/auth/internal/handler/auth_test.go`.

### 6. Rebuild and test

```bash
make build && make dev
make test-auth
```

---

## Making frontend changes (dashboard)

### Page structure

Each page is a single React function component in `dashboard/src/pages/`. The routing is in `App.tsx`:

```tsx
// Add a new route for your new page
<Route path="/my-page" element={<MyPage />} />
```

### API calls

All API calls go through `dashboard/src/lib/api.ts` using `apiFetch`. Never write `fetch()` calls directly in page components — always add a typed function in `api.ts` first.

```tsx
// In your page component
import { myNewFunction } from '../lib/api'

function MyPage() {
  const token = localStorage.getItem('curtain.access_token')!
  const [data, setData] = useState(null)

  useEffect(() => {
    myNewFunction(token).then(({ data, error }) => {
      if (error) console.error(error)
      else setData(data)
    })
  }, [])

  // ...
}
```

### Building for production

```bash
cd dashboard
npm run build
# Output goes to dist/ — Docker copies this into the nginx container
```

---

## Useful make commands

```bash
make setup      # Check prerequisites, create .env
make dev        # Start dev stack (docker-compose.dev-full.yml)
make up         # Start production stack (docker-compose.yml)
make down       # Stop all containers
make build      # Rebuild all Docker images
make build-go   # Compile Go code without Docker (syntax check)
make test       # Run all tests
make test-auth  # Run auth service tests only
make tidy       # go mod tidy on all Go modules
make vet        # go vet on all Go modules
make logs       # Tail logs from all dev containers
make psql       # Open psql shell in running Postgres container
make pg-dump    # Dump database to ./backups/
make reset-db   # Reset database schema (dev only, destructive!)
```

---

## Common pitfalls

### "Package not found" when running tests

You need the dev stack running for database-dependent tests:
```bash
make dev     # Start the stack first
make test    # Then run tests
```

### Changes not taking effect

Go services don't hot-reload. Always rebuild after code changes:
```bash
make build && make dev
```

### Import cycle errors in Go

Each service is a separate module (`go.mod`). Don't import `services/auth` code from `services/realtime` — they're completely separate programs. If you need shared types, copy them or extract a shared package.

### `go.sum` mismatch after adding a dependency

```bash
cd services/auth  # (or whichever service)
go mod tidy
```

### Database migration

There's no migration tool. All schema changes go in `infra/postgres/init.sql`. In development, use `make reset-db` to apply changes to a fresh database.

In production, make schema changes via the SQL editor in the dashboard, or `make psql`, and manually update `init.sql` to reflect the current state.
