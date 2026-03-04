package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"

	"github.com/curtain/curtain/services/edge/internal/runner"
	"github.com/curtain/curtain/services/edge/internal/store"
)

func main() {
	dbURL      := mustEnv("DATABASE_URL")
	jwtSecret  := []byte(mustEnv("JWT_SECRET"))
	port       := envOr("PORT", "5555")
	denoPath   := envOr("DENO_EXEC", "/usr/local/bin/deno")
	fnDir      := envOr("FUNCTION_DIR", "/tmp/fn")
	timeoutMs  := 5000
	if v := os.Getenv("FUNCTION_TIMEOUT_MS"); v != "" {
		if n := parseInt(v); n > 0 {
			timeoutMs = n
		}
	}

	ctx := context.Background()

	db, err := store.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("edge: cannot connect to database: %v", err)
	}
	log.Println("edge: database connected")

	r := runner.New(denoPath, fnDir, time.Duration(timeoutMs)*time.Millisecond)

	mux := chi.NewRouter()
	mux.Use(middleware.Logger)
	mux.Use(middleware.Recoverer)
	mux.Use(corsMiddleware)

	// ── Invoke a function ──────────────────────────────────────────────────────
	// POST /invoke/:slug
	mux.Post("/invoke/{slug}", func(w http.ResponseWriter, req *http.Request) {
		slug := chi.URLParam(req, "slug")

		fn, err := db.GetBySlug(req.Context(), slug)
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{
				"error": "function_not_found",
				"slug":  slug,
			})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
			return
		}

		body, _ := io.ReadAll(io.LimitReader(req.Body, 1<<20))
		headers := map[string]string{
			"content-type":  req.Header.Get("Content-Type"),
			"authorization": req.Header.Get("Authorization"),
		}

		result := r.Invoke(req.Context(), fn.Slug, fn.Code, body, headers)

		// Set user-specified headers
		for k, v := range result.Headers {
			w.Header().Set(k, v)
		}
		if ct := w.Header().Get("Content-Type"); ct == "" {
			w.Header().Set("Content-Type", "application/json")
		}

		if result.Error != "" {
			writeJSON(w, result.StatusCode, map[string]any{
				"error":       "function_error",
				"message":     result.Error,
				"duration_ms": result.DurationMs,
			})
			return
		}

		w.WriteHeader(result.StatusCode)
		_, _ = w.Write([]byte(result.Body))
	})

	// ── Management API (JWT required) ─────────────────────────────────────────
	mux.Group(func(r chi.Router) {
		r.Use(jwtMiddleware(jwtSecret))

		// REST-style CRUD: POST /functions, GET /functions, DELETE /functions/{slug}
		r.Post("/functions", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Name string `json:"name"`
				Slug string `json:"slug"`
				Code string `json:"code"`
			}
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
				return
			}
			if body.Slug == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "slug_required"})
				return
			}
			if body.Name == "" {
				body.Name = body.Slug
			}
			fn, err := db.Upsert(req.Context(), body.Name, body.Slug, body.Code)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
				return
			}
			writeJSON(w, http.StatusCreated, fn)
		})

		r.Get("/functions", func(w http.ResponseWriter, req *http.Request) {
			fns, err := db.List(req.Context())
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
				return
			}
			if fns == nil {
				fns = []*store.Function{}
			}
			writeJSON(w, http.StatusOK, fns)
		})

		r.Delete("/functions/{id}", func(w http.ResponseWriter, req *http.Request) {
			id := chi.URLParam(req, "id")
			if err := db.DeleteByID(req.Context(), id); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
		})

		// Update function code by ID
		r.Put("/functions/{id}", func(w http.ResponseWriter, req *http.Request) {
			id := chi.URLParam(req, "id")
			var body struct {
				Code string `json:"code"`
			}
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
				return
			}
			fn, err := db.UpdateByID(req.Context(), id, body.Code)
			if errors.Is(err, store.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "function_not_found"})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
				return
			}
			writeJSON(w, http.StatusOK, fn)
		})

		// Deploy/update a function (slug in URL path)
		r.Put("/deploy/{slug}", func(w http.ResponseWriter, req *http.Request) {
			slug := chi.URLParam(req, "slug")
			var body struct {
				Name string `json:"name"`
				Code string `json:"code"`
			}
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
				return
			}
			if body.Name == "" {
				body.Name = slug
			}
			fn, err := db.Upsert(req.Context(), body.Name, slug, body.Code)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
				return
			}
			writeJSON(w, http.StatusOK, fn)
		})

		// Delete a function by slug (deploy-style route)
		r.Delete("/deploy/{slug}", func(w http.ResponseWriter, req *http.Request) {
			slug := chi.URLParam(req, "slug")
			if err := db.Delete(req.Context(), slug); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
		})

		// List functions
		r.Get("/list", func(w http.ResponseWriter, req *http.Request) {
			fns, err := db.List(req.Context())
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
				return
			}
			writeJSON(w, http.StatusOK, fns)
		})
	})

	// Health
	mux.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	log.Printf("edge service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

// jwtMiddleware requires any valid JWT issued by this server.
func jwtMiddleware(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			tokenStr := strings.TrimPrefix(auth, "Bearer ")
			if tokenStr == "" {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_token"})
				return
			}
			token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, errors.New("unexpected signing method")
				}
				return secret, nil
			})
			if err != nil || !token.Valid {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_token"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required env var %s not set", key)
	}
	return v
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseInt(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}
