# Deployment

This guide walks through deploying Curtain to a production VPS (Virtual Private Server). By the end you'll have a running instance at `https://baas.yourdomain.com` with automatic HTTPS.

---

## Table of Contents

- [What you need](#what-you-need)
- [Choosing a VPS](#choosing-a-vps)
- [Step 1: Provision the server](#step-1-provision-the-server)
- [Step 2: Install Docker](#step-2-install-docker)
- [Step 3: Point your domain to the server](#step-3-point-your-domain-to-the-server)
- [Step 4: Clone the repo](#step-4-clone-the-repo)
- [Step 5: Configure environment variables](#step-5-configure-environment-variables)
- [Step 6: Start production stack](#step-6-start-production-stack)
- [Step 7: Verify everything works](#step-7-verify-everything-works)
- [HTTPS with Caddy](#https-with-caddy)
- [Memory limits and tuning](#memory-limits-and-tuning)
- [Backups in production](#backups-in-production)
- [Logs and monitoring](#logs-and-monitoring)
- [Updating Curtain](#updating-curtain)
- [Troubleshooting](#troubleshooting)

---

## What you need

1. **A VPS** — A virtual machine in the cloud. Minimum 1 vCPU, 2 GB RAM.
2. **A domain name** — Like `yourdomain.com`. You need a subdomain to point at the server.
3. **Basic Linux knowledge** — comfortable with SSH and the terminal.

No Kubernetes, no complex cloud setup. Just Docker on a single Linux machine.

---

## Choosing a VPS

Budget-friendly options (~₹269–450/month):

| Provider | Plan | Price | RAM | CPU |
|----------|------|-------|-----|-----|
| [Hetzner Cloud](https://hetzner.com/cloud) | CX11 | €3.79/mo | 2 GB | 1 vCPU |
| [Railway](https://railway.app) | Container | ~$5/mo | 1 GB | 1 vCPU |
| [DigitalOcean](https://digitalocean.com) | Droplet | $6/mo | 1 GB | 1 vCPU |
| [Hostinger](https://hostinger.in) | KVM 1 | ₹269/mo | 1 GB | 1 vCPU |

**Recommended**: Hetzner CX22 (2 GB RAM, €4.49/mo) gives comfortable headroom. For hobby projects, even 1 GB is workable if you reduce memory limits.

**Operating system**: Ubuntu 22.04 LTS or Debian 12. This guide uses Ubuntu.

---

## Step 1: Provision the server

1. Create a VPS with your chosen provider
2. Add your SSH public key during creation (or add it after)
3. SSH in as root:

```bash
ssh root@YOUR_SERVER_IP
```

4. Create a non-root user (better security practice):

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy/
```

5. From now on, SSH as `deploy`:

```bash
ssh deploy@YOUR_SERVER_IP
```

---

## Step 2: Install Docker

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker (official script)
curl -fsSL https://get.docker.com | sudo sh

# Add your user to the docker group (so you don't need sudo for docker)
sudo usermod -aG docker deploy

# Log out and back in for group change to take effect
exit
```

SSH back in and verify:
```bash
docker --version    # Docker version 25.x.x
docker compose version  # Docker Compose version v2.x.x
```

---

## Step 3: Point your domain to the server

Go to your domain registrar's DNS settings and add an **A record**:

```
Type:  A
Name:  baas          (this creates baas.yourdomain.com)
Value: YOUR_SERVER_IP
TTL:   300
```

Wait a few minutes for DNS to propagate. Verify with:
```bash
nslookup baas.yourdomain.com
# Should return YOUR_SERVER_IP
```

**Why this matters**: Caddy (the production reverse proxy) automatically fetches an SSL/TLS certificate from Let's Encrypt. Let's Encrypt verifies domain ownership by connecting to your server at port 80 — so the domain must already point to your server before you start the stack.

---

## Step 4: Clone the repo

```bash
cd ~
git clone https://github.com/yourorg/curtain.git
cd curtain
```

---

## Step 5: Configure environment variables

```bash
cp infra/.env.example infra/.env
nano infra/.env
```

Fill in every variable:

```env
# ─── Domain ──────────────────────────────────────────────────────────────────
DOMAIN=baas.yourdomain.com
ADMIN_EMAIL=you@yourdomain.com   # For Let's Encrypt certificate notifications

# ─── Database ────────────────────────────────────────────────────────────────
POSTGRES_DB=curtain
POSTGRES_USER=curtain
POSTGRES_PASSWORD=REPLACE_WITH_STRONG_PASSWORD   # Use a password manager

# ─── JWT ─────────────────────────────────────────────────────────────────────
# CRITICAL: Must be at least 32 characters. Never share this.
JWT_SECRET=REPLACE_WITH_LONG_RANDOM_STRING_MINIMUM_32_CHARS

# ─── MinIO Storage ───────────────────────────────────────────────────────────
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=REPLACE_WITH_STRONG_PASSWORD

# ─── Google OAuth (optional — leave empty to disable) ────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**Generating secure secrets**:
```bash
# Generate a random 64-character JWT secret
openssl rand -base64 48

# Or use:
cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 64
```

**Never commit `.env` to git.** It's already in `.gitignore`.

---

## Step 6: Start production stack

```bash
cd ~/curtain

# Build images and start containers in background
make up

# Equivalent to:
# docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```

First startup takes a few minutes as Docker builds the Go services and pulls base images.

Check all containers started:
```bash
make ps
# All containers should show "Up" status
```

---

## Step 7: Verify everything works

```bash
# Health check
curl https://baas.yourdomain.com/health
# {"status":"ok","service":"curtain-dev"}

# Sign up a test user
curl -X POST https://baas.yourdomain.com/auth/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "testpassword123"}'
# {"access_token":"eyJ...", ...}

# Open the dashboard
# https://baas.yourdomain.com
```

---

## HTTPS with Caddy

Caddy is the production reverse proxy. Unlike nginx, it handles **TLS (HTTPS) automatically**:

1. On first start, Caddy reads `DOMAIN` from the environment
2. It requests a **Let's Encrypt certificate** for your domain
3. The certificate is saved to the `caddy-data` Docker volume (survives container restarts)
4. Caddy renews certificates automatically before they expire (Let's Encrypt certs expire every 90 days)

You do nothing — HTTPS just works.

The Caddyfile at `infra/caddy/Caddyfile` handles path routing the same way nginx does in development.

**Checking certificate status**:
```bash
docker logs curtain-caddy 2>&1 | grep -i cert
# Look for: "certificate obtained successfully" or "certificate renewed"
```

---

## Memory limits and tuning

The production `docker-compose.yml` sets memory limits on every container to prevent one misbehaving service from crashing the entire VPS:

| Service | Memory limit |
|---------|-------------|
| PostgreSQL | 512 MB |
| MinIO | 256 MB |
| Edge Service | 256 MB |
| Auth Service | 64 MB |
| Realtime Service | 64 MB |
| PostgREST | 100 MB |
| Caddy | 64 MB |
| Dashboard | 32 MB |
| **Total** | ~1.4 GB |

On a 2 GB VPS, this leaves ~600 MB for the OS and overhead.

**On a 1 GB VPS**, reduce PostgreSQL to 256 MB and MinIO to 128 MB. Edit the `mem_limit` values in `docker-compose.yml`.

---

## Backups in production

### Manual backup

```bash
make pg-dump
# Saves to ./backups/backup_YYYYMMDD_HHMMSS.sql
```

### Automated nightly backups

Add a cron job on your VPS:
```bash
crontab -e
```

Add these lines:
```cron
# Backup PostgreSQL every night at 2 AM
0 2 * * * cd /home/deploy/curtain && make pg-dump >> /var/log/curtain-backup.log 2>&1

# Delete backups older than 30 days to save disk space
0 3 * * * find /home/deploy/curtain/backups -name "*.sql" -mtime +30 -delete
```

### Restore from backup

```bash
# Stop the app first to prevent writes during restore
docker compose -f infra/docker-compose.yml stop

# Restore
cat backups/backup_20260315_020000.sql | docker exec -i curtain-postgres \
  psql -U curtain -d curtain

# Start again
docker compose -f infra/docker-compose.yml start
```

### Backing up MinIO files

MinIO files are stored in the `minio-data` Docker volume. To back them up:

```bash
# Find where Docker stores the volume
docker volume inspect curtain_minio-data
# Look for "Mountpoint": "/var/lib/docker/volumes/curtain_minio-data/_data"

# Rsync to a backup location
rsync -avz /var/lib/docker/volumes/curtain_minio-data/_data/ /backup/minio/
```

Or use MinIO Client (`mc mirror`) to sync to another S3-compatible bucket.

---

## Logs and monitoring

### View logs

```bash
# All services
make logs

# Specific service
docker logs curtain-auth --tail 100 --follow
docker logs curtain-postgres --tail 50

# Available service names:
# curtain-caddy, curtain-postgres, curtain-postgrest,
# curtain-auth, curtain-realtime, curtain-edge,
# curtain-storage, curtain-storage-gw, curtain-dashboard
```

### Resource usage

```bash
# CPU and memory usage, live
docker stats

# Disk usage
df -h
docker system df
```

### Log rotation

Logs are configured with `max-size: 10m` and `max-file: 3` in `docker-compose.yml`, so each service's logs are automatically capped at 30 MB total. No action needed.

---

## Updating Curtain

```bash
cd ~/curtain

# Pull latest code
git pull

# Rebuild and restart (zero-downtime not guaranteed — brief downtime expected)
make up
```

This rebuilds Docker images with the new code and recreates containers. Existing data (PostgreSQL, MinIO) is preserved in Docker volumes.

**Before updating** in production: test locally with `make dev` first.

---

## Troubleshooting

### Caddy isn't getting a certificate

Symptoms: HTTPS shows a certificate error or Caddy logs show "failed to obtain certificate".

Causes:
1. **DNS not propagated yet** — wait 5-10 minutes after adding the DNS record
2. **Port 80/443 blocked by firewall** — Let's Encrypt needs to reach your server on port 80

Fix for firewall (Ubuntu UFW):
```bash
sudo ufw allow 80
sudo ufw allow 443
sudo ufw reload
```

### Container keeps restarting

```bash
docker logs curtain-auth --tail 50
```

Common reasons:
- `DATABASE_URL` is wrong → cannot connect to postgres
- `JWT_SECRET` is empty → auth service crashes on startup
- Port conflict (unlikely in production since ports are internal)

### Out of disk space

```bash
df -h
docker system prune -f  # Remove unused images, stopped containers
```

### Database won't start

```bash
docker logs curtain-postgres --tail 100
```

If the `.env` password changed after the volume was created, PostgreSQL will refuse to start (password mismatch). Fix: delete and recreate the volume (WARNING: destroys all data):
```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d
```

---

Next: [Contributing](./11-contributing.md) — how to make changes and contribute to Curtain.
