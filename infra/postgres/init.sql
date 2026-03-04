-- =============================================================================
-- Curtain - PostgreSQL Initialization Script
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS edge;

-- =============================================================================
-- PostgREST Roles (RLS-based access control)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- Grant schema usage
GRANT USAGE ON SCHEMA public   TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA storage  TO authenticated, service_role;
GRANT USAGE ON SCHEMA edge     TO service_role;
GRANT USAGE ON SCHEMA auth     TO service_role;

-- Grant current user permission to grant to roles
GRANT anon        TO curtain;
GRANT authenticated TO curtain;
GRANT service_role  TO curtain;

-- =============================================================================
-- Auth Tables
-- =============================================================================
CREATE TABLE IF NOT EXISTS auth.users (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       TEXT        UNIQUE NOT NULL,
    password    TEXT,                           -- bcrypt hash; NULL for OAuth
    provider    TEXT        NOT NULL DEFAULT 'email',  -- 'email' | 'google'
    provider_id TEXT,                           -- OAuth provider's user ID
    role        TEXT        NOT NULL DEFAULT 'authenticated',
    metadata    JSONB       NOT NULL DEFAULT '{}',
    confirmed   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_users_email_idx    ON auth.users(email);
CREATE INDEX IF NOT EXISTS auth_users_provider_idx ON auth.users(provider, provider_id);

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token      TEXT        UNIQUE NOT NULL,
    revoked    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_token_idx ON auth.refresh_tokens(token);
CREATE INDEX IF NOT EXISTS auth_refresh_tokens_user_idx  ON auth.refresh_tokens(user_id);

-- =============================================================================
-- Storage Tables
-- =============================================================================
CREATE TABLE IF NOT EXISTS storage.buckets (
    id         TEXT        PRIMARY KEY,
    name       TEXT        UNIQUE NOT NULL,
    public     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS storage.objects (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    bucket_id   TEXT        NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    size        BIGINT,
    mime_type   TEXT,
    owner       UUID        REFERENCES auth.users(id),
    metadata    JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (bucket_id, name)
);

CREATE INDEX IF NOT EXISTS storage_objects_bucket_idx ON storage.objects(bucket_id);
CREATE INDEX IF NOT EXISTS storage_objects_owner_idx  ON storage.objects(owner);

-- Default public bucket
INSERT INTO storage.buckets (id, name, public)
  VALUES ('public', 'public', TRUE)
  ON CONFLICT DO NOTHING;

-- =============================================================================
-- Edge Function Tables
-- =============================================================================
CREATE TABLE IF NOT EXISTS edge.functions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT        UNIQUE NOT NULL,
    slug        TEXT        UNIQUE NOT NULL,  -- URL-safe identifier
    code        TEXT        NOT NULL DEFAULT '',
    env_vars    JSONB       NOT NULL DEFAULT '{}',
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS edge_functions_slug_idx ON edge.functions(slug);

-- =============================================================================
-- Default privileges for PostgREST
-- =============================================================================
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT                 ON SEQUENCES  TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT                        ON TABLES     TO anon;

-- service_role gets everything
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO service_role;

-- =============================================================================
-- Realtime: LISTEN/NOTIFY infrastructure
-- =============================================================================
CREATE OR REPLACE FUNCTION notify_table_change()
RETURNS TRIGGER AS $$
DECLARE
    payload     JSON;
    schema_name TEXT := TG_TABLE_SCHEMA;
    table_name  TEXT := TG_TABLE_NAME;
    payload_txt TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        payload := json_build_object(
            'schema',     schema_name,
            'table',      table_name,
            'event_type', 'INSERT',
            'new_record', row_to_json(NEW)
        );
    ELSIF TG_OP = 'UPDATE' THEN
        payload := json_build_object(
            'schema',     schema_name,
            'table',      table_name,
            'event_type', 'UPDATE',
            'old_record', row_to_json(OLD),
            'new_record', row_to_json(NEW)
        );
    ELSIF TG_OP = 'DELETE' THEN
        payload := json_build_object(
            'schema',     schema_name,
            'table',      table_name,
            'event_type', 'DELETE',
            'old_record', row_to_json(OLD)
        );
    END IF;

    payload_txt := payload::text;

    -- pg_notify limit is 8000 bytes; send only metadata for large rows
    IF length(payload_txt) > 7500 THEN
        payload_txt := json_build_object(
            'schema',     schema_name,
            'table',      table_name,
            'event_type', TG_OP,
            'truncated',  true
        )::text;
    END IF;

    PERFORM pg_notify('curtain_changes', payload_txt);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Helper: call this to enable realtime on any table
-- Usage: SELECT enable_realtime('public', 'products');
CREATE OR REPLACE FUNCTION enable_realtime(schema_name TEXT, table_name TEXT)
RETURNS void AS $$
DECLARE
    trigger_name TEXT := 'curtain_realtime_' || table_name;
BEGIN
    EXECUTE format(
        'DROP TRIGGER IF EXISTS %I ON %I.%I;
         CREATE TRIGGER %I
         AFTER INSERT OR UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION notify_table_change()',
        trigger_name, schema_name, table_name,
        trigger_name, schema_name, table_name
    );
    RAISE NOTICE 'Realtime enabled for %.%', schema_name, table_name;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Updated_at auto-trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auth_users_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER edge_functions_updated_at
    BEFORE UPDATE ON edge.functions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
