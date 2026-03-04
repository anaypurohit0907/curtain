# ─── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS go-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-w -s" \
    -trimpath \
    -o edge \
    ./cmd/

# ─── Deno install stage ───────────────────────────────────────────────────────
FROM denoland/deno:alpine-1.40.5 AS deno

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy Deno binary
COPY --from=deno /bin/deno /usr/local/bin/deno

# Copy Go binary
COPY --from=go-builder /app/edge /edge

RUN mkdir -p /tmp/fn && chmod 777 /tmp/fn

EXPOSE 5555
ENTRYPOINT ["/edge"]
