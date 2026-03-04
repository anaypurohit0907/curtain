# Curtain

**Self-hosted Backend-as-a-Service — Made in India**

A minimal, fast, self-hostable alternative to Supabase. Runs entirely on a single Indian VPS (₹200–500/month). Built for Indian developers and startups who want full control over their data.

[![Tests](https://github.com/anaypurohit0907/curtain/actions/workflows/test.yml/badge.svg)](https://github.com/anaypurohit0907/curtain/actions/workflows/test.yml)

> **Why?** On February 24, 2026, Supabase was blocked by Indian ISPs under IT Act 69A — overnight. Curtain is the answer: your data stays in India, on infrastructure you control.

---

## What you get

| Feature | Technology | Status |
|---|---|---|
| PostgreSQL REST API | PostgREST v12 (auto-generated from your schema) | Ready |
| Authentication | Go + JWT + bcrypt + Google OAuth | Ready |
| Realtime subscriptions | Go + WebSockets + PostgreSQL LISTEN/NOTIFY | Ready |
| File Storage | MinIO (S3-compatible) + JWT gateway | Ready |
| Edge Functions | Go orchestrator + Deno runtime | Ready |
| Admin Dashboard | React + Vite + Tailwind | Ready |
| TypeScript SDK | Fetch-based, zero dependencies | Ready |
| Raw SQL editor | Direct PostgreSQL execution via dashboard | Ready |

**Total memory**: ~1.5 GB for all services (fits on a 2 GB VPS).

---

## Quick Start

### Requirements

- [Docker](https://docs.docker.com/engine/install/) 24+
- `make` (`sudo apt install make` / `sudo dnf install make`)

### 1 — Clone

```bash
git clone https://github.com/anaypurohit0907/curtain.git
cd curtain
```

### 2 — Configure

```bash
make setup            # creates infra/.env from the template
nano infra/.env       # set the 4 required values below
```

```dotenv
DOMAIN=baas.yourdomain.com          # your domain (or localhost for dev)
POSTGRES_PASSWORD=<random-64-hex>   # openssl rand -hex 32
JWT_SECRET=<random-64-hex>          # openssl rand -hex 32
MINIO_ROOT_PASSWORD=<random-hex>    # openssl rand -hex 16
ADMIN_EMAIL=you@example.com         # for TLS cert renewal emails
```

### 3 — Run

```bash
make dev     # local development (http://localhost:8080)
make up      # production with automatic HTTPS
```

### 4 — Verify

```bash
make ps          # all containers should show "running"
make test-e2e    # end-to-end integration tests
```

Open **http://localhost:8080** — register your first account, then explore all features from the dashboard.

---

## Architecture

```
                        Internet / Browser
                               │
                    ┌──────────▼──────────┐
                    │   Caddy / Nginx      │
                    │  (Reverse Proxy)     │
                    │  auto-TLS in prod    │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼──────────────────────┐
          │                    │                       │
    /auth/v1/*          /rest/v1/*          /realtime/v1/*
          │                    │                       │
    ┌─────▼─────┐      ┌──────▼──────┐      ┌─────────▼─────┐
    │   Auth    │      │ PostgREST   │      │  Realtime WS  │
    │  Service  │      │  REST API   │      │   Service     │
    │  Go :9999 │      │   :3000     │      │   Go :4000    │
    └─────┬─────┘      └──────┬──────┘      └─────────┬─────┘
          │                   │                        │
          │            /storage/v1/*           /functions/v1/*
          │                   │                        │
          │         ┌─────────▼─────────┐     ┌───────▼───────┐
          │         │  Storage Gateway  │     │  Edge Service │
          │         │  (JWT→S3 proxy)   │     │  Go + Deno    │
          │         │     Go :6333      │     │    :5555      │
          │         └─────────┬─────────┘     └───────────────┘
          │                   │
          └──────┬────────────┘
                 │
    ┌────────────▼────────────┐       ┌─────────────────┐
    │     PostgreSQL :5432    │       │  MinIO :9000    │
    │  (auth, rest, realtime, │       │  (file storage) │
    │   edge functions store) │       └─────────────────┘
    └─────────────────────────┘

    Dashboard (React SPA, :80) — served at /
    /db/v1/* → Auth Service (raw SQL execution)
```

---

## Service URLs (dev mode)

| Service | URL | Purpose |
|---|---|---|
| Dashboard | http://localhost:8080 | Admin panel |
| Auth API | http://localhost:8080/auth/v1 | Sign up, sign in |
| REST API | http://localhost:8080/rest/v1 | Database CRUD |
| Realtime | ws://localhost:8080/realtime/v1 | Live subscriptions |
| Storage | http://localhost:8080/storage/v1 | File operations |
| Edge Functions | http://localhost:8080/functions/v1 | Run serverless code |
| SQL Editor | http://localhost:8080/db/v1 | Raw SQL queries |
| MinIO Console | http://localhost:9001 | Storage admin UI |

---

## SDK Usage

```bash
npm install curtain
```

```typescript
import { createClient } from 'curtain'

const client = createClient('https://baas.yourdomain.com')

// --- Auth ---
const { data } = await client.auth.signUp({
  email: 'user@example.com',
  password: 'my-password',
})

await client.auth.signIn({ email: 'user@example.com', password: 'my-password' })

// --- Database ---
const { data: products } = await client
  .from('products')
  .select('id, name, price')
  .eq('active', true)
  .order('created_at', { ascending: false })
  .limit(20)
  .get()

await client.from('products').insert({ name: 'ThinkPad X1', price: 85000 })

// --- Realtime ---
client.channel('public:orders')
  .on('INSERT', (payload) => console.log('New order:', payload.new))
  .subscribe()

// --- Storage ---
const file = document.querySelector('input[type=file]').files[0]
await client.storage.from('avatars').upload(`user-123/${file.name}`, file)

// --- Edge Functions ---
const { data } = await client.functions.invoke('send-welcome-email', {
  body: { userId: '123' }
})
```

---

## Running Tests

```bash
make test            # all tests (Go + TypeScript)
make test-auth       # auth service unit tests
make test-realtime   # realtime service unit tests
make test-edge       # edge service unit tests
make test-sdk        # TypeScript SDK tests
make test-dashboard  # dashboard component tests
make test-e2e        # end-to-end (requires make dev running)
```

---

## Project Structure

```
curtain/
├── services/
│   ├── auth/           Go: JWT auth, bcrypt, Google OAuth
│   ├── realtime/       Go: WebSocket + PostgreSQL LISTEN/NOTIFY
│   ├── edge/           Go + Deno: serverless edge functions
│   └── storage-gw/     Go: JWT → MinIO S3 proxy gateway
├── dashboard/          React + Vite: admin panel
├── sdk/                TypeScript: zero-dep client SDK
├── infra/
│   ├── docker-compose.yml          production stack (Caddy TLS)
│   ├── docker-compose.dev-full.yml dev stack (nginx, exposed ports)
│   ├── docker-compose.dev.yml      minimal dev (DB only)
│   ├── caddy/Caddyfile             production reverse proxy config
│   ├── nginx-dev.conf              development reverse proxy config
│   ├── postgres/init.sql           DB schema + triggers
│   └── minio/init-buckets.sh       storage bucket initialization
├── scripts/
│   └── e2e-test.sh     integration test suite
├── docs/               detailed documentation
└── Makefile            all commands
```

---

## Documentation

Detailed guides are in [`docs/`](./docs/):

| Guide | What it covers |
|---|---|
| [What is Curtain](./docs/01-what-is-curtain.md) | Concepts, glossary, overview |
| [Architecture](./docs/02-architecture.md) | How all pieces fit together |
| [Local Development](./docs/03-local-development.md) | Setting up on your machine |
| [Services](./docs/04-services.md) | Deep dive into each service |
| [Database](./docs/05-database.md) | Schema, SQL editor, realtime |
| [Authentication](./docs/06-authentication.md) | JWT, signup/login flow, OAuth |
| [Storage](./docs/07-storage.md) | Buckets, file upload/download |
| [Edge Functions](./docs/08-edge-functions.md) | Writing and deploying functions |
| [SDK Reference](./docs/09-sdk.md) | Full SDK usage guide |
| [Production Deployment](./docs/10-deployment.md) | VPS setup, TLS, backups |
| [Contributing](./docs/11-contributing.md) | How to add features or fix bugs |

---

## Self-Hosting on Indian VPS

### Recommended providers

| Provider | Location | RAM | Price/mo |
|---|---|---|---|
| Hostinger VPS | Mumbai | 2 GB | ₹269 |
| DigitalOcean | Bangalore | 2 GB | ₹750 |
| Hetzner | Frankfurt | 2 GB | ₹450 |

### Production (3 commands)

```bash
# On your VPS
curl -fsSL https://get.docker.com | sh
git clone https://github.com/anaypurohit0907/curtain.git && cd curtain
make setup && nano infra/.env && make up
```



