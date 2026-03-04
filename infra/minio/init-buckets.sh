#!/bin/sh
# =============================================================================
# MinIO bucket initialization script
# Runs once during first docker compose up to create default buckets.
# =============================================================================
set -e

echo "Waiting for MinIO to be ready..."
until mc alias set local http://storage:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  sleep 2
done

echo "MinIO ready. Configuring buckets..."

# Default buckets
mc mb --ignore-existing local/public         # Public read bucket (avatars, media)
mc mb --ignore-existing local/private        # Authenticated-only bucket
mc mb --ignore-existing local/system         # Internal system bucket

# Set public bucket policy (anonymous read)
mc anonymous set download local/public

echo "MinIO initialization complete."
