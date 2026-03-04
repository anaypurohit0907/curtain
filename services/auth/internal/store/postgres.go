package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/curtain/curtain/services/auth/internal/model"
)

// ErrNotFound is returned when a record does not exist.
var ErrNotFound = errors.New("record not found")

// ErrDuplicate is returned on unique constraint violations.
var ErrDuplicate = errors.New("record already exists")

// Store wraps the Postgres connection pool.
type Store struct {
	pool *pgxpool.Pool
}

// New connects to Postgres and returns a Store.
func New(ctx context.Context, connString string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 10
	cfg.MinConns = 2

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

// ── User CRUD ──────────────────────────────────────────────────────────────────

func (s *Store) CreateUser(ctx context.Context, u *model.User) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO auth.users (id, email, password, provider, provider_id, role)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		u.ID, u.Email, nullableString(u.Password),
		u.Provider, nullableString(u.ProviderID), u.Role,
	)
	return wrapErr(err)
}

func (s *Store) GetUserByEmail(ctx context.Context, email string) (*model.User, error) {
	u := &model.User{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, COALESCE(password,''), provider,
		        COALESCE(provider_id,''), role, metadata, confirmed, created_at, updated_at
		 FROM auth.users WHERE email = $1`, email,
	).Scan(&u.ID, &u.Email, &u.Password, &u.Provider,
		&u.ProviderID, &u.Role, &u.Metadata, &u.Confirmed, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, wrapErr(err)
}

func (s *Store) GetUserByID(ctx context.Context, id uuid.UUID) (*model.User, error) {
	u := &model.User{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, COALESCE(password,''), provider,
		        COALESCE(provider_id,''), role, metadata, confirmed, created_at, updated_at
		 FROM auth.users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Email, &u.Password, &u.Provider,
		&u.ProviderID, &u.Role, &u.Metadata, &u.Confirmed, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, wrapErr(err)
}

// UpsertOAuthUser finds or creates a user for an OAuth login.
func (s *Store) UpsertOAuthUser(ctx context.Context, email, provider, providerID string) (*model.User, error) {
	u := &model.User{}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO auth.users (id, email, provider, provider_id, role, confirmed)
		 VALUES (uuid_generate_v4(), $1, $2, $3, 'authenticated', true)
		 ON CONFLICT (email) DO UPDATE
		   SET provider_id = EXCLUDED.provider_id,
		       provider    = EXCLUDED.provider,
		       confirmed   = true,
		       updated_at  = NOW()
		 RETURNING id, email, COALESCE(password,''), provider,
		           COALESCE(provider_id,''), role, metadata, confirmed, created_at, updated_at`,
		email, provider, providerID,
	).Scan(&u.ID, &u.Email, &u.Password, &u.Provider,
		&u.ProviderID, &u.Role, &u.Metadata, &u.Confirmed, &u.CreatedAt, &u.UpdatedAt)
	return u, wrapErr(err)
}

func (s *Store) ListUsers(ctx context.Context) ([]*model.User, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, email, COALESCE(password,''), provider,
		        COALESCE(provider_id,''), role, metadata, confirmed, created_at, updated_at
		 FROM auth.users ORDER BY created_at DESC`)
	if err != nil {
		return nil, wrapErr(err)
	}
	defer rows.Close()

	var users []*model.User
	for rows.Next() {
		u := &model.User{}
		if err := rows.Scan(&u.ID, &u.Email, &u.Password, &u.Provider,
			&u.ProviderID, &u.Role, &u.Metadata, &u.Confirmed, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, wrapErr(err)
		}
		users = append(users, u)
	}
	return users, wrapErr(rows.Err())
}

func (s *Store) UpdateUserMetadata(ctx context.Context, id uuid.UUID, metadata []byte) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE auth.users SET metadata = $2 WHERE id = $1`, id, metadata)
	return wrapErr(err)
}

// ── Refresh Tokens ─────────────────────────────────────────────────────────────

