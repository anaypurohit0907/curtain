# Local Development Setup

This guide walks you through getting Curtain running on your own computer, step by step. By the end, you'll have all 10 services running locally and the admin dashboard open in your browser.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Clone the repository](#step-1-clone-the-repository)
- [Step 2: Configure environment variables](#step-2-configure-environment-variables)
- [Step 3: Start the stack](#step-3-start-the-stack)
- [Step 4: Create your first account](#step-4-create-your-first-account)
- [Step 5: Explore the dashboard](#step-5-explore-the-dashboard)
- [Useful commands](#useful-commands)
- [Ports reference](#ports-reference)
- [Common problems and solutions](#common-problems-and-solutions)
- [Stopping and cleaning up](#stopping-and-cleaning-up)

---

## Prerequisites

You need three tools installed:

### Docker

Docker runs containers — isolated environments for each service. Install it for your OS:

- **Linux (Fedora/RHEL)**: `sudo dnf install docker docker-compose && sudo systemctl enable --now docker`
- **Linux (Ubuntu/Debian)**: `sudo apt install docker.io docker-compose`
- **macOS / Windows**: Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)

After installing, allow your user to run Docker without `sudo`:
```bash
sudo usermod -aG docker $USER
newgrp docker    # or log out and back in
```

Verify Docker works:
```bash
docker run hello-world
# Should print "Hello from Docker!"
```

### make

`make` is a standard Unix tool that runs shortcuts defined in the `Makefile`.

- **Fedora/RHEL**: `sudo dnf install make`
- **Ubuntu/Debian**: `sudo apt install make`
- **macOS**: Already installed (part of Xcode Command Line Tools)
- **Windows**: Use WSL2 (Windows Subsystem for Linux)

### Git

For cloning the repository. Usually already installed. Check: `git --version`.

---

## Step 1: Clone the repository

"Cloning" means downloading a copy of the source code from GitHub to your machine.

```bash
git clone https://github.com/anaypurohit0907/curtain.git
cd curtain
```

You should see a directory structure like this:
```
curtain/
├── Makefile
├── README.md
├── dashboard/
├── docs/
├── infra/
├── sdk/
├── scripts/
└── services/
```

---

## Step 2: Configure environment variables

**Environment variables** are settings passed to programs when they start. They're stored in a file called `.env` (short for "environment"). This file is never committed to Git because it contains passwords.

Run the setup command, which copies the example template:
```bash
make setup
```

This creates `infra/.env`. Open it in your editor:
```bash
nano infra/.env      # or code infra/.env, or any text editor
```

You'll see something like this:
```dotenv
# === Required ===
DOMAIN=localhost
POSTGRES_PASSWORD=changeme
JWT_SECRET=changeme-must-be-at-least-32-characters
MINIO_ROOT_PASSWORD=changeme
ADMIN_EMAIL=you@example.com

# === Optional ===
POSTGRES_DB=curtain
POSTGRES_USER=curtain
MINIO_ROOT_USER=minio
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SITE_URL=http://localhost:8080
```

### What each variable means

| Variable | What it does | Example |
|---|---|---|
| `DOMAIN` | Your domain name (for production TLS). Use `localhost` for local dev. | `localhost` |
| `POSTGRES_PASSWORD` | Password for the PostgreSQL database user | Use a strong random string |
| `JWT_SECRET` | Secret key for signing JWT tokens. **Must be at least 32 characters.** | Use a strong random string |
| `MINIO_ROOT_PASSWORD` | Password for the MinIO storage admin | Use a strong random string |
| `ADMIN_EMAIL` | Your email (used by Caddy for TLS cert renewal in production) | `you@example.com` |
| `POSTGRES_USER` | PostgreSQL username (default: `curtain`) | `curtain` |
| `MINIO_ROOT_USER` | MinIO admin username (default: `minio`) | `minio` |
| `GOOGLE_CLIENT_ID` | For Google "Sign in with Google" (optional) | From Google Console |
| `SITE_URL` | Base URL for OAuth redirects | `http://localhost:8080` |

### Generating strong secrets

For development you can use simple values. For any real deployment, use random values:

```bash
# Generate a strong JWT secret
openssl rand -hex 32
# Example output: 8a2c18b57f0617736b49f10d48dd8b2e68897342b565709286d838cec91f7f5e

# Generate a strong database password
openssl rand -hex 32
```

### Development values (quick start)

For local development only (not production!), you can use:
```dotenv
DOMAIN=localhost
POSTGRES_PASSWORD=devpassword123
JWT_SECRET=dev-jwt-secret-minimum-32-characters-long
MINIO_ROOT_PASSWORD=devminiopassword
ADMIN_EMAIL=dev@example.com
```

---

## Step 3: Start the stack

One command starts all 10 containers:

```bash
make dev
```

What happens:
1. Docker builds images for all Go services (auth, realtime, edge, storage-gw) and the dashboard
2. Docker pulls pre-built images for PostgreSQL, PostgREST, and MinIO
3. All containers start with the dev configuration
4. You'll see output like:
   ```
   Starting Curtain dev stack...
    Container curtain-dev-postgres    Started
    Container curtain-dev-auth        Started
    Container curtain-dev-postgrest   Started
    Container curtain-dev-realtime    Started
    Container curtain-dev-edge        Started
    Container curtain-dev-storage     Started
    Container curtain-dev-storage-gw  Started
    Container curtain-dev-dashboard   Started
    Container curtain-dev-nginx       Started
   Dev stack up:
     Dashboard:  http://localhost:8080
   ```

On a fast machine with cached Docker layers, this takes about 30 seconds. The first time (when Docker needs to download base images and compile Go code) can take 2–5 minutes.

### Verify everything is running

```bash
make ps
```

You should see something like:
```
NAME                          STATUS
curtain-dev-postgres        running
curtain-dev-auth            running
curtain-dev-postgrest       running
curtain-dev-realtime        running
curtain-dev-edge            running
curtain-dev-storage         running
curtain-dev-storage-gw      running
curtain-dev-dashboard       running
curtain-dev-nginx           running
```

All containers should show `running`. If any show `exited`, check the logs (see [Common problems](#common-problems-and-solutions)).

---

## Step 4: Create your first account

The database starts empty — there are no users. You need to create the first account.

Open a terminal and run:
```bash
curl -s -X POST http://localhost:8080/auth/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"my-password"}' | python3 -m json.tool
```

You should get a response like:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "5c4bbc85-2b71-4aae-804f-3f57d70dd894",
    "email": "admin@example.com",
    "role": "authenticated"
  }
}
```

You can also create accounts directly from the dashboard login page's signup form (if one is present), or use any HTTP client like [Postman](https://www.postman.com/) or [Bruno](https://www.usebruno.com/).

---

## Step 5: Explore the dashboard

Open http://localhost:8080 in your browser.

You'll see a login form. Sign in with the credentials you just created.

### Dashboard pages

After signing in, you'll see a sidebar with these sections:

**Database**
- Run any SQL query against your PostgreSQL database
- Use the quick-access buttons (List tables, Create table, etc.)
- Results appear as a scrollable table below the editor
- Press `Ctrl+Enter` to run the current query

**Auth**
- See all registered users
- View user IDs, emails, roles, and creation dates

**Storage**
- See your MinIO buckets (`public`, `private`, `system`)
- Upload files by clicking a bucket
- Delete files

**Functions**
- Write TypeScript/JavaScript edge functions
- Deploy them with a name and URL slug
- Test-invoke them with a JSON payload

---

## Useful commands

```bash
# Start all services
make dev

# Show status of all containers
make ps

# View live logs from all containers
make logs

# View logs from a specific service
docker logs curtain-dev-auth -f      # -f = follow (keep streaming)
docker logs curtain-dev-postgres -f

# Open a PostgreSQL shell (run SQL directly)
make psql

# Run the test suite
make test

# Run just end-to-end tests (requires make dev running)
make test-e2e

# Rebuild and restart (after changing Go or React code)
make dev

# Stop all containers
make down

# Reset the database (WARNING: deletes all data)
make reset-db

# Save a database backup
make pg-dump    # saves to ./backups/
```

---

## Ports reference

In dev mode, these ports are exposed on your machine:

| Port | Service | What you can do |
|---|---|---|
| 8080 | Nginx (entry point) | Access everything through here |
| 5432 | PostgreSQL | Connect with psql or TablePlus/DBeaver |
| 3000 | PostgREST | Direct REST API (bypass nginx) |
| 9999 | Auth Service | Direct auth API (bypass nginx) |
| 4000 | Realtime | WebSocket connections |
| 9000 | MinIO API | S3-compatible API |
| 9001 | MinIO Console | Web UI for storage admin |
| 5555 | Edge Service | Direct functions API |
| 6333 | Storage Gateway | Direct gateway calls |

**Tip**: You can connect a database GUI like [TablePlus](https://tableplus.com/) to `localhost:5432` with user `curtain` and the password from your `.env` file.

---

## Common problems and solutions

### "Cannot connect to Docker daemon"

```
permission denied while trying to connect to the Docker daemon socket
```

Your user isn't in the `docker` group yet:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

### "Port already in use"

```
Error: bind: address already in use  port 5432
```

Something else on your machine is using that port (maybe you have PostgreSQL installed locally). Options:
1. Stop the conflicting service: `sudo systemctl stop postgresql`
2. Or edit `infra/docker-compose.dev-full.yml` to change the host port (left side of `5432:5432`)

---

### A container keeps restarting

```bash
# See what went wrong
docker logs curtain-dev-auth

# Common causes:
# - DATABASE_URL wrong (check .env)
# - JWT_SECRET too short (must be 32+ characters)
# - Port conflict
```

---

### Dashboard shows "Error: Network request failed"

The auth or API service may not be running. Check:
```bash
make ps              # are all containers running?
docker logs curtain-dev-nginx   # any nginx errors?
```

---

### "Make: command not found"

Install make:
- Linux: `sudo apt install make` or `sudo dnf install make`
- macOS: `xcode-select --install`

---

### Changes to Go code don't appear

You need to rebuild the affected container:
```bash
make dev    # rebuilds everything that changed
```

Or rebuild just one service:
```bash
cd infra && docker compose -f docker-compose.dev-full.yml up --build auth -d
```

---

### Changes to dashboard code don't appear

Same — the dashboard is compiled at build time, so you need to rebuild:
```bash
make dev
```

For faster iteration during active frontend development, you can run the Vite dev server locally (with hot reload) while keeping the backend on Docker:

```bash
# In one terminal: keep backend running
make dev

# In another terminal: run frontend with hot reload
cd dashboard
VITE_API_URL=http://localhost:8080 npm run dev
# Open http://localhost:5173 instead of :8080
```

---

## Stopping and cleaning up

```bash
# Stop containers (data is preserved in Docker volumes)
make down

# Stop AND delete all data (volumes, networks, everything)
cd infra && docker compose -f docker-compose.dev-full.yml down -v
```

The `-v` flag removes Docker **volumes** — the persistent storage where PostgreSQL and MinIO keep their data. Don't use `-v` unless you want to start with a completely fresh database.

---

Next: [Services](./04-services.md) — a deep dive into what each service does and how to modify it.
