# What is Curtain?

This guide explains what Curtain is, why it was built, and the key concepts you need to understand before diving into the code. Even if you're new to backend development, this page will give you the foundation you need.

---

## Table of Contents

- [The problem it solves](#the-problem-it-solves)
- [What is a Backend-as-a-Service (BaaS)?](#what-is-a-backend-as-a-service-baas)
- [What does "self-hosted" mean?](#what-does-self-hosted-mean)
- [What Curtain gives you](#what-curtain-gives-you)
- [Glossary of terms](#glossary-of-terms)

---

## The problem it solves

Most apps need a backend — a server that stores data, handles logins, and runs business logic. Building one from scratch takes weeks. Services like Firebase and Supabase solve this by giving you a ready-made backend in minutes.

The problem? Those services are hosted in the US or EU. In February 2026, Supabase was blocked by Indian ISPs (Jio, Airtel, Vodafone) under IT Act Section 69A with no warning. Developers woke up to broken apps and no data access.

**Curtain is the same idea, but you run it yourself** — on a VPS (virtual server) based in India. Your data never leaves Indian servers, and no one can cut your access.

---

## What is a Backend-as-a-Service (BaaS)?

When you build an app (mobile or web), it generally needs:

1. **A database** — to store users, products, posts, etc.
2. **Authentication** — so users can sign up and log in
3. **File storage** — for photos, documents, etc.
4. **Real-time updates** — so the UI updates live (like chat apps)
5. **Custom logic** — code that runs on the server, not the client

Traditionally you'd build all of this yourself. A **BaaS** (Backend-as-a-Service) gives you all five out of the box so you can focus entirely on your product.

Curtain is a BaaS you deploy yourself. Think of it like installing your own copy of Supabase on a server you own.

---

## What does "self-hosted" mean?

**Hosted** = someone else runs the software on their servers. You pay them, you log into their dashboard, but you don't control the machine.

**Self-hosted** = you run the software on a server you rent (a VPS). You control everything: the data, the configuration, who has access, and when it goes down.

With Curtain:
- You rent a ₹269/month VPS from Hostinger (Mumbai data center)
- You run `make up` and the whole stack starts automatically
- Your data stays in India, on your machine, under your control

The trade-off is that you're also responsible for keeping it running, doing backups, and upgrading it. The Makefile and documentation make this as simple as possible.

---

## What Curtain gives you

### PostgreSQL REST API

**PostgreSQL** is the database that stores all your data. It's one of the most popular and trusted databases in the world.

**PostgREST** sits in front of PostgreSQL and automatically turns your database tables into a REST API. Once you create a `products` table, you immediately get endpoints like:
- `GET /rest/v1/products` — list products
- `POST /rest/v1/products` — insert a product
- `PATCH /rest/v1/products?id=eq.5` — update product with id=5
- `DELETE /rest/v1/products?id=eq.5` — delete it

You don't write this API code — it's automatically generated from your schema.

### Authentication

Users need to sign up and log in. The Auth Service handles:
- **Email + password** (passwords are hashed with bcrypt — never stored in plain text)
- **Google OAuth** (sign in with Google)
- **JWT tokens** — a secure way to prove identity (explained in the glossary)
- **Refresh tokens** — short-lived access tokens + long-lived refresh tokens for security

### Realtime Subscriptions

Sometimes you want your UI to update live when the database changes — like a chat app showing new messages instantly, or a dashboard showing live order counts.

The Realtime Service uses **PostgreSQL LISTEN/NOTIFY** (a built-in Postgres feature) to detect database changes and instantly push them to connected browser clients over **WebSockets**.

### File Storage

Store images, documents, and other files. Built on **MinIO**, an open-source S3-compatible server. S3 (Amazon Simple Storage Service) is the most common file storage API in the world — MinIO implements the same API so you can use standard S3 tools.

A **Storage Gateway** service sits in front of MinIO to handle authentication — since MinIO uses AWS-style credentials rather than JWT tokens, the gateway translates between the two.

### Edge Functions

Run custom code on the server without managing a full server. You write a small TypeScript/JavaScript function, deploy it via the dashboard, and call it via HTTP. It runs on **Deno** (a modern JavaScript runtime, similar to Node.js but more secure).

### Admin Dashboard

A React web app at `http://localhost:8080` (or your domain in production) that lets you:
- Browse and edit database tables
- Run raw SQL queries
- Manage users
- Upload and download files
- Write and deploy edge functions

### TypeScript SDK

A JavaScript/TypeScript package you install in your app (`npm install curtain`) that gives you a clean API for all of the above. Instead of writing raw HTTP requests, you write:

```typescript
const { data } = await client.from('products').select('*').get()
```

---

## Glossary of terms

This project uses many technical terms. Here are clear definitions for each:

### API (Application Programming Interface)
A way for two pieces of software to talk to each other. When your mobile app needs data from the server, it makes an **API call** — it sends an HTTP request to a URL and gets JSON data back. Think of it as a standardised menu at a restaurant: you pick from the options on the menu, and the kitchen (server) prepares what you ordered.

### Authentication vs Authorisation
- **Authentication** = "Who are you?" — verifying a user's identity (login)
- **Authorisation** = "What are you allowed to do?" — checking permissions (admin vs regular user)

### bcrypt
A password hashing algorithm. Instead of storing your password as plain text (which anyone who reads the database could see), bcrypt converts it into an unreadable scrambled string. Even the engineers who built Curtain can't recover your password from the database.

### Container (Docker)
A lightweight, isolated environment that packages an application and everything it needs to run. Think of it as a sealed box: the code, libraries, and configuration are all inside, isolated from the rest of the machine. Docker is the tool that creates and manages these boxes.

### CORS (Cross-Origin Resource Sharing)
A browser security rule. By default, a web page at `app.example.com` can't make requests to `api.example.com` (a different origin). CORS headers tell the browser "this is allowed". Most API errors in local development are CORS-related.

### CRUD
The four basic operations on data: **C**reate, **R**ead, **U**pdate, **D**elete. Every database feature you'll ever use is one of these four.

### DNS (Domain Name System)
The internet's phone book. It translates a human-readable domain name (`google.com`) to an IP address (`142.250.185.46`) that computers use. When you deploy to production, you'll update a DNS record to point your domain to your VPS's IP address.

### Docker Compose
A tool for defining and running multiple Docker containers at once using a YAML file. `docker-compose.dev-full.yml` defines all 10 Curtain containers and how they connect to each other. `make dev` starts all of them with one command.

### Environment Variables
Settings injected into a program when it starts, without being hardcoded inside the source code. Stored in `infra/.env`. You never commit the `.env` file to Git because it contains secrets (passwords, JWT keys). Instead, `.env.example` shows the structure without real values.

### Go (programming language)
The language used to write the Auth, Realtime, Edge, and Storage Gateway services. Go is fast, memory-efficient, and compiles to a single binary with no external dependencies — perfect for Docker containers.

### HTTP / HTTPS
The protocol browsers and apps use to communicate with servers. **HTTP** sends data in plain text (anyone between you and the server can read it). **HTTPS** encrypts the data using TLS. In production, Caddy automatically generates TLS certificates so all traffic is encrypted.

### JSON (JavaScript Object Notation)
The most common format for exchanging data over APIs. It looks like: `{"name": "Anay", "age": 21}`. Every Curtain API sends and receives JSON.

### JWT (JSON Web Token)
A compact, signed token that proves your identity. When you sign in, the server gives you a JWT. For every subsequent request, you include the JWT in the `Authorization: Bearer <token>` header. The server validates the token's **signature** — a cryptographic proof that the server itself generated it — so it knows you're who you say you are, without needing to look you up in the database on every request.

A JWT has three parts separated by dots: `header.payload.signature`. The payload (middle part) contains your user ID and role. You can decode it at [jwt.io](https://jwt.io) but you can't forge it without the secret key.

### Makefile
A file containing named shortcuts for long commands. Instead of remembering `docker compose -f infra/docker-compose.dev-full.yml up --build -d`, you just run `make dev`. Run `make help` to see all available commands.

### MinIO
An open-source object storage server that implements the Amazon S3 API. "Object storage" means storing files (images, videos, PDFs) with a key-value model — you store a file with a name and retrieve it by that name later. "S3-compatible" means any tool that works with Amazon S3 also works with MinIO.

### Microservices
An architecture where an application is split into small, independent services that each do one specific thing. Curtain has 4 Go microservices (auth, realtime, edge, storage-gw) plus PostgREST. Contrast with a "monolith" where everything is one big application. Microservices are easier to understand, test, and scale individually.

### Nginx / Caddy (Reverse Proxy)
A **reverse proxy** sits in front of all your services and routes incoming requests to the right one. When a browser visits `localhost:8080/auth/v1/signin`, Nginx forwards that request to the Auth Service on port 9999 and sends the response back. It also handles TLS termination (decrypting HTTPS so internal services deal with plain HTTP), CORS, and header manipulation.

**Nginx** is used in development. **Caddy** is used in production — it automatically gets and renews TLS certificates from Let's Encrypt.

### OAuth
A standard for "sign in with..." flows (Google, GitHub, etc.). Instead of asking the user for a username/password, the user approves access through Google's login page and Google sends a token back to your app proving who they are. Your app never sees the user's Google password.

### PostgREST
A standalone web server that turns a PostgreSQL database into a RESTful API. You define the database schema and roles, and PostgREST auto-generates all the CRUD endpoints. Zero code needed.

### REST API
**Representational State Transfer** — a style for designing APIs using HTTP. REST APIs use URLs to represent resources and HTTP methods to describe actions:
- `GET /products` — read products
- `POST /products` — create a product
- `PATCH /products/5` — update product 5
- `DELETE /products/5` — delete product 5

### Schema (database)
The structure of a database: what tables exist, what columns each table has, and what types those columns are. In PostgreSQL, tables are also organized into **schemas** (namespaces) — Curtain uses three: `auth` (users, tokens), `storage` (file metadata), and `edge` (functions). Your app data goes in the default `public` schema.

### SQL (Structured Query Language)
The language used to talk to relational databases like PostgreSQL. Examples:
- `SELECT * FROM users WHERE email = 'x@example.com'` — read
- `INSERT INTO products (name, price) VALUES ('Widget', 100)` — write
- `CREATE TABLE orders (id SERIAL PRIMARY KEY, total INTEGER)` — create table
- `DROP TABLE old_table` — delete table

### TLS / SSL (Transport Layer Security)
The encryption that makes HTTPS work. It ensures that data sent between the browser and server can't be read by anyone in between. In production, Caddy automatically handles TLS using **Let's Encrypt** — a free certificate authority. You don't need to buy or manage certificates.

### TypeScript
A typed superset of JavaScript. All the regular JS syntax works, but you can also add type annotations (`name: string`, `age: number`) that catch errors before the code runs. The SDK and Dashboard are written in TypeScript.

### UUID (Universally Unique Identifier)
A 128-bit random identifier, usually displayed as `550e8400-e29b-41d4-a716-446655440000`. Curtain uses UUIDs as primary keys for users and other records because they can be generated anywhere (no central counter needed) and are effectively impossible to guess by brute force.

### VPS (Virtual Private Server)
A virtual machine you rent from a cloud provider. You get SSH access, an IP address, and full control over the operating system. Unlike shared hosting, a VPS is isolated — your processes don't share resources with other customers. A ₹269/month VPS from Hostinger in Mumbai is sufficient to run the full Curtain stack.

### WebSocket
A persistent, two-way connection between a browser and server. Unlike regular HTTP (which is request-response — you ask, server answers, connection closes), a WebSocket stays open so the server can push data to the browser at any time. Curtain's Realtime Service uses WebSockets to deliver live database updates.

---

Next: [Architecture](./02-architecture.md) — how all the pieces connect to each other.
