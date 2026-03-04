# Curtain Documentation

Welcome to the Curtain documentation. These guides explain how to use, understand, and contribute to Curtain — a self-hosted Backend-as-a-Service designed for small teams and indie developers.

---

## Who is this for?

- **Developers building an app** who want to understand what features are available and how to use them
- **DevOps / sysadmins** deploying Curtain to a production server
- **Contributors** who want to understand the codebase and make changes
- **Students** learning how a real-world backend system is built

Each guide is written to be accessible even if you're new to some of the concepts involved. Technical terms are explained when first used.

---

## Guides

| # | Guide | What it covers |
|---|-------|----------------|
| 01 | [What is Curtain?](./01-what-is-curtain.md) | Overview, features, glossary of terms |
| 02 | [Architecture](./02-architecture.md) | How all the services fit together, request lifecycle |
| 03 | [Local Development](./03-local-development.md) | Setting up on your machine with `make dev` |
| 04 | [Services](./04-services.md) | Deep dive into each service and what it does |
| 05 | [Database](./05-database.md) | PostgreSQL schema, SQL editor, PostgREST API, realtime |
| 06 | [Authentication](./06-authentication.md) | Sign up, sign in, JWT tokens, refresh tokens, Google OAuth |
| 07 | [Storage](./07-storage.md) | File buckets, uploads, the storage gateway |
| 08 | [Edge Functions](./08-edge-functions.md) | Writing and deploying serverless TypeScript functions |
| 09 | [SDK Reference](./09-sdk.md) | TypeScript client library for your app |
| 10 | [Deployment](./10-deployment.md) | Production VPS setup, HTTPS with Caddy, backups |
| 11 | [Contributing](./11-contributing.md) | Codebase structure, running tests, making changes |

---

## Quick orientation

**New to Curtain?** Start with [01 — What is Curtain?](./01-what-is-curtain.md) to understand what it does, then [02 — Architecture](./02-architecture.md) for how it works.

**Setting up locally?** Go straight to [03 — Local Development](./03-local-development.md).

**Building an app?** Read [05 — Database](./05-database.md), [06 — Authentication](./06-authentication.md), and [09 — SDK Reference](./09-sdk.md).

**Deploying to production?** See [10 — Deployment](./10-deployment.md).

**Making code changes?** See [11 — Contributing](./11-contributing.md).

---

## Visual overview

```
Your App (React, mobile, etc.)
        │
        ▼ HTTP/WebSocket
  ┌─────────────┐
  │  nginx/Caddy │  (single entry point)
  └──────┬───────┘
         │
    ┌────┴──────────────────────────────────────────────┐
    │                                                   │
    ▼                                                   ▼
/auth/v1/*                                      /rest/v1/*
Auth Service (Go)                               PostgREST
sign up, sign in, JWT                           auto REST API from your tables
         │                                             │
    /db/v1/*                                    /realtime/v1/*
    Raw SQL editor                              Realtime Service (Go)
         │                                      WebSocket + LISTEN/NOTIFY
    /storage/v1/*                                      │
    Storage Gateway (Go)                        /functions/v1/*
    JWT → S3 credentials                        Edge Service (Go + Deno)
         │                                      run TypeScript server-side
         ▼
       MinIO                    All services share one PostgreSQL database
       (S3-compatible
        file storage)
```

---

## Key concepts at a glance

| Concept | What it means | Docs |
|---------|--------------|------|
| **JWT** | Signed token that proves who you are | [Authentication](./06-authentication.md#how-tokens-work-jwt-explained) |
| **PostgREST** | Automatic REST API from your database tables | [Database](./05-database.md#querying-data-via-postgrest) |
| **RLS** | Row-Level Security — the database enforces who can see what data | [Database](./05-database.md#row-level-security) |
| **Realtime** | Database-change events pushed to browsers via WebSocket | [Database](./05-database.md#realtime-subscriptions) |
| **Edge Functions** | Run TypeScript code on demand without a separate server | [Edge Functions](./08-edge-functions.md) |
| **Storage Gateway** | Translates JWT auth to S3 credentials for MinIO | [Storage](./07-storage.md#the-storage-gateway--why-it-exists) |

---

## Getting help

- **Bugs and issues**: [GitHub Issues](https://github.com/anaypurohit/curtain/issues)
- **Questions**: Start a [GitHub Discussion](https://github.com/anaypurohit0907/curtain/discussions)
