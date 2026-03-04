# Authentication

This guide explains how Curtain handles user identity — sign up, sign in, JWT tokens, refresh tokens, and Google OAuth. It's written for developers who may not have built an auth system before.

---

## Table of Contents

- [What authentication means](#what-authentication-means)
- [How tokens work (JWT explained)](#how-tokens-work-jwt-explained)
- [Sign up](#sign-up)
- [Sign in](#sign-in)
- [Using the access token](#using-the-access-token)
- [Token refresh](#token-refresh)
- [Sign out](#sign-out)
- [User profile](#user-profile)
- [Google OAuth](#google-oauth)
- [Admin: list all users](#admin-list-all-users)
- [Auth service routes reference](#auth-service-routes-reference)
- [Environment variables](#environment-variables)

---

## What authentication means

**Authentication** = proving who you are. When you log in to a website with your email and password, you're authenticating — the server checks that the password you sent matches what it has stored.

**Authorization** = what you're allowed to do once the server knows who you are. Different users have different permissions.

Curtain uses **JWT tokens** for both: the token proves who you are, and it contains your role (e.g. `authenticated`) which determines what you can access.

---

## How tokens work (JWT explained)

**JWT** (JSON Web Token) is a small text string that contains user information and a cryptographic signature. Think of it like a signed ID badge:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MDBm...
└─── header ────┘ └──────────── payload (base64) ──────────────┘
                                                 └─ signature ─┘
```

The three parts (separated by dots) are:
1. **Header** — tells you the algorithm used (HS256 = HMAC SHA-256)
2. **Payload** — the actual data (user ID, role, email, expiry time), base64-encoded
3. **Signature** — a cryptographic hash of the header + payload, signed with `JWT_SECRET`

**Why it's secure**: Anyone can read the payload (just base64-decode it). But nobody can fake a valid signature without knowing `JWT_SECRET`. So the server can trust the claims inside without doing a database lookup — it just verifies the signature.

**What the payload looks like** (decoded):
```json
{
  "sub":   "550e8400-e29b-41d4-a716-446655440000",
  "role":  "authenticated",
  "email": "user@example.com",
  "iss":   "curtain",
  "iat":   1741000000,
  "exp":   1741003600
}
```

- `sub` — Subject. The user's UUID (unique ID).
- `role` — Used by PostgREST to select the PostgreSQL role.
- `iat` — Issued At (Unix timestamp).
- `exp` — Expiry time. After this, the token is rejected.

The default token lifetime is **1 hour** (controlled by `JWT_EXPIRY`).

---

## Sign up

Create a new account with email and password.

```bash
curl -X POST http://localhost:8080/auth/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "password": "mysecretpassword"}'
```

**Rules**:
- Email must be unique (can't reuse across accounts)
- Password must be at least 6 characters

**Response (201 Created)**:
```json
{
  "access_token":  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "8f14e45f-ceea-367f-a027-6d4c1b05e3f2-...",
  "token_type":    "bearer",
  "expires_in":    3600,
  "user": {
    "id":         "550e8400-e29b-41d4-a716-446655440000",
    "email":      "alice@example.com",
    "provider":   "email",
    "role":       "authenticated",
    "confirmed":  false,
    "created_at": "2026-03-15T14:30:00Z"
  }
}
```

**How the password is stored**: The plaintext password is **never stored**. Instead, it's run through **bcrypt** (a one-way hashing function) with cost factor 12, and only the hash is saved. `bcrypt cost 12` means computing the hash takes ~150ms deliberately — this slows down attackers who try millions of guesses.

**Error examples**:
```json
{"error": "email_exists", "message": "a user with this email already exists"}
{"error": "validation_failed", "message": "email and password are required"}
{"error": "password_too_short", "message": "password must be at least 6 characters"}
```

---

## Sign in

```bash
curl -X POST http://localhost:8080/auth/v1/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "password": "mysecretpassword"}'
```

**What happens internally**:
1. Server looks up the user by email in `auth.users`
2. Calls `bcrypt.CompareHashAndPassword(storedHash, providedPassword)`
3. If they match, generates a new JWT access token + refresh token
4. Returns both tokens

**Response** is identical to signup (200 OK).

**Security note**: Whether the email doesn't exist or the password is wrong, you get the same error (`invalid_credentials`). This prevents attackers from discovering which emails are registered.

```json
{"error": "invalid_credentials", "message": "invalid email or password"}
```

---

## Using the access token

Include the `access_token` in the `Authorization` header for all authenticated API calls:

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Query your data via PostgREST
curl http://localhost:8080/rest/v1/orders \
  -H "Authorization: Bearer $TOKEN"

# Run a SQL query
curl -X POST http://localhost:8080/db/v1/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT * FROM orders LIMIT 5"}'
```

**Token storage in frontend apps**: Store the token in `localStorage` (for web apps) or secure storage (for mobile). The Curtain dashboard stores it at key `curtain.access_token`.

---

## Token refresh

Access tokens expire after 1 hour. Instead of making the user log in again, use the **refresh token** to get a new access token silently.

**Refresh tokens** are long-lived (7 days) opaque strings stored in the `auth.refresh_tokens` table. They can only be used once (consumed on use).

```bash
curl -X POST http://localhost:8080/auth/v1/token/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "8f14e45f-ceea-367f-a027-6d4c1b05e3f2-..."}'
```

**Response**: A fresh `access_token` + new `refresh_token` (the old one is deleted).

**Flow in a frontend app**:
1. Store both `access_token` and `refresh_token` on login
2. When you get a 401 Unauthorized response, call `/token/refresh`
3. Update stored tokens with the new pair
4. Retry the original request

---

## Sign out

```bash
curl -X POST http://localhost:8080/auth/v1/signout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "8f14e45f-ceea-367f-a027-..."}'
```

This invalidates the refresh token server-side. The access token remains technically valid until it expires (JWT tokens can't be "revoked" because they're stateless — the server doesn't store them). This is why short expiry times matter.

Response: **204 No Content** (empty body, success).

---

## User profile

### Get current user

```bash
curl http://localhost:8080/auth/v1/user \
  -H "Authorization: Bearer $TOKEN"
```

Returns the user object for whoever owns the token.

### Update user metadata

You can store arbitrary JSON in the `metadata` field — useful for app-specific user data like display name, preferences, etc.

```bash
curl -X PUT http://localhost:8080/auth/v1/user \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"metadata": {"display_name": "Alice", "avatar_url": "https://..."}}'
```

---

## Google OAuth

Google OAuth lets users sign in with their Google account instead of a password. The flow is:

```
User clicks "Sign in with Google"
    → Browser is redirected to /auth/v1/oauth/google
    → Server redirects to Google's consent screen
    → User approves
    → Google redirects to /auth/v1/oauth/google/callback?code=...
    → Server exchanges code for user info
    → Server creates/finds the user in auth.users
    → Server redirects browser to /auth/callback#access_token=...&refresh_token=...
    → Frontend reads tokens from URL fragment
```

### Setup

You need a Google OAuth app. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project, enable OAuth, and add your redirect URI.

In your `.env`:
```env
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret-here
SITE_URL=http://localhost:8080
```

The redirect URI to register with Google: `http://localhost:8080/auth/v1/oauth/google/callback`

### Trigger the flow

In your frontend, redirect the user to:
```
http://localhost:8080/auth/v1/oauth/google
```

### Handle the callback

After Google approves, the browser lands at `/auth/callback#access_token=...`. Read the tokens from the URL fragment:

```typescript
// /auth/callback page
const hash = window.location.hash.substring(1)
const params = new URLSearchParams(hash)
const accessToken = params.get('access_token')
const refreshToken = params.get('refresh_token')
// Store and use them
```

**Note**: Using the URL **fragment** (`#`) instead of query params (`?`) is intentional security: fragments are never sent to the server in HTTP requests, so the tokens can't appear in server logs.

### What happens to the user

Google OAuth users are stored in `auth.users` with:
- `provider = 'google'`
- `password = NULL` (no password — they can't sign in with email/password)
- `provider_id = google_user_sub` (Google's internal user ID)

If the user signs in with Google again, `UpsertOAuthUser` finds the existing record and just issues new tokens — no duplicate is created.

---

## Admin: list all users

This endpoint is for the dashboard's Users page. Requires a valid JWT.

```bash
curl http://localhost:8080/auth/v1/admin/users \
  -H "Authorization: Bearer $TOKEN"
```

Returns an array of all user objects (without passwords).

---

## Auth service routes reference

| Method | Path | Auth required | Description |
|--------|------|--------------|-------------|
| POST | `/auth/v1/signup` | No | Create account |
| POST | `/auth/v1/signin` | No | Sign in, get tokens |
| POST | `/auth/v1/signout` | No | Invalidate refresh token |
| POST | `/auth/v1/token/refresh` | No | Get new access token |
| GET | `/auth/v1/user` | Yes | Get current user |
| PUT | `/auth/v1/user` | Yes | Update user metadata |
| GET | `/auth/v1/admin/users` | Yes | List all users |
| POST | `/db/v1/query` | Yes | Execute raw SQL |
| GET | `/auth/v1/oauth/google` | No | Start Google OAuth |
| GET | `/auth/v1/oauth/google/callback` | No | Google OAuth callback |

Note: `/db/v1/query` is routed to the auth service by nginx.

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Secret key for signing tokens (min 32 chars) |
| `JWT_EXPIRY` | No | `3600` | Access token lifetime in seconds |
| `PORT` | No | `9999` | Port the service listens on |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID; feature disabled if empty |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth client secret |
| `SITE_URL` | No | `http://localhost:8080` | Base URL for OAuth redirect URIs |

---

Next: [Storage](./07-storage.md) — file buckets, uploads, and the storage gateway.
