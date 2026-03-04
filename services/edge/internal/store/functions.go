package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("function not found")

// Function represents an edge function record in the database.
type Function struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Slug string    `json:"slug"`
	Code string    `json:"code,omitempty"`
}

type Store struct {
	pool *pgxpool.Pool
}

func New(ctx context.Context, connString string) (*Store, error) {
	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) GetBySlug(ctx context.Context, slug string) (*Function, error) {
	f := &Function{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, slug, code FROM edge.functions
		 WHERE slug = $1 AND active = true`, slug,
	).Scan(&f.ID, &f.Name, &f.Slug, &f.Code)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return f, err
}

func (s *Store) Upsert(ctx context.Context, name, slug, code string) (*Function, error) {
	f := &Function{}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO edge.functions (id, name, slug, code, active)
		 VALUES (uuid_generate_v4(), $1, $2, $3, true)
		 ON CONFLICT (slug) DO UPDATE
		   SET code = EXCLUDED.code,
		       name = EXCLUDED.name,
		       active = true,
		       updated_at = NOW()
		 RETURNING id, name, slug, code`,
		name, slug, code,
	).Scan(&f.ID, &f.Name, &f.Slug, &f.Code)
	return f, err
}

func (s *Store) Delete(ctx context.Context, slug string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE edge.functions SET active = false WHERE slug = $1`, slug)
	return err
}

func (s *Store) DeleteByID(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE edge.functions SET active = false WHERE id = $1::uuid`, id)
	return err
}

func (s *Store) UpdateByID(ctx context.Context, id, code string) (*Function, error) {
	f := &Function{}
	err := s.pool.QueryRow(ctx,
		`UPDATE edge.functions SET code = $2, updated_at = NOW()
		 WHERE id = $1::uuid AND active = true
		 RETURNING id, name, slug, code`,
		id, code,
	).Scan(&f.ID, &f.Name, &f.Slug, &f.Code)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return f, err
}

func (s *Store) List(ctx context.Context) ([]*Function, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, slug, '' as code FROM edge.functions WHERE active = true ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var fns []*Function
	for rows.Next() {
		f := &Function{}
		if err := rows.Scan(&f.ID, &f.Name, &f.Slug, &f.Code); err != nil {
			return nil, err
		}
		fns = append(fns, f)
	}
	return fns, rows.Err()
}
