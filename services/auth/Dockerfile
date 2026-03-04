# ─── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Dependencies first (layer cache)
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# -ldflags="-w -s": strip debug info → smaller binary
# CGO_ENABLED=0:    static binary (no libc dep) → can use scratch base
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-w -s" \
    -trimpath \
    -o auth \
    ./cmd/

# ─── Runtime stage ────────────────────────────────────────────────────────────
# scratch = zero-OS base image → ~10MB final image vs ~200MB with ubuntu
FROM scratch

# CA certs needed for HTTPS outbound calls (Google OAuth)
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

COPY --from=builder /app/auth /auth

EXPOSE 9999

ENTRYPOINT ["/auth"]
