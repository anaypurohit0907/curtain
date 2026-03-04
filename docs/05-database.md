# Database

This guide explains the database schema, how PostgREST auto-generates a REST API from it, how to use the SQL editor in the dashboard, and how to enable realtime subscriptions.

---

## Table of Contents

- [Database schema overview](#database-schema-overview)
- [The public schema (your app data)](#the-public-schema-your-app-data)
- [Using the SQL editor](#using-the-sql-editor)
- [Querying data via PostgREST](#querying-data-via-postgrest)
- [Row-level security](#row-level-security)
- [Realtime subscriptions](#realtime-subscriptions)
- [Direct database access (psql)](#direct-database-access-psql)
- [Backups and restore](#backups-and-restore)

---

## Database schema overview

Curtain creates a PostgreSQL database named `curtain` with four **schemas** (think of schemas as namespaces or folders within the database):

```
curtain database
├── auth schema         — internal, used by the auth service
│   ├── users
│   └── refresh_tokens
├── storage schema      — internal, file metadata
│   ├── buckets
│   └── objects
├── edge schema         — internal, function definitions
│   └── functions
└── public schema       — YOUR app data
    └── (tables you create)
```

**You should only create tables in the `public` schema.** The `auth`, `storage`, and `edge` schemas are used internally by Curtain services — don't modify them unless you know what you're doing.

### Internal table definitions

These are for reference — you shouldn't query them directly from your app.

**auth.users**
```sql
id          UUID      PRIMARY KEY
email       TEXT      UNIQUE NOT NULL
password    TEXT      NULL (NULL for OAuth users)
provider    TEXT      'email' or 'google'
provider_id TEXT      NULL (OAuth provider's user ID)
role        TEXT      'authenticated' (default)
metadata    JSONB     {} (custom fields you can set)
confirmed   BOOLEAN   false (set to true after email verification)
created_at  TIMESTAMPTZ
updated_at  TIMESTAMPTZ
```

**edge.functions**
```sql
id         UUID  PRIMARY KEY
name       TEXT  UNIQUE
slug       TEXT  UNIQUE (URL-safe, used in /invoke/{slug})
code       TEXT  The function source code
env_vars   JSONB Custom environment variables (for the function)
active     BOOL  Whether the function is callable
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

---

## The public schema (your app data)

You create tables in the `public` schema for your application. Everything in `public` is automatically accessible via the PostgREST REST API.

### Creating your first table

Open the dashboard, go to **Database**, and run:

```sql
CREATE TABLE public.products (
  id          SERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  price       INTEGER     NOT NULL,   -- price in paise (₹1 = 100 paise)
  description TEXT,
  active      BOOLEAN     DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

That's it — the table is immediately queryable via:
```
GET http://localhost:8080/rest/v1/products
```

### Common column types

| SQL type | What it stores | Example value |
|---|---|---|
| `SERIAL` | Auto-incrementing integer (1, 2, 3...) | `42` |
| `UUID` | Random unique identifier | `550e8400-e29b-41d4-a716-446655440000` |
| `TEXT` | Any string | `"Hello World"` |
| `INTEGER` | Whole number | `42` |
| `NUMERIC(10,2)` | Decimal number (10 digits, 2 after decimal) | `999.99` |
| `BOOLEAN` | True or false | `true` |
| `TIMESTAMPTZ` | Date + time + timezone | `2026-03-15 14:30:00+05:30` |
| `JSONB` | JSON object, stored efficiently | `{"color": "red", "size": "L"}` |

**Tip**: Use `TIMESTAMPTZ` (timestamp with time zone) rather than `TIMESTAMP`. It's timezone-aware and avoids subtle bugs when your server is in a different timezone from your users.

### Best practices

```sql
-- Always use UUID primary keys for user-facing data (harder to enumerate than 1, 2, 3...)
CREATE TABLE orders (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  total      INTEGER NOT NULL,
  status     TEXT    DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add an auto-updating updated_at trigger
SELECT set_updated_at('public', 'orders');
-- (set_updated_at is a function defined in init.sql)

-- Enable realtime for this table
SELECT enable_realtime('public', 'orders');
```

---

## Using the SQL editor

The dashboard's **Database** tab gives you a full SQL editor backed by a direct PostgreSQL connection. It goes through `/db/v1/query` which is JWT-authenticated — so only logged-in users can run queries.

### Supported query types

**SELECT** — reads data, displays results as a table:
```sql
SELECT * FROM auth.users ORDER BY created_at DESC;
SELECT id, name, price FROM products WHERE active = true LIMIT 20;
```

**INSERT** — adds data, with RETURNING to get the inserted row:
```sql
INSERT INTO products (name, price) VALUES ('Test Widget', 500) RETURNING *;
```

**UPDATE** — modifies data:
```sql
UPDATE products SET price = 450 WHERE id = 1;
```

**DELETE** — removes data:
```sql
DELETE FROM products WHERE active = false;
```

**CREATE TABLE** — creates a new table:
```sql
CREATE TABLE public.blog_posts (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT,
  published  BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**ALTER TABLE** — modifies an existing table:
```sql
-- Add a column
ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 0;

-- Remove a column
ALTER TABLE products DROP COLUMN description;

-- Rename a column
ALTER TABLE products RENAME COLUMN stock TO inventory;
```

**DROP TABLE** — deletes a table and all its data:
```sql
DROP TABLE IF EXISTS products;         -- IF EXISTS prevents error if table doesn't exist
DROP TABLE IF EXISTS products CASCADE; -- CASCADE also drops things that depend on this table
```

**Useful system queries**:
```sql
-- List all tables in your app
SELECT table_name, table_schema
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;

-- See column names and types for a table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'products'
ORDER BY ordinal_position;

-- See all indexes
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public';

-- See table sizes
SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(oid)) AS total_size
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
ORDER BY pg_total_relation_size(oid) DESC;
```

### Keyboard shortcut

Press **Ctrl+Enter** (or **Cmd+Enter** on Mac) to run the current query.

### Errors

If your SQL has a syntax error or a constraint violation, the editor shows the exact PostgreSQL error message in red. Examples:
- `ERROR: syntax error at or near "FORM"` — you typed FORM instead of FROM
- `ERROR: duplicate key value violates unique constraint "products_name_key"` — you tried to insert a name that already exists

---

## Querying data via PostgREST

PostgREST gives you a REST API for any table in `public`. This is intended for your **application frontend** — you use this in your React/Vue/mobile app.

### Basic queries

```bash
BASE="http://localhost:8080/rest/v1"
TOKEN="eyJ..."

# Get all products
curl "$BASE/products" -H "Authorization: Bearer $TOKEN"

# Get one product (filter by id)
curl "$BASE/products?id=eq.5" -H "Authorization: Bearer $TOKEN"

# Get products under ₹1000
curl "$BASE/products?price=lt.100000" -H "Authorization: Bearer $TOKEN"

# Get only specific columns
curl "$BASE/products?select=id,name,price" -H "Authorization: Bearer $TOKEN"

# Sort by price descending
curl "$BASE/products?order=price.desc" -H "Authorization: Bearer $TOKEN"

# Paginate: 10 items, skip first 20
curl "$BASE/products?limit=10&offset=20" -H "Authorization: Bearer $TOKEN"
```

### Combining filters

```bash
# Products that are active AND cost less than ₹1000
curl "$BASE/products?active=eq.true&price=lt.100000" \
  -H "Authorization: Bearer $TOKEN"
```

### Writing data

```bash
# Insert
curl -X POST "$BASE/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \   # makes it return the inserted row
  -d '{"name": "Widget", "price": 500}'

# Update
curl -X PATCH "$BASE/products?id=eq.5" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"price": 450}'

# Delete
curl -X DELETE "$BASE/products?id=eq.5" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Row-level security

**Row-Level Security (RLS)** is a PostgreSQL feature where the database itself enforces access rules at the row level. Even if an attacker bypasses your application code, PostgreSQL won't let them see data they shouldn't.

### Example: users can only see their own orders

```sql
-- 1. Enable RLS on the table
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 2. Create a policy (a rule that decides access)
-- This policy allows authenticated users to SELECT only rows where user_id matches their JWT sub
CREATE POLICY "users_own_orders" ON orders
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());  -- auth.uid() returns the user ID from the JWT
```

**How it works**: PostgREST passes your JWT to PostgreSQL. PostgreSQL evaluates the `USING` clause with the JWT claims as context. `auth.uid()` is a helper function defined in `init.sql` that returns the `sub` (subject = user ID) from the current JWT.

### Grant table access to roles

```sql
-- Let authenticated users read and write products
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO authenticated;

-- Let anonymous users only read public products
GRANT SELECT ON products TO anon;
```

---

## Realtime subscriptions

### Enabling realtime on a table

```sql
-- Run this once per table (from the SQL editor or make psql)
SELECT enable_realtime('public', 'orders');
```

This installs a PostgreSQL trigger on the `orders` table. The trigger fires after every INSERT, UPDATE, and DELETE and calls `pg_notify()`.

### Subscribing from your app (SDK)

```typescript
const client = createClient('http://localhost:8080')

// Subscribe to all changes on the orders table
client.channel('public:orders')
  .on('INSERT', (payload) => {
    console.log('New order created:', payload.new)
  })
  .on('UPDATE', (payload) => {
    console.log('Order updated. Before:', payload.old, 'After:', payload.new)
  })
  .on('DELETE', (payload) => {
    console.log('Order deleted:', payload.old)
  })
  .subscribe()
```

### What the payload looks like

```json
{
  "schema": "public",
  "table": "orders",
  "event": "INSERT",
  "new": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "...",
    "total": 50000,
    "status": "pending",
    "created_at": "2026-03-15T14:30:00Z"
  },
  "old": null
}
```

For UPDATE, both `new` and `old` are populated. For DELETE, only `old` is populated.

### Disabling realtime

```sql
SELECT disable_realtime('public', 'orders');
```

---

## Direct database access (psql)

`psql` is the official PostgreSQL command-line client. Run it via:

```bash
make psql
```

This opens an interactive SQL shell connected to the running PostgreSQL container. You can run any SQL here.

**Useful psql commands** (these start with `\`, not SQL):

```
\l              — list all databases
\c curtain    — connect to the curtain database
\dn             — list all schemas
\dt public.*    — list all tables in public schema
\d products     — describe the products table (columns, types, constraints)
\di products    — list indexes on products
\q              — quit psql
\?              — help with psql commands
\h CREATE TABLE — help with SQL syntax
```

---

## Backups and restore

### Manual backup

```bash
make pg-dump
# Saves to: ./backups/backup_YYYYMMDD_HHMMSS.sql
```

This runs `pg_dump` inside the PostgreSQL container and copies the output to your machine.

### Restore from backup

```bash
# Stop the app first, then:
cat backups/backup_20260315_143000.sql | docker exec -i curtain-dev-postgres \
  psql -U curtain -d curtain
```

### Automated daily backup (crontab)

On your production VPS:
```bash
crontab -e
```
Add this line (runs at 2 AM every night):
```
0 2 * * * cd /path/to/curtain && make pg-dump >> /var/log/curtain-backup.log 2>&1
```

### What's NOT backed up

`make pg-dump` backs up the PostgreSQL database only. MinIO files (images, documents) are stored in the `minio-data` Docker volume and need to be backed up separately. You can use `mc mirror` (MinIO Client) or a simple rsync of the Docker volume data directory.

---

Next: [Authentication](./06-authentication.md) — how signup, login, JWT tokens, and Google OAuth work.
