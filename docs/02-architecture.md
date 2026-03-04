# Architecture

This guide explains how Curtain works internally — how all the services connect, what happens when a request arrives, and why things are designed this way.

---

## Table of Contents

- [Overview](#overview)
- [The full system diagram](#the-full-system-diagram)
- [Request lifecycle](#request-lifecycle)
- [Services and what they do](#services-and-what-they-do)
- [How services communicate](#how-services-communicate)
- [Data flow: a real example](#data-flow-a-real-example)
- [Development vs production topology](#development-vs-production-topology)
- [The shared database](#the-shared-database)

---

## Overview

Curtain is made of **10 containers** running together (9 in dev mode with the full stack). Each container is one isolated process. They communicate over a private Docker network — from the outside world, only one port is exposed (port 8080 in development, 80/443 in production).

The **reverse proxy** (Nginx in dev, Caddy in production) is the single entry point. It reads the URL path and decides which container to forward the request to:

| URL path | Goes to |
|---|---|
| `/auth/v1/*` | Auth Service |
| `/rest/v1/*` | PostgREST |
| `/realtime/v1/*` | Realtime Service |
| `/storage/v1/*` | Storage Gateway |
| `/functions/v1/*` | Edge Service |
| `/db/v1/*` | Auth Service (raw SQL) |
| `/*` (everything else) | Dashboard (React SPA) |

---

## The full system diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Docker Network "dev"                         │
│                                                                       │
│  ┌─────────┐                                                         │
│  │  Nginx  │  :8080 (exposed to host)                                │
│  │  (dev)  │◄──────────────────────────── Browser / curl             │
│  └────┬────┘                                                         │
│       │                                                              │
│       ├─/auth/v1/*─────────────┐                                     │
│       ├─/db/v1/*───────────────┤                                     │
│       │                        ▼                                     │
│       │                 ┌────────────┐   DATABASE_URL                │
│       │                 │   Auth     ├──────────────────┐            │
│       │                 │  Service   │   JWT validation  │            │
│       │                 │  Go :9999  │   bcrypt hashing  │            │
│       │                 └────────────┘   SQL execution   │            │
│       │                                                  │            │
│       ├─/rest/v1/*──────────────────────────────────┐    │            │
│       │                                             ▼    │            │
│       │                                    ┌─────────────┴─┐         │
│       │                                    │  PostgreSQL   │         │
│       │                                    │  :5432        │         │
│       │                                    │  (shared DB)  │         │
│       │                                    └──┬──────────┬─┘         │
│       │                                       │          │           │
│       │    ┌──────────┐    DATABASE_URL        │          │           │
│       ├─/rest/v1/*──►│PostgREST│◄─────────────┘          │           │
│       │    │  :3000   │                                   │           │
│       │    └──────────┘                                   │           │
│       │                                                   │           │
│       ├─/realtime/v1/*──────────────────────────────────► │           │
│       │                 ┌────────────┐  LISTEN/NOTIFY     │           │
│       │                 │  Realtime  ├────────────────────┘           │
│       │                 │  Service   │  WebSocket to browsers         │
│       │                 │  Go :4000  │                                │
│       │                 └────────────┘                                │
│       │                                                               │
│       ├─/functions/v1/*──────────────────────────────────────────┐   │
│       │                 ┌────────────┐  DATABASE_URL               │   │
│       │                 │   Edge     ├────────────────────────────►│   │
│       │                 │  Service   │  stores functions in DB     │   │
│       │                 │  Go+Deno   │                             │   │
│       │                 │  :5555     │  Deno runs function code    │   │
│       │                 └────────────┘                             │   │
│       │                                                            │   │
│       ├─/storage/v1/*──────────────────────────────────────────►  │   │
│       │                 ┌────────────┐  JWT validation             │   │
│       │                 │ Storage GW ├──────────────────── uses    │   │
│       │                 │  Go :6333  │  S3 credentials ────────►   │   │
│       │                 └─────┬──────┘                             │   │
│       │                       │ S3 API                             │   │
│       │                       ▼                                    │   │
│       │                 ┌────────────┐                             │   │
│       │                 │   MinIO    │  :9000 API (internal)       │   │
│       │                 │  :9001     │  :9001 Console (exposed)    │   │
│       │                 └────────────┘                             │   │
│       │                                                            │   │
│       └─/*──────────────►┌────────────┐                           │   │
│                          │ Dashboard  │  Static React files        │   │
│                          │  Nginx :80 │  served by nginx           │   │
│                          └────────────┘                            │   │
└─────────────────────────────────────────────────────────────────────-──┘
```

---

## Request lifecycle

Let's trace what happens when a user signs in from the dashboard:

### Step 1: Browser sends HTTP request
```
POST http://localhost:8080/auth/v1/signin
Content-Type: application/json
Body: {"email": "user@example.com", "password": "my-password"}
```

### Step 2: Nginx receives the request
Nginx looks at the path `/auth/v1/signin`. It matches the rule:
```nginx
location /auth/v1/ {
    rewrite ^/auth/v1/(.*) /$1 break;   # strips /auth/v1, becomes /signin
    proxy_pass http://auth:9999;         # forwards to auth container
}
```
The request is rewritten to `POST /signin` and forwarded to `auth:9999`.

### Step 3: Auth Service processes it
The Go service receives `POST /signin`:
1. Parses the JSON body
2. Looks up the user in PostgreSQL by email
3. Compares the password against the bcrypt hash stored in the database
4. If valid, creates a JWT token signed with `JWT_SECRET`
5. Returns `{"access_token": "eyJ...", "refresh_token": "...", "user": {...}}`

### Step 4: Response travels back
Auth → Nginx → Browser. The browser stores the `access_token` in `localStorage`.

### Step 5: Authenticated requests
Every subsequent API call includes the token:
```
GET /rest/v1/products
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

PostgREST reads the `role` claim from the JWT and applies the right PostgreSQL row-level permissions.

---

## Services and what they do

### Auth Service (`services/auth/`, port 9999)

**What it is**: A Go HTTP server that handles everything related to user identity.

**What it does**:
- Registers users (hashes passwords with bcrypt, stores in `auth.users`)
- Signs users in (validates password, issues JWT)
- Validates tokens for internal services
- Lists all users for the admin dashboard
- **Executes raw SQL** from the dashboard (`POST /query`)
- Handles Google OAuth redirects

**Why Go?** Go compiles to a tiny binary (~8MB), uses very little memory (~10MB idle), and handles thousands of concurrent connections. Perfect for an auth service that needs to be fast and always available.

### PostgREST (port 3000)

**What it is**: A third-party open-source tool (not written by us) that automatically creates a REST API from the PostgreSQL schema.

**What it does**: When you create a table in PostgreSQL, PostgREST immediately exposes it via REST. No code needed. It respects the role system: anonymous users can only read public data, authenticated users see their own data.

**Why not write our own?** PostgREST is battle-tested, handles filtering/sorting/pagination automatically, and does 95% of what most apps need. We focus on the other 5%.

### Realtime Service (`services/realtime/`, port 4000)

**What it is**: A Go WebSocket server that pushes database changes to browsers in real time.

**What it does**:
1. Accepts WebSocket connections from browsers (validates JWT on connect)
2. Maintains a persistent connection to PostgreSQL
3. Subscribes to the `curtain_changes` NOTIFY channel
4. When PostgreSQL triggers fire (on INSERT/UPDATE/DELETE), the trigger calls `pg_notify()` with a JSON payload
5. The service broadcasts that payload to all connected browsers

**How PostgreSQL triggers work**: You run `SELECT enable_realtime('public', 'orders')` once. This installs a trigger on the `orders` table. Whenever a row is inserted, updated, or deleted, the trigger automatically calls `pg_notify('curtain_changes', json_data)` — PostgreSQL's built-in message queue. The Realtime Service is always listening on that channel.

### Edge Service (`services/edge/`, port 5555)

**What it is**: A Go server that stores functions in PostgreSQL and executes them with the Deno runtime.

**What it does**:
- Stores function code in the `edge.functions` database table
- When `/invoke/{slug}` is called, fetches the code from the DB
- Writes the code to a temp file
- Runs it with `deno run` (a subprocess)
- Returns the result

**What is Deno?** Deno is a JavaScript/TypeScript runtime built by the same person who built Node.js, but with better security defaults. Your function code is completely isolated from the server.

### Storage Gateway (`services/storage-gw/`, port 6333)

**What it is**: A thin Go proxy that sits between Nginx and MinIO.

**The problem it solves**: MinIO uses AWS-style S3 credentials (access key + secret key), not JWT tokens. The dashboard sends JWT tokens. These are incompatible — MinIO would reject `Authorization: Bearer <jwt>` with a 403 error.

**How it works**:
1. Client sends: `GET /storage/v1/ Authorization: Bearer <jwt>`
2. Storage Gateway validates the JWT (same secret as auth service)
3. If valid, makes the same request to MinIO with the root S3 credentials
4. Returns the result as JSON (list of buckets, objects, etc.)

### Dashboard (`dashboard/`, port 80)

**What it is**: A React single-page application (SPA) compiled to static HTML/CSS/JS files, served by nginx inside the container.

A **SPA** (Single-Page Application) means the entire app is loaded once as static files (like a native app). Page navigation happens in JavaScript without making new server round-trips. The `nginx.conf` inside the dashboard container routes all paths to `index.html` so React Router can handle them.

---

## How services communicate

All containers are on the same Docker network named `dev`. Within that network, each container is reachable by its service name as a hostname.

For example:
- The Auth Service reaches PostgreSQL at `postgres:5432`
- Nginx reaches the Auth Service at `auth:9999`
- The Storage Gateway reaches MinIO at `storage:9000`

This is Docker's built-in DNS. Outside the Docker network, you can reach services by their mapped ports (e.g., `localhost:9999` maps to `auth:9999` inside the network).

### JWT: the trust mechanism between services

Rather than services calling each other directly for auth, they all share the same `JWT_SECRET`. When a request arrives:

1. The browser presents its JWT (obtained from the Auth Service at sign-in time)
2. Each service independently validates the JWT's signature using the shared secret
3. If valid, it trusts the claims inside (user ID, role)

This means **no service needs to call the Auth Service to validate a token** — validation is a pure cryptographic operation. This is why JWT is popular for microservices.

The one exception: the Edge and Realtime services call Auth's `/internal/verify` endpoint for token introspection in some flows.

---

## Data flow: a real example

**Scenario**: A user uploads a profile photo from the dashboard.

```
1. User selects a file in the dashboard browser tab

2. Dashboard (running in user's browser) calls:
   PUT http://localhost:8080/storage/v1/avatars/user-123/photo.jpg
   Authorization: Bearer eyJ...
   Content-Type: image/jpeg
   Body: [binary image data]

3. Nginx receives it, matches /storage/v1/:
   rewrite: PUT /avatars/user-123/photo.jpg
   forwards to: storage-gw:6333

4. Storage Gateway:
   a. Extracts JWT from Authorization header
   b. Validates signature with JWT_SECRET
   c. JWT is valid — user is authenticated
   d. Calls MinIO:
      PUT http://storage:9000/avatars/user-123/photo.jpg
      Authorization: AWS4-HMAC-SHA256 (S3 signature, computed from MINIO credentials)
      Body: [same binary image data]

5. MinIO stores the file and returns 200 OK

6. Storage Gateway returns 200 to Nginx

7. Nginx returns 200 to the browser

8. Dashboard shows "Upload successful"
```

---

## Development vs production topology

### Development (make dev)

- **Proxy**: Nginx
- **TLS**: None (plain HTTP)
- **Entry point**: `http://localhost:8080`
- **Ports exposed**: Many (PostgREST :3000, Auth :9999, MinIO :9001, etc.) — useful for debugging
- **Config file**: `infra/docker-compose.dev-full.yml`

### Production (make up)

- **Proxy**: Caddy
- **TLS**: Automatic via Let's Encrypt (free certificates, auto-renewed)
- **Entry point**: `https://baas.yourdomain.com`
- **Ports exposed**: Only 80 and 443 (everything else is internal)
- **Config file**: `infra/docker-compose.yml`
- **Memory limits**: Applied to prevent any service from crashing the VPS

The production Caddyfile also routes `/storage/v1/*` directly to MinIO (not through the gateway) — in a future version this will be updated to use the gateway for consistent JWT auth in production too.

---

## The shared database

All four Go services connect to the same PostgreSQL instance. The database is organized into **schemas** (namespaces) so different services don't create naming conflicts:

```
PostgreSQL: curtain database
├── auth schema          (owned by Auth Service)
│   ├── users            – user accounts
│   └── refresh_tokens   – long-lived tokens
├── storage schema       (file metadata)
│   ├── buckets          – bucket registry
│   └── objects          – file metadata
├── edge schema          (owned by Edge Service)
│   └── functions        – function code + config
└── public schema        (your app data — accessible via PostgREST)
    └── [your tables]    – products, orders, posts, whatever you create
```

The `public` schema is what your app uses. The other schemas are internal to Curtain services. PostgREST only exposes the `public` schema to API clients.

---

Next: [Local Development](./03-local-development.md) — step-by-step setup on your machine.
