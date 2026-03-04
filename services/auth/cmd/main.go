package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/curtain/curtain/services/auth/internal/handler"
	"github.com/curtain/curtain/services/auth/internal/store"
)

func main() {
	// ── Config from environment ────────────────────────────────────────────────
	dbURL      := mustEnv("DATABASE_URL")
	jwtSecret  := []byte(mustEnv("JWT_SECRET"))
	jwtExpiry  := parseDuration("JWT_EXPIRY", 3600)    // seconds
	port       := envOr("PORT", "9999")

	// ── Database connection ────────────────────────────────────────────────────
	ctx := context.Background()
	db, err := store.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("cannot connect to database: %v", err)
	}
	log.Println("auth: database connected")

	// ── Handlers ───────────────────────────────────────────────────────────────
	authH := &handler.AuthHandler{
		Store:     db,
		JWTSecret: jwtSecret,
		JWTExpiry: jwtExpiry,
	}
	oauthH := handler.NewOAuthHandler(db, jwtSecret, jwtExpiry)

	// ── Router ─────────────────────────────────────────────────────────────────
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(corsMiddleware)

	// Public routes (no JWT required)
	r.Post("/signup",        authH.SignUp)
	r.Post("/signin",        authH.SignIn)
	r.Post("/signout",       authH.SignOut)
	r.Post("/token/refresh", authH.RefreshToken)

	// Google OAuth
	r.Get("/oauth/google",          oauthH.Redirect)
	r.Get("/oauth/google/callback", oauthH.Callback)

	// Authenticated routes (JWT required)
	r.Group(func(r chi.Router) {
		r.Use(handler.JWTMiddleware(jwtSecret))
		r.Get("/user",         authH.GetUser)
		r.Put("/user",         authH.UpdateUser)
		r.Get("/admin/users",  authH.ListUsers)
		r.Post("/query",       authH.RunQuery)
	})

	// Internal route (called by realtime/edge services — not exposed via Caddy)
	r.Post("/internal/verify", authH.VerifyToken)

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	log.Printf("auth service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
}

// corsMiddleware adds permissive CORS headers for the dashboard and SDK clients.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin",  "*")
		w.Header().Set("Access-Control-Allow-Headers",
			"Authorization, Content-Type, X-Project-ID")
		w.Header().Set("Access-Control-Allow-Methods",
			"GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required environment variable %s is not set", key)
	}
	return v
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseDuration(envKey string, defaultSecs int) time.Duration {
	v := os.Getenv(envKey)
	if v == "" {
		return time.Duration(defaultSecs) * time.Second
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return time.Duration(defaultSecs) * time.Second
	}
	return time.Duration(n) * time.Second
}
