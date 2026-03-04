# Storage

This guide explains how file storage works in Curtain — buckets, uploading files, listing objects, and how the storage gateway solves JWT authentication with MinIO.

---

## Table of Contents

- [What is MinIO?](#what-is-minio)
- [The storage gateway — why it exists](#the-storage-gateway--why-it-exists)
- [Default buckets](#default-buckets)
- [Listing buckets](#listing-buckets)
- [Uploading a file](#uploading-a-file)
- [Listing files in a bucket](#listing-files-in-a-bucket)
- [Deleting a file](#deleting-a-file)
- [Public vs private buckets](#public-vs-private-buckets)
- [File size limits](#file-size-limits)
- [Storage gateway API reference](#storage-gateway-api-reference)
- [MinIO web console](#minio-web-console)

---

## What is MinIO?

**MinIO** is an open-source object storage server — think of it as a self-hosted version of Amazon S3. It stores files as **objects** (any binary data: images, PDFs, videos, etc.) inside named **buckets** (containers for objects, similar to directories).

MinIO is **S3-compatible**, which means tools and libraries built for AWS S3 also work with MinIO.

**Key terms**:
- **Bucket** — A named container for files. Example: `avatars`, `documents`, `uploads`. Like a folder at the top level.
- **Object** — A file stored in a bucket. Identified by a **key** (its path). Example: `user-123/photo.jpg`.
- **Key** — The filename/path of an object within a bucket. Can contain slashes to simulate subdirectories: `users/alice/profile.jpg`.

---

## The storage gateway — why it exists

MinIO uses **AWS Signature V4** authentication — a complex signing scheme using an `access_key` and `secret_key`. This is completely different from JWT Bearer tokens.

If nginx sent your JWT directly to MinIO, MinIO would return `403 Forbidden` because it doesn't understand JWT tokens.

**The storage gateway** (`services/storage-gw/`) is a small Go service that sits between nginx and MinIO:

```
Browser                 nginx                Storage GW             MinIO
  │                       │                       │                    │
  │  GET /storage/v1/     │                       │                    │
  │  Authorization: Bearer │  proxy_pass           │                    │
  │  eyJ... ─────────────►│──────────────────────►│                    │
  │                        │                   validate JWT            │
  │                        │                   if OK, call MinIO       │
  │                        │                   with S3 credentials     │
  │                        │                   ──────────────────────► │
  │                        │                   ◄──────────────────────  │
  │  ◄─────────────────────│◄──────────────────────│                    │
  200 [{"Name":"public"}]
```

The gateway:
1. Extracts your JWT from `Authorization: Bearer ...`
2. Validates it using the shared `JWT_SECRET`
3. If valid, makes the equivalent request to MinIO using root S3 credentials
4. Returns the result as JSON

This lets you use a single consistent auth system (JWT) for everything, without needing to know MinIO's S3 credentials in your frontend code.

---

## Default buckets

On first startup, three buckets are created automatically:

| Bucket | Purpose |
|--------|---------|
| `public` | Files accessible to anyone (no auth needed for download) |
| `private` | Files for authenticated users only |
| `system` | Internal use by Curtain (don't use this in your app) |

Add your own buckets via the MinIO console (port 9001 in dev) or using the `mc` command-line tool.

---

## Listing buckets

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl http://localhost:8080/storage/v1/ \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
[
  {"Name": "public",  "CreationDate": "2026-03-15T14:30:00Z", "public": true},
  {"Name": "private", "CreationDate": "2026-03-15T14:30:00Z", "public": false},
  {"Name": "system",  "CreationDate": "2026-03-15T14:30:00Z", "public": false}
]
```

The `public` field is `true` for the bucket named `public` (hardcoded for now — all other buckets return `false`).

---

## Uploading a file

```bash
# Upload an image to the "avatars" bucket with key "user-123/photo.jpg"
curl -X PUT "http://localhost:8080/storage/v1/avatars/user-123/photo.jpg" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/photo.jpg
```

Response: `200 OK` (empty body on success).

**URL structure**: `/storage/v1/{bucket}/{key}`

The `key` can include slashes to organize files in subdirectories:
- `user-123/avatar.jpg` — file in a "user-123 folder"
- `2026/march/report.pdf` — hierarchical organization

**Content-Type**: Always set this to the correct MIME type:
| File type | Content-Type |
|-----------|-------------|
| JPEG image | `image/jpeg` |
| PNG image | `image/png` |
| PDF | `application/pdf` |
| JSON | `application/json` |
| Generic binary | `application/octet-stream` |

---

## Listing files in a bucket

```bash
# List all files in the "avatars" bucket
curl "http://localhost:8080/storage/v1/avatars" \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
[
  {
    "Key":          "user-123/photo.jpg",
    "Size":         45230,
    "LastModified": "2026-03-15T14:30:00Z",
    "ETag":         "\"d41d8cd98f00b204e9800998ecf8427e\""
  },
  {
    "Key":          "user-456/avatar.png",
    "Size":         12800,
    "LastModified": "2026-03-16T09:00:00Z",
    "ETag":         "\"5d41402abc4b2a76b9719d911017c592\""
  }
]
```

- **Key** — The file's path within the bucket
- **Size** — File size in bytes
- **LastModified** — When the file was last uploaded
- **ETag** — A fingerprint of the file contents (useful for caching)

---

## Deleting a file

```bash
curl -X DELETE "http://localhost:8080/storage/v1/avatars/user-123/photo.jpg" \
  -H "Authorization: Bearer $TOKEN"
```

Response: **204 No Content** on success.

---

## Public vs private buckets

### The "public" bucket

Files in the `public` bucket are accessible without authentication. MinIO is configured (by `init-buckets.sh`) to set the `public` bucket as anonymous download:

```sh
mc anonymous set download local/public
```

This means anyone can fetch a file from `public` if they know the URL — no JWT required.

**Direct MinIO URL** (development only): `http://localhost:9000/public/filename.jpg`

**Via gateway** (always requires JWT for listing/upload): `http://localhost:8080/storage/v1/public/filename.jpg`

Use the `public` bucket for: profile avatars, product images, anything meant to be publicly visible.

### Private buckets

Files in `private` (and any bucket you create) are not publicly accessible from MinIO. All operations go through the storage gateway which enforces JWT auth.

Use private buckets for: documents, invoices, user uploads that should only be visible to the owner.

---

## File size limits

The nginx proxy is configured with:
```nginx
client_max_body_size 100m;
```

This means individual file uploads are limited to **100 MB**. To change this, edit `infra/nginx-dev.conf` (development) or `infra/caddy/Caddyfile` (production) and rebuild the nginx container.

---

## Storage gateway API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/storage/v1/` | List all buckets |
| GET | `/storage/v1/{bucket}` | List objects in bucket |
| PUT | `/storage/v1/{bucket}/{key}` | Upload a file |
| DELETE | `/storage/v1/{bucket}/{key}` | Delete a file |

All endpoints require `Authorization: Bearer <token>`.

**Error responses**:
```json
{"error": "missing_token",      "message": "Authorization header required"}
{"error": "invalid_token",      "message": "..."}
{"error": "minio_error",        "message": "..."}
{"error": "not_found",          "message": ""}
```

---

## MinIO web console

In development, the MinIO admin console is exposed at:
```
http://localhost:9001
```

Login with:
- Username: `minio` (or `MINIO_ROOT_USER` from your `.env`)
- Password: `devminiopassword` (or `MINIO_ROOT_PASSWORD` from your `.env`)

From the console you can:
- Browse buckets and files visually
- Create new buckets
- Set bucket policies (public/private)
- Monitor storage usage
- Upload and download files manually

**In production** the console is not exposed externally (no port mapping in `docker-compose.yml`). Access it by SSH tunneling: `ssh -L 9001:localhost:9001 user@your-vps`.

---

Next: [Edge Functions](./08-edge-functions.md) — writing and deploying serverless functions.
