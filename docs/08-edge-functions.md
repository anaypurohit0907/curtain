# Edge Functions

Edge Functions let you run custom server-side code without managing a separate server. You write a TypeScript/JavaScript function, deploy it to Curtain, and call it via HTTP.

---

## Table of Contents

- [What are edge functions?](#what-are-edge-functions)
- [How the edge service works](#how-the-edge-service-works)
- [Writing your first function](#writing-your-first-function)
- [Deploying a function](#deploying-a-function)
- [Invoking a function](#invoking-a-function)
- [The request/response model](#the-requestresponse-model)
- [Accessing environment variables](#accessing-environment-variables)
- [Function examples](#function-examples)
- [Updating a function](#updating-a-function)
- [Deleting a function](#deleting-a-function)
- [Listing all functions](#listing-all-functions)
- [Timeouts and limits](#timeouts-and-limits)
- [Using the dashboard](#using-the-dashboard)
- [API reference](#api-reference)

---

## What are edge functions?

An **edge function** (also called a serverless function or lambda) is a piece of code that runs on demand when called via HTTP, without you having to manage a server process.

**Why use them?**
- Run backend logic without writing a full API server
- Triggered by HTTP calls from your frontend
- Each function is isolated — a bug in one doesn't affect others
- Code is stored in the database and executed on the fly

**When to use them:**
- Send email/SMS notifications
- Process payments with Razorpay/Stripe
- Call third-party APIs (keeping API keys server-side)
- Validate or transform data before saving
- Scheduled tasks (by calling the function from a cron job)

---

## How the edge service works

```
POST /functions/v1/invoke/my-function
       │
       ▼
Edge Service (Go, port 5555)
  1. Looks up "my-function" in the edge.functions table
  2. Writes the code to a temp file: /tmp/fn/my-function.ts
  3. Runs: deno run --allow-net /tmp/fn/my-function.ts
  4. Sends HTTP request + headers as stdin
  5. Reads stdout as the response body
  6. Returns the response to the caller
```

**What is Deno?** Deno is a JavaScript/TypeScript runtime (like Node.js) built with security in mind. By default, Deno code has no access to the filesystem, network, or environment unless explicitly granted. Curtain runs functions with `--allow-net` (network access allowed) and injects environment variables explicitly.

**Why store functions in the database?** This means:
- No filesystem management needed
- Functions survive container restarts
- You can update them via the dashboard or API without redeploying

---

## Writing your first function

Functions must export a default handler that receives and returns an HTTP-like object:

```typescript
// handler.ts — the simplest possible function
export default async function handler(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({ message: "Hello from Curtain!" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  )
}
```

The `Request` and `Response` types follow the standard **Fetch API** (Web standard). If you've used `fetch()` in a browser, you already know them:

```typescript
export default async function handler(req: Request): Promise<Response> {
  // Read the request body
  const body = await req.json()
  const name = body.name ?? "stranger"

  // Read a request header
  const userAgent = req.headers.get("user-agent")

  return new Response(
    JSON.stringify({ greeting: `Hello, ${name}!`, agent: userAgent }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
}
```

---

## Deploying a function

Use the dashboard's **Functions** tab, or the API directly:

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST http://localhost:8080/functions/v1/functions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hello-world",
    "slug": "hello-world",
    "code": "export default async function handler(req) { return new Response(JSON.stringify({message: \"hello!\"}), {status: 200, headers: {\"Content-Type\": \"application/json\"}}); }"
  }'
```

- **name** — A human-readable label for the function
- **slug** — The URL-safe identifier used to invoke the function. Must be unique. Only use lowercase letters, numbers, and hyphens. Example: `send-email`, `process-payment`.
- **code** — The TypeScript/JavaScript source code as a string

---

## Invoking a function

```bash
# Call the function you deployed above
curl -X POST http://localhost:8080/functions/v1/invoke/hello-world \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice"}'
```

The path is `/functions/v1/invoke/{slug}`.

**Note**: Invoking a function does NOT require authentication if you don't check for it in your function code. The edge service validates JWTs for management operations (deploy/list/delete), but `invoke` works without a token too. Add your own auth logic inside the function if needed.

---

## The request/response model

When your function is invoked, the edge runner:
1. Converts the incoming HTTP request into a `Request` object
2. Passes it to your `handler` function
3. Takes the `Response` your function returns
4. Sends it back to the caller

**Reading the request**:
```typescript
export default async function handler(req: Request): Promise<Response> {
  // URL and method
  const url = new URL(req.url)
  const method = req.method  // "GET", "POST", etc.

  // Query params: /invoke/my-fn?page=1
  const page = url.searchParams.get("page")

  // Request headers
  const authHeader = req.headers.get("authorization")

  // Request body (for POST/PUT)
  let body = {}
  if (req.method === "POST") {
    body = await req.json()
  }

  return new Response(JSON.stringify({ method, page, body }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
```

**Setting response headers**:
```typescript
return new Response("File data...", {
  status: 200,
  headers: {
    "Content-Type":        "text/plain",
    "X-Custom-Header":     "my-value",
    "Cache-Control":       "max-age=3600",
  }
})
```

---

## Accessing environment variables

You can set per-function environment variables when deploying. They're stored in `edge.functions.env_vars` (a JSONB column).

Inside your function, access them via `Deno.env.get()`:

```typescript
export default async function handler(req: Request): Promise<Response> {
  const apiKey = Deno.env.get("RAZORPAY_KEY")
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "RAZORPAY_KEY not configured" }),
      { status: 500 }
    )
  }

  // Use the key to call Razorpay
  const response = await fetch("https://api.razorpay.com/v1/payments", {
    headers: { "Authorization": "Basic " + btoa(apiKey + ":") }
  })

  const data = await response.json()
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })
}
```

---

## Function examples

### Send a welcome email (using Resend)

```typescript
export default async function handler(req: Request): Promise<Response> {
  const { email, name } = await req.json()

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    "noreply@yourdomain.com",
      to:      [email],
      subject: "Welcome!",
      html:    `<h1>Hi ${name}, welcome to our app!</h1>`,
    }),
  })

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "email_failed" }), { status: 500 })
  }

  return new Response(JSON.stringify({ sent: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
```

### Validate input before saving

```typescript
export default async function handler(req: Request): Promise<Response> {
  const { phone } = await req.json()

  // Indian phone number validation
  const valid = /^[6-9]\d{9}$/.test(phone)
  if (!valid) {
    return new Response(
      JSON.stringify({ error: "invalid_phone", message: "Must be a 10-digit Indian mobile number starting with 6-9" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  return new Response(
    JSON.stringify({ valid: true, formatted: `+91${phone}` }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
}
```

---

## Updating a function

```bash
# Update using the function's ID (returned when you created it)
curl -X PUT "http://localhost:8080/functions/v1/functions/{id}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "export default async function handler(req) { ... }"}'

# Or redeploy by slug
curl -X PUT "http://localhost:8080/functions/v1/deploy/hello-world" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "hello-world", "code": "..."}'
```

---

## Deleting a function

```bash
curl -X DELETE "http://localhost:8080/functions/v1/functions/{id}" \
  -H "Authorization: Bearer $TOKEN"
```

Response: **204 No Content**.

---

## Listing all functions

```bash
curl http://localhost:8080/functions/v1/functions \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
[
  {
    "id":         "550e8400-e29b-41d4-a716-446655440000",
    "name":       "hello-world",
    "slug":       "hello-world",
    "active":     true,
    "created_at": "2026-03-15T14:30:00Z",
    "updated_at": "2026-03-15T14:30:00Z"
  }
]
```

Note: The `code` field is not included in the list response (only in individual function responses) to keep the payload small.

---

## Timeouts and limits

| Limit | Default | Change with |
|-------|---------|-------------|
| Execution timeout | 5 seconds | `FUNCTION_TIMEOUT_MS` env var |
| Request body size | 1 MB | Hardcoded in edge service |
| Memory | Shared | Per-container memory limit in docker-compose |

If a function exceeds the timeout, the edge service kills the Deno process and returns:
```json
{
  "error":       "function_error",
  "message":     "function timed out",
  "duration_ms": 5000
}
```

---

## Using the dashboard

The dashboard's **Functions** tab provides:

1. **List view** — All deployed functions with name, slug, and creation date
2. **Create** — A code editor to write and deploy functions
3. **Edit** — Click a function to update its code
4. **Delete** — Remove a function
5. **Invoke** — Test-call a function from the dashboard with custom JSON input

---

## API reference

All management endpoints require `Authorization: Bearer <token>` with a JWT that has `role: authenticated`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/functions/v1/functions` | List all functions |
| POST | `/functions/v1/functions` | Create a function |
| PUT | `/functions/v1/functions/{id}` | Update function code by ID |
| DELETE | `/functions/v1/functions/{id}` | Delete function by ID |
| PUT | `/functions/v1/deploy/{slug}` | Deploy/update by slug |
| DELETE | `/functions/v1/deploy/{slug}` | Delete by slug |
| POST | `/functions/v1/invoke/{slug}` | Invoke a function |

---

Next: [SDK Reference](./09-sdk.md) — the TypeScript client SDK.