func (s *Store) SaveRefreshToken(ctx context.Context, userID uuid.UUID, token string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO auth.refresh_tokens (user_id, token, expires_at)
		 VALUES ($1, $2, $3)`, userID, token, expiresAt)
	return wrapErr(err)
}

// ConsumeRefreshToken validates and atomically revokes a refresh token,
// returning the associated userID. Returns ErrNotFound if invalid/expired.
func (s *Store) ConsumeRefreshToken(ctx context.Context, token string) (uuid.UUID, error) {
	var userID uuid.UUID
	err := s.pool.QueryRow(ctx,
		`UPDATE auth.refresh_tokens
		 SET revoked = true
		 WHERE token = $1 AND revoked = false AND expires_at > NOW()
		 RETURNING user_id`, token,
	).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	return userID, wrapErr(err)
}

func (s *Store) RevokeAllUserTokens(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE auth.refresh_tokens SET revoked = true WHERE user_id = $1`, userID)
	return wrapErr(err)
}

// ── Raw SQL execution ──────────────────────────────────────────────────────────

// QueryResult holds the outcome of any SQL statement.
type QueryResult struct {
	Columns      []string         `json:"columns"`
	Rows         []map[string]any `json:"rows"`
	Command      string           `json:"command"`
	RowsAffected int64            `json:"rowsAffected"`
}

// ExecuteSQL runs an arbitrary SQL statement and returns a QueryResult.
// Works for SELECT (returns columns+rows), and DDL/DML (returns command+rowsAffected).
func (s *Store) ExecuteSQL(ctx context.Context, sql string) (*QueryResult, error) {
	rows, err := s.pool.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := &QueryResult{Columns: []string{}, Rows: []map[string]any{}}

	for _, fd := range rows.FieldDescriptions() {
		result.Columns = append(result.Columns, fd.Name)
	}

	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := make(map[string]any, len(result.Columns))
		for i, col := range result.Columns {
			row[col] = safeValue(vals[i])
		}
		result.Rows = append(result.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	tag := rows.CommandTag()
	result.Command = tag.String()
	result.RowsAffected = tag.RowsAffected()
	return result, nil
}

// safeValue converts pgx-scanned values to types safe for JSON marshalling.
func safeValue(v any) any {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case bool, int8, int16, int32, int64, int,
		uint8, uint16, uint32, uint64, uint,
		float32, float64, string:
		return v
	case []byte:
		return string(val)
	case time.Time:
		return val.Format(time.RFC3339Nano)
	case [16]byte: // raw UUID bytes (some pgx paths)
		id, err := uuid.FromBytes(val[:])
		if err != nil {
			return fmt.Sprintf("%x", val)
		}
		return id.String()
	case pgtype.UUID:
		if !val.Valid {
			return nil
		}
		id, err := uuid.FromBytes(val.Bytes[:])
		if err != nil {
			return fmt.Sprintf("%x", val.Bytes)
		}
		return id.String()
	case pgtype.Numeric:
		if !val.Valid {
			return nil
		}
		f, _ := val.Float64Value()
		if f.Valid {
			return f.Float64
		}
		return val.Int.String()
	case pgtype.Text:
		if !val.Valid {
			return nil
		}
		return val.String
	case pgtype.Bool:
		if !val.Valid {
			return nil
		}
		return val.Bool
	case pgtype.Int8:
		if !val.Valid {
			return nil
		}
		return val.Int64
	case pgtype.Float8:
		if !val.Valid {
			return nil
		}
		return val.Float64
	case pgtype.Timestamptz:
		if !val.Valid {
			return nil
		}
		return val.Time.Format(time.RFC3339Nano)
	case pgtype.Timestamp:
		if !val.Valid {
			return nil
		}
		return val.Time.Format(time.RFC3339Nano)
	default:
		return fmt.Sprintf("%v", val)
	}
}

// ── helpers ────────────────────────────────────────────────────────────────────

func wrapErr(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "23505") || strings.Contains(msg, "unique") {
		return ErrDuplicate
	}
	return err
}

// nullableString returns nil for empty strings (maps to SQL NULL).
func nullableString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
