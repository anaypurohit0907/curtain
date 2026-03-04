package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func main() {
	endpoint   := envOr("MINIO_ENDPOINT", "storage:9000")
	accessKey  := mustEnv("MINIO_ROOT_USER")
	secretKey  := mustEnv("MINIO_ROOT_PASSWORD")
	jwtSecret  := []byte(mustEnv("JWT_SECRET"))
	port       := envOr("PORT", "6333")

	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: false,
	})
	if err != nil {
		log.Fatalf("storage-gw: cannot init minio client: %v", err)
	}

	gw := &gateway{mc: mc, jwtSecret: jwtSecret}

	mux := http.NewServeMux()
	mux.HandleFunc("/", gw.route)

	log.Printf("storage-gw listening on :%s → %s", port, endpoint)
	if err := http.ListenAndServe(":"+port, corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}

type gateway struct {
	mc        *minio.Client
	jwtSecret []byte
}

// route dispatches requests by method/path.
func (g *gateway) route(w http.ResponseWriter, r *http.Request) {
	// Validate JWT
	if !g.authenticated(w, r) {
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/")
	parts := strings.SplitN(path, "/", 2)
	bucket := parts[0]
	key := ""
	if len(parts) == 2 {
		key = parts[1]
	}

	switch {
	case r.Method == http.MethodGet && bucket == "":
		g.listBuckets(w, r)
	case r.Method == http.MethodGet && bucket != "" && key != "":
		g.downloadObject(w, r, bucket, key)
	case r.Method == http.MethodGet && key == "":
		g.listObjects(w, r, bucket)
	case r.Method == http.MethodPut && bucket != "" && key != "":
		g.uploadObject(w, r, bucket, key)
	case r.Method == http.MethodDelete && bucket != "" && key != "":
		g.deleteObject(w, r, bucket, key)
	default:
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
	}
}

// ── Handlers ──────────────────────────────────────────────────────────────────

type bucketInfo struct {
	Name         string    `json:"Name"`
	CreationDate time.Time `json:"CreationDate,omitempty"`
	Public       bool      `json:"public"`
}

func (g *gateway) listBuckets(w http.ResponseWriter, r *http.Request) {
	buckets, err := g.mc.ListBuckets(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, "minio_error", err.Error())
		return
	}
	resp := make([]bucketInfo, 0, len(buckets))
	for _, b := range buckets {
		resp = append(resp, bucketInfo{
			Name:         b.Name,
			CreationDate: b.CreationDate,
			Public:       b.Name == "public",
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

type objectInfo struct {
	Key          string    `json:"Key"`
	Size         int64     `json:"Size"`
	LastModified time.Time `json:"LastModified"`
	ETag         string    `json:"ETag"`
}

func (g *gateway) listObjects(w http.ResponseWriter, r *http.Request, bucket string) {
	ctx := r.Context()
	var objects []objectInfo
	for obj := range g.mc.ListObjects(ctx, bucket, minio.ListObjectsOptions{Recursive: true}) {
		if obj.Err != nil {
			writeError(w, http.StatusBadGateway, "minio_error", obj.Err.Error())
			return
		}
		objects = append(objects, objectInfo{
			Key:          obj.Key,
			Size:         obj.Size,
			LastModified: obj.LastModified,
			ETag:         obj.ETag,
		})
	}
	if objects == nil {
		objects = []objectInfo{}
	}
	writeJSON(w, http.StatusOK, objects)
}

func (g *gateway) uploadObject(w http.ResponseWriter, r *http.Request, bucket, key string) {
	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	size := r.ContentLength
	_, err := g.mc.PutObject(r.Context(), bucket, key, r.Body, size,
		minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		writeError(w, http.StatusBadGateway, "minio_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (g *gateway) deleteObject(w http.ResponseWriter, r *http.Request, bucket, key string) {
	err := g.mc.RemoveObject(r.Context(), bucket, key, minio.RemoveObjectOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, "minio_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (g *gateway) downloadObject(w http.ResponseWriter, r *http.Request, bucket, key string) {
	obj, err := g.mc.GetObject(r.Context(), bucket, key, minio.GetObjectOptions{})
	if err != nil {
		writeError(w, http.StatusBadGateway, "minio_error", err.Error())
		return
	}
	defer obj.Close()

	stat, err := obj.Stat()
	if err != nil {
		writeError(w, http.StatusNotFound, "object_not_found", err.Error())
		return
	}

	if stat.ContentType != "" {
		w.Header().Set("Content-Type", stat.ContentType)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Header().Set("Content-Length", fmt.Sprintf("%d", stat.Size))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, obj)
}

// ── Auth ──────────────────────────────────────────────────────────────────────

func (g *gateway) authenticated(w http.ResponseWriter, r *http.Request) bool {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		writeError(w, http.StatusUnauthorized, "missing_token", "Authorization header required")
		return false
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		writeError(w, http.StatusUnauthorized, "invalid_token_format", "expected Bearer token")
		return false
	}
	if err := validateJWT(parts[1], g.jwtSecret); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_token", err.Error())
		return false
	}
	return true
}

func validateJWT(tokenStr string, secret []byte) error {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return secret, nil
	})
	if err != nil {
		return err
	}
	if !token.Valid {
		return errors.New("invalid token")
	}
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
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

func writeError(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, map[string]string{"error": errCode, "message": msg})
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
