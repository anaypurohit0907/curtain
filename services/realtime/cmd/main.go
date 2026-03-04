package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/curtain/curtain/services/realtime/internal/hub"
	"github.com/curtain/curtain/services/realtime/internal/listener"
	"github.com/curtain/curtain/services/realtime/internal/ws"
)

func main() {
	dbURL     := mustEnv("DATABASE_URL")
	jwtSecret := []byte(mustEnv("JWT_SECRET"))
	port      := envOr("PORT", "4000")

	ctx := context.Background()

	// ── Postgres pool ──────────────────────────────────────────────────────────
	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatalf("realtime: bad DB URL: %v", err)
	}
	cfg.MaxConns = 5
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		log.Fatalf("realtime: cannot connect to database: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("realtime: database ping failed: %v", err)
	}
	log.Println("realtime: database connected")

	// ── Hub + Listener ─────────────────────────────────────────────────────────
	h := hub.New()
	go h.Run()

	l := listener.New(pool, h)
	go l.Run(ctx)

	// ── HTTP server ────────────────────────────────────────────────────────────
	wsHandler := &ws.Handler{Hub: h, JWTSecret: jwtSecret}

	mux := http.NewServeMux()

	// WebSocket endpoint
	mux.HandleFunc("/websocket", wsHandler.ServeHTTP)

	// Health / stats
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(h.Stats())
	})

	log.Printf("realtime service listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
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
